import { supabase } from '../lib/supabaseClient.js';
import { assertProjectActiveByTask } from '../lib/projectGuards.js';
import { notifyMany, resolveTaskAudience } from '../lib/notify.js';

const SELECT = `
  id, task_id, updated_by, update_date, notes, attachments, created_at,
  author:profiles!subtask_updates_updated_by_fkey ( id, first_name, last_name, email )
`;

export async function listUpdates(taskId) {
  const { data, error } = await supabase
    .from('subtask_updates')
    .select(SELECT)
    .eq('task_id', taskId)
    .order('update_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addUpdate(taskId, updatedBy, { updateDate, notes, attachments }) {
  await assertProjectActiveByTask(taskId);
  const { data, error } = await supabase
    .from('subtask_updates')
    .insert({
      task_id: taskId,
      updated_by: updatedBy ?? null,
      update_date: updateDate || new Date().toISOString().slice(0, 10),
      notes: notes?.trim() || null,
      attachments: Array.isArray(attachments) ? attachments : [],
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  // Notify PM + co-assignees (excluding the actor)
  try {
    const { project, assignees } = await resolveTaskAudience(taskId);
    const recipients = new Set(assignees);
    if (project?.project_manager_id) recipients.add(project.project_manager_id);
    recipients.delete(updatedBy);
    notifyMany(Array.from(recipients).map((pid) => ({
      recipient_profile_id: pid, subject_profile_id: updatedBy ?? null,
      type: 'task_update',
      message: `New progress update logged on a task in "${project?.name ?? 'a project'}".\n#project=${project?.id ?? ''}`,
      email: true,
    })));
  } catch { /* ignore */ }
  return data;
}

export async function uploadUpdateAttachment(taskId, file) {
  if (!file) throw new Error('No file selected.');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `updates/${taskId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('project-docs').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  });
  if (error) throw error;
  return { name: file.name, path, size: file.size, mime: file.type || null };
}

export async function getAttachmentSignedUrl(path, expires = 300) {
  const { data, error } = await supabase.storage.from('project-docs').createSignedUrl(path, expires);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

// All updates across every task in a project — returns Map(task_id → array of updates).
export async function listUpdatesForProject(projectId) {
  const { data: taskRows, error: tErr } = await supabase
    .from('project_tasks').select('id').eq('project_id', projectId);
  if (tErr) throw tErr;
  const ids = (taskRows ?? []).map((r) => r.id);
  if (!ids.length) return new Map();
  const { data, error } = await supabase
    .from('subtask_updates')
    .select(SELECT)
    .in('task_id', ids)
    .order('update_date', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const m = new Map();
  for (const row of data ?? []) {
    const arr = m.get(row.task_id) ?? [];
    arr.push(row);
    m.set(row.task_id, arr);
  }
  return m;
}

export async function listLatestUpdatesForTasks(taskIds) {
  if (!taskIds?.length) return new Map();
  const { data, error } = await supabase
    .from('subtask_updates')
    .select('task_id, update_date, notes, created_at, updated_by, author:profiles!subtask_updates_updated_by_fkey ( id, first_name, last_name, email )')
    .in('task_id', taskIds)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const map = new Map();
  for (const row of data ?? []) if (!map.has(row.task_id)) map.set(row.task_id, row);
  return map;
}
