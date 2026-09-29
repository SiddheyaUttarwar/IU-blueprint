// Compute Progress / Schedule / Cost / Overall RAG for a project.
// Inputs use the shape returned by services/projects.js + services/ragConfig.js.
// Any missing input for a dimension → 'not_rated' for that dimension.
// Overall = highest severity of applicable dimensions.

const TONE_ORDER = { green: 1, amber: 2, red: 3, not_rated: 0 };

export function computeProgressRag(cfg, { plannedPct, actualPct }) {
  if (cfg == null || plannedPct == null || actualPct == null) return { tone: 'not_rated', label: 'Not Rated', variance: null };
  const variance = Number(actualPct) - Number(plannedPct); // negative = behind
  const redPts = Number(cfg.progress_red_pts ?? 0);
  if (variance >= 0) return { tone: 'green', label: 'Green', variance };
  if (variance >= -Math.abs(redPts)) return { tone: 'amber', label: 'Amber', variance };
  return { tone: 'red', label: 'Red', variance };
}

export function computeScheduleRag(cfg, { baselineDurationDays, slipDays }) {
  if (cfg == null || baselineDurationDays == null || slipDays == null) return { tone: 'not_rated', label: 'Not Rated', slip: slipDays };
  if (slipDays <= 0) return { tone: 'green', label: 'Green', slip: slipDays };
  const amberByPct = baselineDurationDays * (Number(cfg.schedule_amber_pct ?? 0) / 100);
  const amberFloor = Number(cfg.schedule_amber_min_days ?? 0);
  const amberThresh = Math.max(amberByPct, amberFloor);
  const redThresh = baselineDurationDays * (Number(cfg.schedule_red_pct ?? 0) / 100);
  if (slipDays <= amberThresh) return { tone: 'amber', label: 'Amber', slip: slipDays };
  if (slipDays <= redThresh) return { tone: 'red', label: 'Red', slip: slipDays };
  return { tone: 'red', label: 'Red', slip: slipDays };
}

export function computeCostRag(cfg, { approvedBudget, forecastAtCompletion }) {
  if (cfg == null || approvedBudget == null || forecastAtCompletion == null || Number(approvedBudget) <= 0) {
    return { tone: 'not_rated', label: 'Not Rated', variancePct: null };
  }
  const variancePct = ((Number(forecastAtCompletion) - Number(approvedBudget)) / Number(approvedBudget)) * 100;
  if (variancePct <= 0) return { tone: 'green', label: 'Green', variancePct };
  if (variancePct <= Number(cfg.cost_red_pct ?? 0)) return { tone: 'amber', label: 'Amber', variancePct };
  return { tone: 'red', label: 'Red', variancePct };
}

export function computeOverallRag({ progress, schedule, cost }) {
  const applicable = [progress, schedule, cost].filter((r) => r && r.tone !== 'not_rated');
  if (applicable.length === 0) return { tone: 'not_rated', label: 'Not Rated' };
  let worst = { tone: 'green', label: 'Green' };
  for (const r of applicable) {
    if (TONE_ORDER[r.tone] > TONE_ORDER[worst.tone]) worst = { tone: r.tone, label: r.label };
  }
  return worst;
}

// Compute a project's RAG from raw project + tasks data.
// tasks: array of project_tasks (with status, parent_task_id, weight_pct, etc.).
// Only leaf tasks (no children) count toward progress, per spec.
export function computeProjectRag(cfg, project, tasks = []) {
  const leaves = leafTasks(tasks).filter((t) => t.status !== 'cancelled');
  const actualPct = leaves.length === 0
    ? null
    : leaves.reduce((s, t) => s + leafProgressPct(t), 0) / leaves.length;

  // BUG-17: a project with no tasks OR no schedule cannot be rated. Zero-minus-zero was falling
  // through to Green — which put empty projects (and drafts) in the "on schedule" bucket.
  const hasSchedule = !!(project?.start_date && project?.end_date);
  const hasTasks = leaves.length > 0;
  if (!hasSchedule || !hasTasks || project?.is_draft) {
    const not = { tone: 'not_rated', label: 'Not Rated', variance: null };
    return {
      progress: not,
      schedule: { tone: 'not_rated', label: 'Not Rated', slip: null },
      cost: { tone: 'not_rated', label: 'Not Rated', variancePct: null },
      overall: { tone: 'not_rated', label: 'Not Rated' },
      actualPct, plannedPct: null, baselineDurationDays: null, slipDays: null,
    };
  }

  // Planned progress: elapsed baseline days / total baseline duration × 100
  let plannedPct = null;
  let baselineDurationDays = null;
  let slipDays = null;
  if (project?.start_date && project?.end_date) {
    baselineDurationDays = daysInclusive(project.start_date, project.end_date);
    if (project.status === 'completed') {
      plannedPct = 100;
    } else if (project.actual_start_date || project.status === 'active') {
      const today = new Date();
      const start = new Date(project.actual_start_date || project.start_date);
      const elapsed = Math.max(0, daysInclusive(start, today));
      plannedPct = Math.min(100, (elapsed / baselineDurationDays) * 100);
    } else {
      plannedPct = 0;
    }
    // Slip = forecast finish − baseline finish (in days). Use actual_end_date as forecast finish if set.
    if (project.actual_end_date) {
      slipDays = daysInclusive(project.end_date, project.actual_end_date) - 1;
    } else if (project.status === 'completed') {
      slipDays = 0;
    } else {
      slipDays = null; // no forecast known yet
    }
  }

  const progress = computeProgressRag(cfg, { plannedPct, actualPct });
  const schedule = computeScheduleRag(cfg, { baselineDurationDays, slipDays });
  // Cost: needs Budget module (not built yet) → always Not Rated for now.
  const cost = computeCostRag(cfg, { approvedBudget: null, forecastAtCompletion: null });
  const overall = computeOverallRag({ progress, schedule, cost });
  return { progress, schedule, cost, overall, actualPct, plannedPct, baselineDurationDays, slipDays };
}

function leafTasks(tasks) {
  const parents = new Set();
  for (const t of tasks) if (t.parent_task_id) parents.add(t.parent_task_id);
  return tasks.filter((t) => !parents.has(t.id));
}
function leafProgressPct(t) {
  if (t.progress_metric === 'quantity' && t.quantity_value != null && Number(t.quantity_value) > 0) {
    const pct = (Number(t.actual_value ?? 0) / Number(t.quantity_value)) * 100;
    return Math.min(100, Math.max(0, pct));
  }
  return t.status === 'done' ? 100 : 0;
}
function daysInclusive(a, b) {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return 0;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}
