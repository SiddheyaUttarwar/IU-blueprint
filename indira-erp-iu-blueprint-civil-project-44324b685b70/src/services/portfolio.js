import { supabase } from '../lib/supabaseClient.js';
import { listProjects, listAllProjectTasksLite } from './projects.js';

const DAY = 86400000;

// Pull every task amount + every date-kind baseline in one shot (client-side aggregate).
// For a portfolio of ~100 projects this is fine; if it grows beyond that, move to a Postgres view.
export async function loadPortfolio() {
  const [projects, tasks, amountsRes, baselinesRes, indentRes] = await Promise.all([
    listProjects(),
    listAllProjectTasksLite(),
    supabase.from('project_task_amounts').select('task_id, planned_amount, actual_amount'),
    supabase.from('project_task_baselines').select('project_id, task_id, kind, snapshot_start, snapshot_end, created_at'),
    // Indent items carry planned (buy × price) and actual (received × price) — used as a fallback
    // for Cost RAG when the project hasn't populated per-task budgets. Otherwise every new
    // project stays "Not Rated" until someone opens the Budget section.
    supabase
      .from('indent_items')
      .select('buy_qty, unit_price, received_qty, planned_amount, actual_amount, indents!inner ( project_id )'),
  ]);
  if (amountsRes.error) throw amountsRes.error;
  if (baselinesRes.error) throw baselinesRes.error;
  if (indentRes.error) throw indentRes.error;
  const { data: tasksFull, error: tErr } = await supabase
    .from('project_tasks')
    .select('id, project_id, parent_task_id, status, progress_metric, quantity_value, actual_value, start_date, end_date, actual_start_date, actual_completion_date, weight_pct');
  if (tErr) throw tErr;
  // Sum indent items per project into { planned, actual } so computeRow can fall back to it.
  const indentByProject = new Map();
  for (const it of indentRes.data ?? []) {
    const pid = it.indents?.project_id;
    if (!pid) continue;
    const buy = Number(it.buy_qty || 0);
    const rec = Number(it.received_qty || 0);
    const price = Number(it.unit_price || 0);
    const planned = it.planned_amount != null ? Number(it.planned_amount) : buy * price;
    const actual = it.actual_amount != null ? Number(it.actual_amount) : rec * price;
    const row = indentByProject.get(pid) ?? { planned: 0, actual: 0 };
    row.planned += Number.isFinite(planned) ? planned : 0;
    row.actual  += Number.isFinite(actual)  ? actual  : 0;
    indentByProject.set(pid, row);
  }
  return {
    projects,
    tasks: tasksFull,
    amountsByTask: new Map((amountsRes.data ?? []).map((a) => [a.task_id, a])),
    dateBaselines: (baselinesRes.data ?? []).filter((b) => (b.kind ?? 'task_date') === 'task_date'),
    indentByProject,
  };
}

// Weighted leaf progress — same logic as ProjectDetail's leafProgress / computeProgress.
function leafProgress(t) {
  if (t.status === 'done') return 100;
  const m = t.progress_metric;
  const actual = Number(t.actual_value);
  if (m === 'percent') return Number.isFinite(actual) ? Math.min(100, Math.max(0, actual)) : 0;
  if (m === 'quantity') {
    const q = Number(t.quantity_value);
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(actual)) return 0;
    return Math.min(100, Math.max(0, (actual / q) * 100));
  }
  return t.status === 'in_progress' ? 50 : 0;
}

// Compute per-project rollup metrics used by the Portfolio table.
// ragCfg (optional) — a rag_config snapshot (live or from a chosen monthly version).
// If provided, Schedule + Cost RAG use its Amber thresholds (Red = anything beyond Amber).
// If missing, falls back to the per-project rag_rules (green/amber_min_pct).
export function computeRow(project, allTasks, amountsByTask, dateBaselines, ragCfg = null, indentByProject = null) {
  const projTasks = allTasks.filter((t) => t.project_id === project.id);
  const parentIds = new Set(projTasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id));
  const leaves = projTasks.filter((t) => !parentIds.has(t.id));
  const roots = projTasks.filter((t) => !t.parent_task_id);

  // Tasks done %
  const doneCount = leaves.filter((t) => t.status === 'done').length;
  const tasksDonePct = leaves.length ? (doneCount / leaves.length) * 100 : 0;

  // Metric progress (weighted roll-up across root tasks, same math as ProjectDetail).
  function progressOf(node) {
    const kids = projTasks.filter((c) => c.parent_task_id === node.id);
    if (!kids.length) return leafProgress(node);
    const totalW = kids.reduce((s, c) => s + (Number(c.weight_pct) || 0), 0);
    if (totalW <= 0) return 0;
    return kids.reduce((s, c) => s + progressOf(c) * (Number(c.weight_pct) || 0), 0) / totalW;
  }
  const rootTotalW = roots.reduce((s, r) => s + (Number(r.weight_pct) || 0), 0);
  const metricProgress = rootTotalW > 0
    ? roots.reduce((s, r) => s + progressOf(r) * (Number(r.weight_pct) || 0), 0) / rootTotalW
    : 0;

  // "Planned" progress at today = fraction of the planned window elapsed.
  const starts = leaves.map((t) => t.start_date).filter(Boolean).sort();
  const ends = leaves.map((t) => t.end_date).filter(Boolean).sort();
  const plannedStart = starts[0] ?? project.start_date ?? null;
  const plannedFinish = ends[ends.length - 1] ?? project.end_date ?? null;
  let plannedProgress = 0;
  if (plannedStart && plannedFinish) {
    const total = Math.max(1, (new Date(plannedFinish) - new Date(plannedStart)) / DAY);
    const elapsed = Math.max(0, (Date.now() - new Date(plannedStart)) / DAY);
    plannedProgress = Math.min(100, Math.max(0, (elapsed / total) * 100));
  }
  const vsPlanDeltaPts = Math.round(metricProgress - plannedProgress);

  // Forecast finish — actual_end if completed, else "today + remaining planned days scaled by current pace".
  let forecastFinish = null;
  let forecastDeltaDays = 0;
  if (project.actual_end_date) {
    forecastFinish = project.actual_end_date;
  } else if (plannedFinish) {
    if (metricProgress > 0 && plannedProgress > 0) {
      // If pace = metric/planned, scale remaining planned days by 1/pace.
      const pace = metricProgress / plannedProgress;
      const daysLeftPlanned = Math.max(0, (new Date(plannedFinish) - Date.now()) / DAY);
      const daysLeftForecast = pace > 0 ? daysLeftPlanned / pace : daysLeftPlanned;
      forecastFinish = new Date(Date.now() + daysLeftForecast * DAY).toISOString().slice(0, 10);
    } else {
      forecastFinish = plannedFinish;
    }
  }
  if (forecastFinish && plannedFinish) {
    forecastDeltaDays = Math.round((new Date(forecastFinish) - new Date(plannedFinish)) / DAY);
  }

  // Budget / spent from project_task_amounts. Fall back to indent-item totals when the PM
  // hasn't populated per-task budgets yet — otherwise every new project sits at Cost: Not Rated
  // even after indents have been added with prices.
  let budget = 0, spent = 0;
  for (const t of projTasks) {
    const a = amountsByTask.get(t.id);
    if (!a) continue;
    if (a.planned_amount != null) budget += Number(a.planned_amount) || 0;
    if (a.actual_amount != null) spent += Number(a.actual_amount) || 0;
  }
  if (budget === 0 && indentByProject) {
    const ind = indentByProject.get(project.id);
    if (ind) { budget = ind.planned; spent = ind.actual; }
  }
  const spentPctOfBudget = budget > 0 ? (spent / budget) * 100 : 0;
  const costOverrun = spent - budget;
  const costOverrunPct = budget > 0 ? (costOverrun / budget) * 100 : 0;

  // RAG evaluation.
  // Preferred path: use rag_config amber thresholds passed in from the Dashboard's selected version.
  //   - Schedule: on/ahead of plan → Green; lagging up to progress_amber_pts → Amber; beyond → Red.
  //   - Cost:     ≤ budget → Green; over up to cost_amber_pct → Amber; beyond → Red.
  // Fallback: legacy per-project rag_rules (green/amber_min_pct) if no config passed.
  let scheduleRag, costRag;
  if (ragCfg) {
    const progressAmberPts = Number(ragCfg.progress_amber_pts) || 2;
    const costAmberPct     = Number(ragCfg.cost_amber_pct)     || 5;
    const laggingBy = plannedProgress - metricProgress;
    scheduleRag = laggingBy <= 0
      ? 'green'
      : laggingBy <= progressAmberPts
        ? 'amber'
        : 'red';
    if (budget === 0) {
      costRag = 'unrated';
    } else if (costOverrunPct <= 0) {
      costRag = 'green';
    } else if (costOverrunPct <= costAmberPct) {
      costRag = 'amber';
    } else {
      costRag = 'red';
    }
  } else {
    const green = Number(project.rag_rules?.green_min_pct) || 80;
    const amber = Number(project.rag_rules?.amber_min_pct) || 60;
    scheduleRag = rag(metricProgress, green, amber);
    const costHealth = budget > 0 ? Math.max(0, 100 - Math.max(0, costOverrunPct)) : 100;
    costRag = budget === 0 ? 'unrated' : rag(costHealth, green, amber);
  }

  const hasBaseline = dateBaselines.some((b) => b.project_id === project.id);

  return {
    project,
    tasksDonePct: Math.round(tasksDonePct),
    metricProgress: Math.round(metricProgress),
    plannedProgress: Math.round(plannedProgress),
    vsPlanDeltaPts,
    plannedFinish,
    forecastFinish,
    forecastDeltaDays,
    scheduleRag,
    budget,
    spent,
    spentPctOfBudget: Math.round(spentPctOfBudget),
    costOverrun,
    costOverrunPct: Math.round(costOverrunPct),
    costRag,
    hasBaseline,
    department: project.campuses?.name || 'Unassigned',
  };
}

function rag(pct, green, amber) {
  if (pct >= green) return 'green';
  if (pct >= amber) return 'amber';
  return 'red';
}
