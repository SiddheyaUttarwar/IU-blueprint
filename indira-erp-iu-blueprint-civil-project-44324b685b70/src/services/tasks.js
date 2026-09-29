import { supabase } from '../lib/supabaseClient.js';

export const PHASES = [
  { value: 'pre_project', label: 'Pre-project' },
  { value: 'project', label: 'Project' },
];

export function phaseLabel(v) {
  return PHASES.find((p) => p.value === v)?.label ?? v;
}

export async function listTasks() {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, project_template_id, phase, name, parent_task_id, sort_order, created_at, project_templates ( id, name )')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createTaskWithSubtasks({ templateId, phase, name, subtasks = [], createdBy }) {
  const trimmed = name.trim();
  if (!templateId) throw new Error('Project template is required.');
  if (!phase) throw new Error('Project phase is required.');
  if (!trimmed) throw new Error('Task name is required.');

  const { data: parent, error: pErr } = await supabase
    .from('tasks')
    .insert({ project_template_id: templateId, phase, name: trimmed, created_by: createdBy ?? null })
    .select('id, project_template_id, phase, name, parent_task_id, sort_order, created_at, project_templates ( id, name )')
    .single();
  if (pErr) throw pErr;

  const cleanSubs = subtasks.map((s) => s.trim()).filter(Boolean);
  if (cleanSubs.length === 0) return { task: parent, subtasks: [] };

  const rows = cleanSubs.map((n, i) => ({
    project_template_id: templateId,
    phase,
    name: n,
    parent_task_id: parent.id,
    sort_order: i,
    created_by: createdBy ?? null,
  }));

  const { data: subs, error: sErr } = await supabase
    .from('tasks')
    .insert(rows)
    .select('id, project_template_id, phase, name, parent_task_id, sort_order, created_at, project_templates ( id, name )');
  if (sErr) {
    await supabase.from('tasks').delete().eq('id', parent.id);
    throw sErr;
  }
  return { task: parent, subtasks: subs ?? [] };
}

export async function removeTask(id) {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) throw error;
}

export async function upsertMasterTask({ templateId, phase, name, parentTaskId = null, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Task name is required.');
  const lower = trimmed.toLowerCase();

  let q = supabase.from('tasks').select('id, name, parent_task_id')
    .eq('project_template_id', templateId).eq('phase', phase).ilike('name', trimmed);
  if (parentTaskId == null) q = q.is('parent_task_id', null);
  else q = q.eq('parent_task_id', parentTaskId);
  const { data: existing, error: findErr } = await q.limit(50);
  if (findErr) throw findErr;
  const match = (existing ?? []).find((r) => r.name.toLowerCase() === lower);
  if (match) return match;

  const { data, error } = await supabase
    .from('tasks')
    .insert({
      project_template_id: templateId, phase, name: trimmed,
      parent_task_id: parentTaskId, created_by: createdBy ?? null,
    })
    .select('id, name, parent_task_id')
    .single();
  if (error) throw error;
  return data;
}

export async function addSubtask({ parentTaskId, templateId, phase, name, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Subtask name is required.');
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      project_template_id: templateId,
      phase,
      name: trimmed,
      parent_task_id: parentTaskId,
      created_by: createdBy ?? null,
    })
    .select('id, project_template_id, phase, name, parent_task_id, sort_order, created_at, project_templates ( id, name )')
    .single();
  if (error) throw error;
  return data;
}
