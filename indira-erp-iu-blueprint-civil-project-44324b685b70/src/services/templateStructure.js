import { supabase } from '../lib/supabaseClient.js';
import { upsertMasterTask } from './tasks.js';
import { upsertMasterMilestone } from './milestones.js';

export const PHASES = ['project'];
export const PHASE_LABELS = { project: 'Project Phase' };
export const METRICS = [
  { value: 'done_not_done', label: 'Done / Not Done' },
  { value: 'quantity', label: 'Quantity Based' },
  { value: 'percent', label: '% Based' },
];
export const METRIC_LABEL = Object.fromEntries(METRICS.map((m) => [m.value, m.label]));
// Recursive tree helpers — children[] can nest arbitrarily deep.
export function walkTree(nodes, visit, parent = null, depth = 0) {
  for (const n of nodes ?? []) {
    visit(n, parent, depth);
    if (n.children?.length) walkTree(n.children, visit, n, depth + 1);
  }
}
export function flattenTree(nodes) {
  const out = [];
  walkTree(nodes, (n, parent) => out.push({ node: n, parentTmpId: parent?.tmp_id ?? null }));
  return out;
}
export function mapTree(nodes, fn) {
  return (nodes ?? []).map((n) => {
    const mapped = fn(n);
    if (n.children?.length) mapped.children = mapTree(n.children, fn);
    return mapped;
  });
}
export function findInTree(nodes, tmpId) {
  for (const n of nodes ?? []) {
    if (n.tmp_id === tmpId) return n;
    const inChild = findInTree(n.children, tmpId);
    if (inChild) return inChild;
  }
  return null;
}
export function patchInTree(nodes, tmpId, patch) {
  return (nodes ?? []).map((n) => {
    if (n.tmp_id === tmpId) return { ...n, ...patch };
    if (n.children?.length) return { ...n, children: patchInTree(n.children, tmpId, patch) };
    return n;
  });
}
export function removeFromTree(nodes, tmpId) {
  const out = [];
  for (const n of nodes ?? []) {
    if (n.tmp_id === tmpId) continue;
    if (n.children?.length) out.push({ ...n, children: removeFromTree(n.children, tmpId) });
    else out.push(n);
  }
  return out;
}
// Indent = make the node a child of its previous sibling (at its current level).
// Returns { tree, changed } — changed=false if there is no previous sibling.
export function indentNode(nodes, tmpId) {
  function tryAt(list) {
    const idx = list.findIndex((n) => n.tmp_id === tmpId);
    if (idx > 0) {
      const prev = list[idx - 1];
      const node = { ...list[idx], children: list[idx].children ?? [] };
      const newPrev = { ...prev, children: [...(prev.children ?? []), node] };
      return { list: [...list.slice(0, idx - 1), newPrev, ...list.slice(idx + 1)], changed: true };
    }
    if (idx === 0) return { list, changed: false };
    for (let i = 0; i < list.length; i++) {
      if (list[i].children?.length) {
        const res = tryAt(list[i].children);
        if (res.changed) {
          const copy = [...list];
          copy[i] = { ...list[i], children: res.list };
          return { list: copy, changed: true };
        }
      }
    }
    return { list, changed: false };
  }
  const res = tryAt(nodes ?? []);
  return { tree: res.list, changed: res.changed };
}
// Outdent = promote the node one level up (becomes a sibling of its parent, placed right after it).
// Returns { tree, changed } — changed=false if the node is already at root.
export function outdentNode(nodes, tmpId) {
  function tryAt(list, grandparentList, grandparentIndex) {
    for (let i = 0; i < list.length; i++) {
      const n = list[i];
      if (n.children?.some((c) => c.tmp_id === tmpId)) {
        const promotedIdx = n.children.findIndex((c) => c.tmp_id === tmpId);
        const promoted = n.children[promotedIdx];
        const newN = { ...n, children: [...n.children.slice(0, promotedIdx), ...n.children.slice(promotedIdx + 1)] };
        if (grandparentList) {
          const gp = [...grandparentList];
          gp[grandparentIndex] = { ...gp[grandparentIndex], children: [
            ...gp[grandparentIndex].children.slice(0, i), newN, promoted, ...gp[grandparentIndex].children.slice(i + 1),
          ] };
          return { list: gp, changed: true, atRoot: false };
        }
        return {
          list: [...list.slice(0, i), newN, promoted, ...list.slice(i + 1)],
          changed: true, atRoot: false,
        };
      }
      if (n.children?.length) {
        const res = tryAt(n.children, list, i);
        if (res.changed) {
          if (res.atRoot === false && !grandparentList) return { list: res.list, changed: true, atRoot: false };
          return res;
        }
      }
    }
    return { list, changed: false, atRoot: false };
  }
  const res = tryAt(nodes ?? [], null, -1);
  return { tree: res.list, changed: res.changed };
}
// Rebalance the direct children of a parent node so weights sum to parentTotal (integers).
export function rebalanceChildren(parentTotal, children) {
  if (!children?.length) return children;
  const parts = equalSplitInt(children.length, Math.round(Number(parentTotal) || 0));
  return children.map((c, i) => {
    const newW = parts[i] ?? 0;
    if (c.children?.length && newW !== Number(c.weight_pct)) {
      return { ...c, weight_pct: newW, children: rebalanceChildren(newW, c.children) };
    }
    return { ...c, weight_pct: newW };
  });
}

export async function loadStructure(versionId) {
  const [tasksRes, msRes, depsRes] = await Promise.all([
    supabase.from('template_tasks').select('*').eq('version_id', versionId).order('sort_order', { ascending: true }),
    supabase.from('template_milestones').select('*').eq('version_id', versionId).order('sort_order', { ascending: true }),
    supabase.from('template_task_dependencies').select('*').eq('version_id', versionId),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (msRes.error) throw msRes.error;
  if (depsRes.error) throw depsRes.error;
  return {
    tasks: tasksRes.data ?? [],
    milestones: msRes.data ?? [],
    dependencies: depsRes.data ?? [],
  };
}

export async function loadMasterOptions(templateId) {
  const [tasksRes, msRes] = await Promise.all([
    supabase.from('tasks').select('id, name, phase, parent_task_id').eq('project_template_id', templateId),
    supabase.from('milestones').select('id, name, phase').eq('project_template_id', templateId),
  ]);
  const tasks = tasksRes.data ?? [];
  const milestones = msRes.data ?? [];
  return {
    rootTaskNamesByPhase: groupNames(tasks.filter((t) => !t.parent_task_id)),
    subtaskNamesByPhase: groupNames(tasks.filter((t) => t.parent_task_id)),
    milestoneNamesByPhase: groupNames(milestones),
  };
}

function groupNames(rows) {
  const out = { project: [] };
  for (const r of rows) out.project.push(r.name);
  out.project = [...new Set(out.project)].sort();
  return out;
}

export async function saveStructure(versionId, templateId, { tasks, milestones, dependencies }, { updatedBy } = {}) {
  const actorId = updatedBy ?? null;
  const delDeps = await supabase.from('template_task_dependencies').delete().eq('version_id', versionId);
  if (delDeps.error) throw delDeps.error;
  const delMs = await supabase.from('template_milestones').delete().eq('version_id', versionId);
  if (delMs.error) throw delMs.error;
  const delTasks = await supabase.from('template_tasks').delete().eq('version_id', versionId);
  if (delTasks.error) throw delTasks.error;

  // Insert level by level so each row's parent already exists in the DB.
  const idByTmp = new Map();
  const masterByTmp = new Map();
  const remaining = new Set(tasks.map((_, i) => i));
  let sortCounter = 0;
  while (remaining.size) {
    const ready = [...remaining].filter((i) => {
      const t = tasks[i];
      return !t.parent_tmp_id || idByTmp.has(t.parent_tmp_id);
    });
    if (!ready.length) throw new Error('Template task tree has an orphan parent reference.');

    if (templateId) {
      for (const i of ready) {
        const t = tasks[i];
        const parentMasterId = t.parent_tmp_id ? masterByTmp.get(t.parent_tmp_id) ?? null : null;
        const master = await upsertMasterTask({
          templateId, phase: t.phase, name: t.name, parentTaskId: parentMasterId, createdBy: actorId,
        });
        masterByTmp.set(t.tmp_id, master.id);
      }
    }

    const rows = ready.map((i) => {
      const t = tasks[i];
      return {
        version_id: versionId,
        phase: t.phase,
        parent_task_id: t.parent_tmp_id ? idByTmp.get(t.parent_tmp_id) ?? null : null,
        task_type: t.task_type === 'summary' ? 'summary' : 'task',
        name: t.name.trim(),
        is_mandatory: !!t.is_mandatory,
        weight_pct: Number(t.weight_pct) || 0,
        progress_metric: t.progress_metric ?? 'done_not_done',
        quantity_value: null,
        quantity_unit: null,
        master_task_id: masterByTmp.get(t.tmp_id) ?? null,
        sort_order: sortCounter++,
      };
    });
    const { data, error } = await supabase.from('template_tasks').insert(rows).select('id');
    if (error) throw error;
    data.forEach((row, k) => idByTmp.set(tasks[ready[k]].tmp_id, row.id));
    for (const i of ready) remaining.delete(i);
  }

  if (milestones.length) {
    const masterMsIds = new Map();
    if (templateId) {
      for (const m of milestones) {
        const master = await upsertMasterMilestone({ templateId, phase: m.phase, name: m.name, createdBy: actorId });
        masterMsIds.set(m.tmp_id, master.id);
      }
    }
    const rows = milestones.map((m, i) => ({
      version_id: versionId,
      phase: m.phase,
      name: m.name.trim(),
      sort_order: i,
      master_milestone_id: masterMsIds.get(m.tmp_id) ?? null,
    }));
    const { error } = await supabase.from('template_milestones').insert(rows);
    if (error) throw error;
  }

  if (dependencies?.length) {
    const depRows = [];
    for (const d of dependencies) {
      const from = idByTmp.get(d.task_tmp_id);
      const to = idByTmp.get(d.depends_on_tmp_id);
      if (from && to && from !== to) depRows.push({ version_id: versionId, task_id: from, depends_on_task_id: to });
    }
    if (depRows.length) {
      const { error } = await supabase.from('template_task_dependencies').insert(depRows);
      if (error) throw error;
    }
  }

  const { error: stampErr } = await supabase
    .from('template_versions')
    .update({ updated_at: new Date().toISOString(), updated_by: actorId })
    .eq('id', versionId);
  if (stampErr) throw stampErr;
}

export function equalSplit(count) {
  if (count <= 0) return [];
  const each = Math.floor((10000 / count)) / 100;
  const arr = new Array(count).fill(each);
  const remainder = Number((100 - each * count).toFixed(2));
  if (remainder !== 0 && arr.length) arr[arr.length - 1] = Number((arr[arr.length - 1] + remainder).toFixed(2));
  return arr;
}

export function equalSplitInt(count, total = 100) {
  if (count <= 0) return [];
  const t = Math.max(0, Math.round(Number(total) || 0));
  const base = Math.floor(t / count);
  const arr = new Array(count).fill(base);
  let remainder = t - base * count;
  for (let i = 0; i < count && remainder > 0; i++) {
    arr[i] += 1;
    remainder -= 1;
  }
  return arr;
}

export function sumWeights(items) {
  return Number(items.reduce((s, i) => s + (Number(i.weight_pct) || 0), 0).toFixed(2));
}

export function hasCycle(taskIds, edges) {
  const adj = new Map(taskIds.map((id) => [id, []]));
  for (const [from, to] of edges) {
    if (adj.has(from)) adj.get(from).push(to);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(taskIds.map((id) => [id, WHITE]));
  function dfs(id) {
    color.set(id, GRAY);
    for (const nxt of adj.get(id) ?? []) {
      const c = color.get(nxt);
      if (c === GRAY) return true;
      if (c === WHITE && dfs(nxt)) return true;
    }
    color.set(id, BLACK);
    return false;
  }
  for (const id of taskIds) {
    if (color.get(id) === WHITE && dfs(id)) return true;
  }
  return false;
}

function makeError(fields) {
  const err = { ...fields };
  err.toString = function () { return this.message; };
  return err;
}

function validateNodesRecursive(nodes, errors, parent) {
  const seen = new Set();
  for (const n of nodes) {
    const label = n.name.trim() ? `"${n.name.trim()}"` : (parent ? 'an unnamed subtask' : 'an unnamed task');
    const errShape = parent
      ? { phase: 'project', taskTmpId: parent.tmp_id, subTmpId: n.tmp_id }
      : { phase: 'project', taskTmpId: n.tmp_id };
    if (!n.name.trim()) {
      errors.push(makeError({
        code: parent ? 'subtask_missing_name' : 'task_missing_name', ...errShape,
        field: 'name', message: parent ? 'Subtask name is required.' : 'Task name is required.',
      }));
    }
    const key = n.name.trim().toLowerCase();
    if (key && seen.has(key)) {
      errors.push(makeError({
        code: parent ? 'subtask_duplicate_name' : 'task_duplicate_name', ...errShape,
        field: 'name',
        message: parent
          ? `Duplicate subtask "${n.name.trim()}" — names must be unique within a parent.`
          : `Duplicate task name "${n.name.trim()}" — task names must be unique.`,
      }));
    }
    seen.add(key);
    if (n.children?.length) {
      const childTotal = sumWeights(n.children);
      if (Math.abs(childTotal - Number(n.weight_pct)) > 0.01) {
        errors.push(makeError({
          code: 'subtask_weight_sum', phase: 'project', taskTmpId: n.tmp_id,
          field: 'weight_pct',
          message: `Children of ${label} add up to ${childTotal}% — they must total ${n.weight_pct}% to match the parent's weight.`,
        }));
      }
      validateNodesRecursive(n.children, errors, n);
    }
  }
}

export function validateStructure(state, dependencies = []) {
  const errors = [];
  const phase = state.project ?? { tasks: [], milestones: [] };
  const rootTasks = phase.tasks;
  if (rootTasks.length > 0) {
    const total = sumWeights(rootTasks);
    if (Math.abs(total - 100) > 0.01) {
      errors.push(makeError({
        code: 'phase_weight_sum', phase: 'project',
        message: `Tasks add up to ${total}% — they must total exactly 100%.`,
      }));
    }
  }
  validateNodesRecursive(rootTasks, errors, null);
  const seenMs = new Set();
  for (const m of phase.milestones ?? []) {
    if (!m.name.trim()) {
      errors.push(makeError({
        code: 'milestone_missing_name', phase: 'project', milestoneTmpId: m.tmp_id,
        field: 'name', message: `Milestone name is required.`,
      }));
    }
    const mk = m.name.trim().toLowerCase();
    if (mk && seenMs.has(mk)) {
      errors.push(makeError({
        code: 'milestone_duplicate_name', phase: 'project', milestoneTmpId: m.tmp_id,
        field: 'name',
        message: `Duplicate milestone "${m.name.trim()}" — milestone names must be unique.`,
      }));
    }
    seenMs.add(mk);
  }

  const allTaskTmpIds = rootTasks.map((t) => t.tmp_id);
  const orderIndex = new Map();
  rootTasks.forEach((t, i) => orderIndex.set(t.tmp_id, i));
  const taskById = new Map();
  for (const t of rootTasks) taskById.set(t.tmp_id, t);

  for (const d of dependencies) {
    if (d.task_tmp_id === d.depends_on_tmp_id) {
      errors.push(makeError({
        code: 'dep_self', taskTmpId: d.task_tmp_id, field: 'deps',
        message: 'A task cannot depend on itself. Remove that dependency link.',
      }));
      continue;
    }
    const a = taskById.get(d.task_tmp_id);
    const b = taskById.get(d.depends_on_tmp_id);
    if (!a || !b) continue;
    const aLabel = a.name.trim() ? `"${a.name.trim()}"` : 'an unnamed task';
    const bLabel = b.name.trim() ? `"${b.name.trim()}"` : 'an unnamed task';
    if ((orderIndex.get(b.tmp_id) ?? 0) >= (orderIndex.get(a.tmp_id) ?? 0)) {
      errors.push(makeError({
        code: 'dep_wrong_order', taskTmpId: a.tmp_id, dependsOnTmpId: b.tmp_id, field: 'deps',
        message: `${aLabel} can only depend on tasks listed above it. ${bLabel} is not above ${aLabel}.`,
      }));
    }
  }
  const edges = dependencies.map((d) => [d.task_tmp_id, d.depends_on_tmp_id]);
  if (hasCycle(allTaskTmpIds, edges)) {
    errors.push(makeError({
      code: 'dep_cycle',
      message: 'Some tasks depend on each other in a loop. Break the loop before saving.',
    }));
  }

  return errors;
}

export function flattenForSave(state, dependencies = []) {
  const tasks = [];
  const milestones = [];
  function pushTree(nodes, parentTmpId) {
    for (const n of nodes ?? []) {
      const hasKids = (n.children?.length ?? 0) > 0;
      tasks.push({
        tmp_id: n.tmp_id, parent_tmp_id: parentTmpId, phase: 'project',
        task_type: hasKids ? 'summary' : 'task',
        name: n.name, is_mandatory: n.is_mandatory ?? true, weight_pct: n.weight_pct,
        progress_metric: n.progress_metric ?? 'done_not_done',
        quantity_value: n.quantity_value, quantity_unit: n.quantity_unit,
      });
      if (hasKids) pushTree(n.children, n.tmp_id);
    }
  }
  const phase = state.project ?? { tasks: [], milestones: [] };
  pushTree(phase.tasks, null);
  for (const m of phase.milestones ?? []) {
    milestones.push({ tmp_id: m.tmp_id, phase: 'project', name: m.name });
  }
  return { tasks, milestones, dependencies };
}

// Legacy pre_project rows (from before the phase concept was removed) are coerced into the single project bucket.
export function inflateFromDb({ tasks, milestones, dependencies = [] }) {
  const state = { project: { tasks: [], milestones: [] } };
  const byId = new Map();
  for (const t of tasks) {
    byId.set(t.id, { ...t, phase: 'project', task_type: t.task_type ?? 'task', tmp_id: t.id, children: [] });
  }
  for (const t of tasks) {
    const node = byId.get(t.id);
    if (t.parent_task_id && byId.has(t.parent_task_id)) {
      byId.get(t.parent_task_id).children.push(node);
    } else {
      state.project.tasks.push(node);
    }
  }
  for (const m of milestones) {
    state.project.milestones.push({ ...m, phase: 'project', tmp_id: m.id });
  }
  const deps = dependencies.map((d) => ({ task_tmp_id: d.task_id, depends_on_tmp_id: d.depends_on_task_id }));
  return { state, dependencies: deps };
}

// Build a Gantt schedule from the dependency graph, keyed by tmp_id.
// Each leaf task takes 1 "step" (no dates at template stage). A leaf starts at
// (max end of its deps) + 1; if it has no deps, it starts at 1. Summaries span
// their descendants' [min start, max end].
// Also returns rowOrder — the pre-order tmp_id sequence matching the left tree.
export function computeSchedule(state, dependencies) {
  const rowOrder = [];
  const rowIndex = new Map();
  const isLeaf = new Map();
  for (const phase of PHASES) {
    walkTree(state[phase].tasks, (n) => {
      rowIndex.set(n.tmp_id, rowOrder.length);
      rowOrder.push(n.tmp_id);
      isLeaf.set(n.tmp_id, (n.children?.length ?? 0) === 0);
    });
  }
  const deps = new Map();
  for (const d of dependencies) {
    if (!deps.has(d.task_tmp_id)) deps.set(d.task_tmp_id, []);
    deps.get(d.task_tmp_id).push(d.depends_on_tmp_id);
  }
  const bars = new Map();
  const seen = new Set();
  function leafStart(tmpId) {
    if (bars.has(tmpId)) return bars.get(tmpId).start;
    if (seen.has(tmpId)) return 1;
    seen.add(tmpId);
    const ds = deps.get(tmpId) ?? [];
    let earliest = 1;
    for (const d of ds) {
      if (!isLeaf.get(d)) continue;
      const dEnd = leafEnd(d);
      if (dEnd + 1 > earliest) earliest = dEnd + 1;
    }
    const start = earliest;
    const end = start;
    bars.set(tmpId, { start, end, row: rowIndex.get(tmpId), isSummary: false });
    return start;
  }
  function leafEnd(tmpId) { leafStart(tmpId); return bars.get(tmpId).end; }
  for (const [tmpId, leaf] of isLeaf) if (leaf) leafStart(tmpId);

  function coverSummary(node) {
    if (!node.children?.length) return null;
    let s = Infinity, e = -Infinity;
    for (const c of node.children) {
      let cSpan;
      if (c.children?.length) cSpan = coverSummary(c);
      else cSpan = bars.get(c.tmp_id) ?? null;
      if (!cSpan) continue;
      if (cSpan.start < s) s = cSpan.start;
      if (cSpan.end > e) e = cSpan.end;
    }
    if (s === Infinity) { s = 1; e = 1; }
    const bar = { start: s, end: e, row: rowIndex.get(node.tmp_id), isSummary: true };
    bars.set(node.tmp_id, bar);
    return bar;
  }
  for (const phase of PHASES) for (const t of state[phase].tasks) coverSummary(t);

  let maxStep = 1;
  for (const b of bars.values()) if (b.end > maxStep) maxStep = b.end;
  return { bars, rowOrder, maxStep };
}
