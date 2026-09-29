import { supabase } from '../lib/supabaseClient.js';
import { writeBaseline } from './projectBaselines.js';

// Load task-level planned/actual amounts for the whole project — returns Map(task_id → row).
export async function listTaskAmountsForProject(projectId) {
  const { data, error } = await supabase
    .from('project_task_amounts')
    .select('id, task_id, planned_amount, actual_amount, currency, updated_at, updated_by, project_tasks!inner(project_id)')
    .eq('project_tasks.project_id', projectId);
  if (error) throw error;
  const m = new Map();
  for (const r of data ?? []) m.set(r.task_id, r);
  return m;
}

// Upsert planned/actual amount for a task. On amount CHANGE, snapshots the previous value
// into project_task_baselines with kind='task_amount' so variance is tracked over time.
export async function setTaskAmount({ projectId, taskId, planned, actual, actorId }) {
  const { data: existing } = await supabase
    .from('project_task_amounts')
    .select('id, planned_amount, actual_amount')
    .eq('task_id', taskId)
    .maybeSingle();

  const prevPlanned = existing?.planned_amount ?? null;
  const prevActual  = existing?.actual_amount  ?? null;
  const nextPlanned = planned == null || planned === '' ? null : Number(planned);
  const nextActual  = actual  == null || actual  === '' ? null : Number(actual);

  const plannedChanged = prevPlanned !== nextPlanned && (prevPlanned != null || nextPlanned != null);
  const actualChanged  = prevActual  !== nextActual  && (prevActual  != null || nextActual  != null);

  if (plannedChanged && prevPlanned != null) {
    try {
      await writeBaseline({
        projectId, taskId, kind: 'task_amount',
        previousAmount: prevPlanned, reason: 'planned_amount_change', actorId,
      });
    } catch (e) { console.warn('Amount baseline (planned) failed:', e); }
  }
  if (actualChanged && prevActual != null) {
    try {
      await writeBaseline({
        projectId, taskId, kind: 'task_amount',
        previousAmount: prevActual, reason: 'actual_amount_change', actorId,
      });
    } catch (e) { console.warn('Amount baseline (actual) failed:', e); }
  }

  const row = {
    task_id: taskId,
    planned_amount: nextPlanned,
    actual_amount:  nextActual,
    updated_at: new Date().toISOString(),
    updated_by: actorId ?? null,
  };
  const { data, error } = await supabase
    .from('project_task_amounts')
    .upsert(row, { onConflict: 'task_id' })
    .select('id, task_id, planned_amount, actual_amount, currency, updated_at, updated_by')
    .single();
  if (error) throw error;
  return data;
}
