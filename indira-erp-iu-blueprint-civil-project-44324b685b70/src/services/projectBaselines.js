import { supabase } from '../lib/supabaseClient.js';

// Append-only baseline snapshot of a project_task's start/end dates OR task/milestone amount.
// `kind` = 'task_date' | 'task_amount' | 'milestone_date'.
// Call this BEFORE updating the source record so the PREVIOUS values get frozen.
export async function writeBaseline({
  projectId, taskId, kind = 'task_date',
  previousStart = null, previousEnd = null, previousAmount = null,
  reason, actorId,
}) {
  const { data, error } = await supabase
    .from('project_task_baselines')
    .insert({
      project_id: projectId,
      task_id: taskId,
      kind,
      snapshot_start: previousStart ?? null,
      snapshot_end: previousEnd ?? null,
      snapshot_amount: previousAmount ?? null,
      reason: reason ?? null,
      created_by: actorId ?? null,
    })
    .select('id, task_id, kind, snapshot_start, snapshot_end, snapshot_amount, created_at')
    .single();
  if (error) throw error;
  return data;
}

export async function listBaselinesForProject(projectId, kind = null) {
  let q = supabase
    .from('project_task_baselines')
    .select('id, task_id, kind, snapshot_start, snapshot_end, snapshot_amount, reason, created_at')
    .eq('project_id', projectId);
  if (kind) q = q.eq('kind', kind);
  const { data, error } = await q.order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
