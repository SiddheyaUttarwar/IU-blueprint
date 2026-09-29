import { supabase } from '../lib/supabaseClient.js';
import { audit } from '../lib/audit.js';
import { notifyMany } from '../lib/notify.js';
import { loadStructure } from './templateStructure.js';

const PROJECT_SELECT = `
  id, name, description, project_class, status, is_draft, start_date, end_date, baseline_days, actual_start_date, actual_end_date, approver_ids, created_at,
  project_templates ( id, name, project_types ( id, name ) ),
  project_types ( id, name ),
  template_versions ( id, version_no ),
  campuses ( id, name ),
  schools ( id, name ),
  project_manager:profiles!projects_project_manager_id_fkey ( id, first_name, last_name, email ),
  created_by_profile:profiles!projects_created_by_fkey ( id, first_name, last_name, email ),
  rag_rules ( id, name, green_min_pct, amber_min_pct, updated_at )
`;

export async function listProjects() {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAllProjectTasksLite() {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id, project_id, parent_task_id, status, progress_metric, quantity_value, actual_value, start_date, end_date, actual_start_date, actual_completion_date');
  if (error) throw error;
  return data ?? [];
}

export async function getProject(id) {
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_SELECT)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function getProjectStructure(projectId) {
  const [tasksRes, milestonesRes, depsRes] = await Promise.all([
    supabase
      .from('project_tasks')
      .select('id, project_id, phase, parent_task_id, task_type, name, is_mandatory, weight_pct, progress_metric, quantity_value, quantity_unit, actual_value, status, start_date, end_date, actual_start_date, actual_completion_date, sort_order, assigned_to, assigned_to_ids')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('project_milestones')
      .select('*')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('project_task_dependencies')
      .select('*')
      .eq('project_id', projectId),
  ]);
  if (tasksRes.error) throw tasksRes.error;
  if (milestonesRes.error) throw milestonesRes.error;
  if (depsRes.error) throw depsRes.error;
  return {
    tasks: tasksRes.data ?? [],
    milestones: milestonesRes.data ?? [],
    dependencies: depsRes.data ?? [],
  };
}

// Patch a project's editable fields (name, description, dates, PM, RAG, campus, school).
export async function updateProject(id, patch, { actorId } = {}) {
  const cleaned = { ...patch, updated_at: new Date().toISOString() };
  if (cleaned.name !== undefined) cleaned.name = (cleaned.name ?? '').trim();
  // BUG-14: reject impossible date windows at the project level. Load the current row so a
  // partial patch (e.g. only end_date) is compared against the effective start_date.
  if ('start_date' in cleaned || 'end_date' in cleaned || 'actual_start_date' in cleaned || 'actual_end_date' in cleaned) {
    const { data: before } = await supabase.from('projects').select('start_date, end_date, actual_start_date, actual_end_date').eq('id', id).single();
    const s  = 'start_date' in cleaned ? cleaned.start_date : before?.start_date;
    const e  = 'end_date' in cleaned ? cleaned.end_date : before?.end_date;
    if (s && e && e < s) throw new Error(`Planned end (${e}) cannot be before planned start (${s}).`);
    const as = 'actual_start_date' in cleaned ? cleaned.actual_start_date : before?.actual_start_date;
    const ae = 'actual_end_date' in cleaned ? cleaned.actual_end_date : before?.actual_end_date;
    if (as && ae && ae < as) throw new Error(`Actual end (${ae}) cannot be before actual start (${as}).`);
  }
  const { data, error } = await supabase
    .from('projects').update(cleaned).eq('id', id).select(PROJECT_SELECT).single();
  if (error) throw error;
  audit({ actorId, action: 'update', entityType: 'project', entityId: id, after: data });
  return data;
}

export async function createProject({
  name, description, projectClass,
  templateId, templateVersionId, projectTypeId,
  campusId, schoolId, locationTagId, projectManagerId, ragRuleId,
  startDate, endDate, baselineDays, createdBy,
  customStructure = null,
  approverIds = [],
  isDraft = false,
}) {
  const trimmed = (name ?? '').trim();
  // Drafts have relaxed validation — only a name is required so the user can come back later.
  if (isDraft) {
    if (!trimmed) throw new Error('Project name is required (even for a draft).');
  } else {
    if (!trimmed) throw new Error('Project name is required.');
    if (!projectClass) throw new Error('Please select Greenfield or Brownfield.');
    const isBlank = !templateId || !templateVersionId;
    if (isBlank && !projectTypeId) throw new Error('Project type is required when no template is selected.');
  }

  // Derive project type from template when one is chosen (unless caller passed explicit)
  let resolvedProjectTypeId = projectTypeId ?? null;
  if (templateId && !resolvedProjectTypeId) {
    const { data: t } = await supabase.from('project_templates').select('project_type_id').eq('id', templateId).maybeSingle();
    resolvedProjectTypeId = t?.project_type_id ?? null;
  }

  const { data: project, error: pErr } = await supabase
    .from('projects')
    .insert({
      name: trimmed,
      description: description?.trim() || null,
      project_class: projectClass,
      template_id: templateId || null,
      template_version_id: templateVersionId || null,
      project_type_id: resolvedProjectTypeId,
      campus_id: campusId ?? null,
      school_id: schoolId ?? null,
      location_tag_id: locationTagId ?? null,
      project_manager_id: projectManagerId ?? null,
      rag_rule_id: ragRuleId ?? null,
      start_date: startDate || null,
      end_date: endDate || null,
      baseline_days: Number.isFinite(Number(baselineDays)) && Number(baselineDays) > 0 ? Math.round(Number(baselineDays)) : null,
      approver_ids: Array.isArray(approverIds) ? approverIds.filter(Boolean) : [],
      status: 'planning',
      created_by: createdBy ?? null,
      is_draft: !!isDraft,
    })
    .select('id')
    .single();
  if (pErr) {
    if (pErr.code === '23505') throw new Error('A project with this name already exists.');
    throw pErr;
  }

  try {
    if (customStructure) {
      // Persist whatever the wizard built (works for both final save AND draft — draft used to
      // silently discard the WBS, see BUG-01). Blank drafts pass no customStructure.
      await insertCustomStructure(project.id, customStructure);
    } else if (isDraft) {
      // Draft with no WBS yet — nothing to inflate. User will finalize later.
    } else if (!templateId || !templateVersionId) {
      // Blank final save: no template to inflate.
    } else {
      await snapshotTemplateIntoProject(project.id, templateVersionId);
    }
  } catch (err) {
    await supabase.from('projects').delete().eq('id', project.id);
    throw err;
  }
  return project;
}

async function insertCustomStructure(projectId, custom) {
  const tmpToId = new Map();
  const remaining = new Set(custom.tasks.map((_, i) => i));
  let sortCounter = 0;
  while (remaining.size) {
    const ready = [...remaining].filter((i) => {
      const t = custom.tasks[i];
      return !t.parent_tmp_id || tmpToId.has(t.parent_tmp_id);
    });
    if (!ready.length) throw new Error('Custom structure has an orphan parent reference.');
    const rows = ready.map((i) => {
      const t = custom.tasks[i];
      return {
        project_id: projectId,
        phase: t.phase,
        parent_task_id: t.parent_tmp_id ? tmpToId.get(t.parent_tmp_id) ?? null : null,
        source_template_task_id: t.source_template_task_id ?? null,
        task_type: t.task_type === 'summary' ? 'summary' : 'task',
        name: (t.name ?? '').trim(),
        is_mandatory: !!t.is_mandatory,
        weight_pct: Number(t.weight_pct) || 0,
        progress_metric: t.progress_metric ?? 'done_not_done',
        quantity_value: t.quantity_value ?? null,
        quantity_unit: t.quantity_unit ?? null,
        assigned_to: (Array.isArray(t.assigned_to_ids) && t.assigned_to_ids[0]) || t.assigned_to || null,
        assigned_to_ids: Array.isArray(t.assigned_to_ids) ? t.assigned_to_ids : [],
        start_date: t.start_date || null,
        end_date: t.end_date || null,
        sort_order: t.sort_order ?? sortCounter++,
      };
    });
    const { data, error } = await supabase.from('project_tasks').insert(rows).select('id');
    if (error) throw error;
    data.forEach((row, k) => tmpToId.set(custom.tasks[ready[k]].tmp_id, row.id));
    for (const i of ready) remaining.delete(i);
  }

  if (custom.dependencies?.length) {
    const depRows = [];
    for (const d of custom.dependencies) {
      const from = tmpToId.get(d.task_tmp_id);
      const to = tmpToId.get(d.depends_on_tmp_id);
      if (from && to && from !== to) depRows.push({ project_id: projectId, task_id: from, depends_on_task_id: to });
    }
    if (depRows.length) {
      const { error } = await supabase.from('project_task_dependencies').insert(depRows);
      if (error) throw error;
    }
  }

  if (custom.milestones?.length) {
    const rows = custom.milestones.map((m, i) => ({
      project_id: projectId,
      phase: m.phase,
      source_template_milestone_id: m.source_template_milestone_id ?? null,
      name: (m.name ?? '').trim(),
      target_date: m.target_date || null,
      sort_order: m.sort_order ?? i,
    }));
    const { error } = await supabase.from('project_milestones').insert(rows);
    if (error) throw error;
  }

  // Seed the original plan into project_task_baselines so the header timeline
  // can show a baseline pill even before any date change. Non-blocking on failure.
  const initialBaselines = [];
  for (const t of custom.tasks) {
    const taskId = tmpToId.get(t.tmp_id);
    if (!taskId) continue;
    if (!t.start_date && !t.end_date) continue;
    initialBaselines.push({
      project_id: projectId,
      task_id: taskId,
      snapshot_start: t.start_date || null,
      snapshot_end: t.end_date || null,
      reason: 'initial_plan',
    });
  }
  if (initialBaselines.length) {
    const { error } = await supabase.from('project_task_baselines').insert(initialBaselines);
    if (error) console.warn('Initial baseline seed failed (non-blocking):', error);
  }
}

async function snapshotTemplateIntoProject(projectId, versionId) {
  const structure = await loadStructure(versionId);
  const templateToProjectTaskId = new Map();
  const remaining = new Set(structure.tasks.map((_, i) => i));
  let sortCounter = 0;
  while (remaining.size) {
    const ready = [...remaining].filter((i) => {
      const t = structure.tasks[i];
      return !t.parent_task_id || templateToProjectTaskId.has(t.parent_task_id);
    });
    if (!ready.length) throw new Error('Template tasks have an orphan parent reference.');
    const rows = ready.map((i) => {
      const t = structure.tasks[i];
      return {
        project_id: projectId,
        phase: t.phase,
        parent_task_id: t.parent_task_id ? templateToProjectTaskId.get(t.parent_task_id) ?? null : null,
        source_template_task_id: t.id,
        task_type: t.task_type === 'summary' ? 'summary' : 'task',
        name: t.name,
        is_mandatory: t.is_mandatory,
        weight_pct: t.weight_pct,
        progress_metric: t.progress_metric,
        quantity_value: t.quantity_value,
        quantity_unit: t.quantity_unit,
        sort_order: t.sort_order ?? sortCounter++,
      };
    });
    const { data, error } = await supabase.from('project_tasks').insert(rows).select('id, source_template_task_id');
    if (error) throw error;
    for (const r of data) if (r.source_template_task_id) templateToProjectTaskId.set(r.source_template_task_id, r.id);
    for (const i of ready) remaining.delete(i);
  }

  if (structure.dependencies?.length) {
    const depRows = [];
    for (const d of structure.dependencies) {
      const from = templateToProjectTaskId.get(d.task_id);
      const to = templateToProjectTaskId.get(d.depends_on_task_id);
      if (from && to && from !== to) depRows.push({ project_id: projectId, task_id: from, depends_on_task_id: to });
    }
    if (depRows.length) {
      const { error } = await supabase.from('project_task_dependencies').insert(depRows);
      if (error) throw error;
    }
  }

  if (structure.milestones.length) {
    const rows = structure.milestones.map((m, i) => ({
      project_id: projectId,
      phase: m.phase,
      source_template_milestone_id: m.id,
      name: m.name,
      sort_order: m.sort_order ?? i,
    }));
    const { error } = await supabase.from('project_milestones').insert(rows);
    if (error) throw error;
  }
}

export async function removeProject(id) {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

async function assertNotCompleted(projectId) {
  const { data } = await supabase.from('projects').select('status').eq('id', projectId).single();
  if (data?.status === 'completed') {
    throw new Error('Project is Completed. Only budget entries can be edited after completion.');
  }
}

export async function createProjectTask(projectId, {
  phase, parentTaskId = null, name, weightPct = 0,
  startDate = null, endDate = null, assignedToIds = [],
  progressMetric = 'done_not_done', quantityValue = null, quantityUnit = null,
  isMandatory = true, actorId = null,
}) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Task name is required.');
  if (!['pre_project', 'project'].includes(phase)) throw new Error('Invalid phase.');
  await assertNotCompleted(projectId);
  const sortOrder = Date.now() % 100000;
  const { data, error } = await supabase.from('project_tasks').insert({
    project_id: projectId,
    phase,
    parent_task_id: parentTaskId,
    name: trimmed,
    weight_pct: Number(weightPct) || 0,
    start_date: startDate || null,
    end_date: endDate || null,
    assigned_to: Array.isArray(assignedToIds) && assignedToIds.length ? assignedToIds[0] : null,
    assigned_to_ids: Array.isArray(assignedToIds) ? assignedToIds : [],
    progress_metric: progressMetric,
    quantity_value: quantityValue,
    quantity_unit: quantityUnit,
    is_mandatory: !!isMandatory,
    sort_order: sortOrder,
  }).select('*').single();
  if (error) throw error;
  audit({
    actorId, action: 'create', entityType: parentTaskId ? 'subtask' : 'task', entityId: data.id,
    after: data, context: { project_id: projectId, parent_task_id: parentTaskId },
  });
  return data;
}

export async function removeProjectTask(taskId, { actorId } = {}) {
  const { data: before } = await supabase.from('project_tasks').select('*').eq('id', taskId).single();
  if (before?.project_id) await assertNotCompleted(before.project_id);
  const { error } = await supabase.from('project_tasks').delete().eq('id', taskId);
  if (error) throw error;
  audit({ actorId, action: 'delete', entityType: 'task', entityId: taskId, before, context: { project_id: before?.project_id } });
}

export async function createProjectMilestone(projectId, { phase, name, targetDate = null, actorId = null }) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Milestone name is required.');
  if (!['pre_project', 'project'].includes(phase)) throw new Error('Invalid phase.');
  await assertNotCompleted(projectId);
  const { data, error } = await supabase.from('project_milestones').insert({
    project_id: projectId,
    phase,
    name: trimmed,
    target_date: targetDate || null,
    sort_order: Date.now() % 100000,
  }).select('*').single();
  if (error) throw error;
  audit({ actorId, action: 'create', entityType: 'milestone', entityId: data.id, after: data, context: { project_id: projectId } });
  return data;
}

export async function addTaskDependency(projectId, taskId, dependsOnTaskId, { actorId } = {}) {
  if (taskId === dependsOnTaskId) throw new Error('A task cannot depend on itself.');
  await assertNotCompleted(projectId);
  // Cycle check: does dependsOnTaskId (transitively) depend on taskId already?
  const { data: allDeps } = await supabase
    .from('project_task_dependencies')
    .select('task_id, depends_on_task_id')
    .eq('project_id', projectId);
  const graph = new Map();
  for (const d of allDeps ?? []) {
    if (!graph.has(d.task_id)) graph.set(d.task_id, new Set());
    graph.get(d.task_id).add(d.depends_on_task_id);
  }
  // Would-be edge: taskId -> dependsOnTaskId. Cycle exists if dependsOnTaskId can reach taskId.
  const visited = new Set();
  const stack = [dependsOnTaskId];
  while (stack.length) {
    const node = stack.pop();
    if (node === taskId) throw new Error('Adding this dependency would create a cycle.');
    if (visited.has(node)) continue;
    visited.add(node);
    for (const next of (graph.get(node) ?? [])) stack.push(next);
  }
  const { error } = await supabase.from('project_task_dependencies').insert({
    project_id: projectId, task_id: taskId, depends_on_task_id: dependsOnTaskId,
  });
  if (error) {
    if (error.code === '23505') throw new Error('That dependency already exists.');
    throw error;
  }
  audit({ actorId, action: 'create', entityType: 'task_dependency', entityId: taskId,
    after: { depends_on_task_id: dependsOnTaskId }, context: { project_id: projectId } });
}

export async function removeTaskDependency(projectId, taskId, dependsOnTaskId, { actorId } = {}) {
  await assertNotCompleted(projectId);
  const { error } = await supabase
    .from('project_task_dependencies')
    .delete()
    .eq('project_id', projectId)
    .eq('task_id', taskId)
    .eq('depends_on_task_id', dependsOnTaskId);
  if (error) throw error;
  audit({ actorId, action: 'delete', entityType: 'task_dependency', entityId: taskId,
    before: { depends_on_task_id: dependsOnTaskId }, context: { project_id: projectId } });
}

export async function removeProjectMilestone(id, { actorId } = {}) {
  const { data: before } = await supabase.from('project_milestones').select('*').eq('id', id).single();
  if (before?.project_id) await assertNotCompleted(before.project_id);
  const { error } = await supabase.from('project_milestones').delete().eq('id', id);
  if (error) throw error;
  audit({ actorId, action: 'delete', entityType: 'milestone', entityId: id, before, context: { project_id: before?.project_id } });
}

const ALLOWED_STATUSES = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
export async function updateProjectStatus(id, status, { actorId, reason } = {}) {
  if (!ALLOWED_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);
  const { data: before } = await supabase.from('projects').select('status, name').eq('id', id).single();
  const { error } = await supabase
    .from('projects')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
  audit({
    actorId, action: 'status_change', entityType: 'project', entityId: id,
    before: before ?? null, after: { status },
    context: reason ? { reason } : null,
  });
  // Notify all assignees when the project transitions into 'active' for the first time.
  if (status === 'active' && before?.status !== 'active') {
    try { await notifyAssigneesOnProjectStart(id, before?.name); } catch (err) { console.warn('assignee notify failed', err?.message ?? err); }
  }
}

async function notifyAssigneesOnProjectStart(projectId, projectName) {
  const { data: tasks } = await supabase
    .from('project_tasks')
    .select('id, name, parent_task_id, assigned_to_ids')
    .eq('project_id', projectId);
  if (!tasks?.length) return;
  // Aggregate per-profile the tasks + subtasks they're on
  const byProfile = new Map();
  for (const t of tasks) {
    for (const pid of (t.assigned_to_ids ?? [])) {
      if (!byProfile.has(pid)) byProfile.set(pid, { tasks: [], subs: [] });
      const entry = byProfile.get(pid);
      if (t.parent_task_id) entry.subs.push(t.name); else entry.tasks.push(t.name);
    }
  }
  const rows = [];
  for (const [pid, { tasks: ts, subs }] of byProfile) {
    const summary = [
      `Project "${projectName}" has been started.`,
      ts.length ? `Assigned Tasks: ${ts.slice(0, 5).join(', ')}${ts.length > 5 ? `, +${ts.length - 5} more` : ''}` : '',
      subs.length ? `Assigned Subtasks: ${subs.slice(0, 5).join(', ')}${subs.length > 5 ? `, +${subs.length - 5} more` : ''}` : '',
      `#project=${projectId}`,
    ].filter(Boolean).join('\n');
    rows.push({
      recipient_profile_id: pid,
      type: 'project_started',
      message: summary,
      email: true,
    });
  }
  if (rows.length) await notifyMany(rows);
}

// Fields that only make sense on a leaf Task — writing them on a Summary row is rejected.
const SUMMARY_FORBIDDEN_FIELDS = new Set([
  'status', 'assigned_to', 'assigned_to_ids',
  'start_date', 'end_date',
  'actual_start_date', 'actual_completion_date',
  'actual_value', 'progress_metric',
  'quantity_value', 'quantity_unit',
]);

async function isSummaryTask(taskId) {
  const { count } = await supabase
    .from('project_tasks').select('id', { count: 'exact', head: true })
    .eq('parent_task_id', taskId);
  return (count ?? 0) > 0;
}
async function assertNotSummary(taskId, context) {
  if (await isSummaryTask(taskId)) {
    throw new Error(`This is a Summary row — ${context} is rolled up from its children and cannot be edited directly.`);
  }
}

export async function patchTask(taskId, patch, { actorId } = {}) {
  const cleaned = { ...patch, updated_at: new Date().toISOString() };
  if (cleaned.assigned_to_ids && Array.isArray(cleaned.assigned_to_ids)) {
    cleaned.assigned_to = cleaned.assigned_to_ids[0] ?? null;
  }
  const { data: before } = await supabase.from('project_tasks').select('*').eq('id', taskId).single();
  if (before?.project_id) await assertNotCompleted(before.project_id);

  // Guard: Summary rows reject writes to operational fields.
  const touchesForbidden = Object.keys(patch).some((k) => SUMMARY_FORBIDDEN_FIELDS.has(k));
  if (touchesForbidden) await assertNotSummary(taskId, Object.keys(patch).filter((k) => SUMMARY_FORBIDDEN_FIELDS.has(k)).join(' / '));

  // Monotonic lock: actual_value can only increase (progress never regresses).
  if ('actual_value' in patch && before && before.actual_value != null && patch.actual_value != null
      && Number(patch.actual_value) < Number(before.actual_value)) {
    throw new Error(`Progress can only go up. Current: ${before.actual_value}, tried to set: ${patch.actual_value}.`);
  }

  // BUG-14: reject impossible date ranges on task fields — planned and actual. Use the effective
  // after-patch values so partial patches (e.g. only end_date) compare against the current start.
  const effStart = 'start_date' in cleaned ? cleaned.start_date : before?.start_date;
  const effEnd   = 'end_date' in cleaned ? cleaned.end_date : before?.end_date;
  if (effStart && effEnd && effEnd < effStart) {
    throw new Error(`Planned end (${effEnd}) cannot be before planned start (${effStart}).`);
  }
  const effActStart = 'actual_start_date' in cleaned ? cleaned.actual_start_date : before?.actual_start_date;
  const effActEnd   = 'actual_completion_date' in cleaned ? cleaned.actual_completion_date : before?.actual_completion_date;
  if (effActStart && effActEnd && effActEnd < effActStart) {
    throw new Error(`Actual completion (${effActEnd}) cannot be before actual start (${effActStart}).`);
  }

  const { data, error } = await supabase.from('project_tasks').update(cleaned).eq('id', taskId).select('*').single();
  if (error) throw error;
  audit({
    actorId, action: 'update', entityType: 'task', entityId: taskId,
    before, after: data, context: { project_id: data?.project_id },
  });
  // Notify newly-added assignees only
  if (Array.isArray(patch.assigned_to_ids)) {
    const oldSet = new Set(Array.isArray(before?.assigned_to_ids) ? before.assigned_to_ids : []);
    const added = patch.assigned_to_ids.filter((id) => !oldSet.has(id));
    if (added.length) {
      notifyMany(added.map((pid) => ({
        recipient_profile_id: pid, subject_profile_id: actorId ?? null,
        type: 'task_assigned',
        message: `You were assigned to task "${data.name}".\n#project=${data.project_id}`,
        email: true,
      })));
    }
  }
  return data;
}

export async function listMyTasks(profileId) {
  if (!profileId) return [];
  // Subtasks assigned to the user (drill-down: Project → Task → Subtask)
  const { data: subs, error: e1 } = await supabase
    .from('project_tasks')
    .select(`
      id, project_id, phase, parent_task_id, name, weight_pct, progress_metric,
      quantity_value, quantity_unit, status, start_date, end_date,
      actual_start_date, actual_completion_date, assigned_to_ids,
      projects!project_tasks_project_id_fkey!inner ( id, name, status )
    `)
    .contains('assigned_to_ids', [profileId])
    .not('parent_task_id', 'is', null)
    .order('end_date', { ascending: true, nullsLast: true });
  if (e1) throw e1;
  if (!subs?.length) return [];

  // Fetch parent tasks for grouping headers
  const parentIds = Array.from(new Set(subs.map((s) => s.parent_task_id).filter(Boolean)));
  const { data: parents, error: e2 } = await supabase
    .from('project_tasks')
    .select('id, name, phase, project_id')
    .in('id', parentIds);
  if (e2) throw e2;
  const parentById = new Map((parents ?? []).map((p) => [p.id, p]));
  return subs.map((s) => ({ ...s, parent: parentById.get(s.parent_task_id) ?? null }));
}

export async function setProjectTaskDone(taskId, done) {
  const { data: task } = await supabase
    .from('project_tasks')
    .select('id, projects!project_tasks_project_id_fkey!inner ( status )')
    .eq('id', taskId).single();
  if (task?.projects?.status !== 'active') {
    throw new Error('This project is not active yet. Ask the Project Manager to start the project.');
  }
  await assertNotSummary(taskId, 'progress');
  // Monotonic: once done, un-checking is disallowed (progress never regresses).
  if (!done) {
    const { data: before } = await supabase.from('project_tasks').select('status').eq('id', taskId).single();
    if (before?.status === 'done') throw new Error('Progress can only go up — a completed task cannot be reopened.');
  }
  const patch = done
    ? { status: 'done', actual_completion_date: new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() }
    : { status: 'not_started', actual_completion_date: null, updated_at: new Date().toISOString() };
  const { error } = await supabase.from('project_tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

export async function setProjectTaskStatus(taskId, status, current) {
  await assertNotSummary(taskId, 'progress');
  if (current?.status === 'done' && status !== 'done') {
    throw new Error('Progress can only go up — a completed task cannot be reopened.');
  }
  const today = new Date().toISOString().slice(0, 10);
  const patch = { status, updated_at: new Date().toISOString() };
  if (status === 'in_progress' && !current?.actual_start_date) patch.actual_start_date = today;
  if (status === 'done') {
    if (!current?.actual_start_date) patch.actual_start_date = today;
    patch.actual_completion_date = today;
  }
  if (status === 'not_started') {
    patch.actual_start_date = null;
    patch.actual_completion_date = null;
  }
  const { error } = await supabase.from('project_tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

export async function setProjectTaskActualValue(taskId, actualValue, plannedValue) {
  await assertNotSummary(taskId, 'progress');
  const { data: before } = await supabase.from('project_tasks').select('actual_value').eq('id', taskId).single();
  if (before?.actual_value != null && actualValue != null && Number(actualValue) < Number(before.actual_value)) {
    throw new Error(`Progress can only go up. Current: ${before.actual_value}, tried to set: ${actualValue}.`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const patch = { actual_value: actualValue, updated_at: new Date().toISOString() };
  if (actualValue != null && plannedValue != null && Number(actualValue) >= Number(plannedValue)) {
    patch.status = 'done';
    patch.actual_completion_date = today;
  } else if (actualValue != null && Number(actualValue) > 0) {
    patch.status = 'in_progress';
  }
  const { error } = await supabase.from('project_tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

// For '% Based' leaves: pct is 0..100. Marks done at 100. Monotonic.
export async function setProjectTaskPercent(taskId, pct) {
  await assertNotSummary(taskId, 'progress');
  const clean = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const { data: before } = await supabase.from('project_tasks').select('actual_value, actual_start_date').eq('id', taskId).single();
  if (before?.actual_value != null && clean < Number(before.actual_value)) {
    throw new Error(`Progress can only go up. Current: ${before.actual_value}%, tried to set: ${clean}%.`);
  }
  const today = new Date().toISOString().slice(0, 10);
  const patch = { actual_value: clean, updated_at: new Date().toISOString() };
  if (clean > 0 && !before?.actual_start_date) patch.actual_start_date = today;
  if (clean >= 100) { patch.status = 'done'; patch.actual_completion_date = today; }
  else if (clean > 0) patch.status = 'in_progress';
  const { error } = await supabase.from('project_tasks').update(patch).eq('id', taskId);
  if (error) throw error;
}

export async function setMilestoneReached(milestoneId, date) {
  const { error } = await supabase
    .from('project_milestones')
    .update({ reached_date: date, updated_at: new Date().toISOString() })
    .eq('id', milestoneId);
  if (error) throw error;
}
