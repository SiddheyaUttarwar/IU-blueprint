import { supabase } from '../lib/supabaseClient.js';
import { audit } from '../lib/audit.js';
import { notifyMany } from '../lib/notify.js';

const SELECT = `
  id, project_id, task_id, category, planned_amount, actual_amount, notes, created_at, updated_at,
  task:project_tasks!project_budgets_task_id_fkey ( id, name, phase, parent_task_id )
`;

export async function listBudgets(projectId) {
  const { data, error } = await supabase
    .from('project_budgets')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addBudgetForTask(projectId, taskId, { plannedAmount = 0, notes = '', actorId } = {}) {
  const { data, error } = await supabase
    .from('project_budgets')
    .insert({
      project_id: projectId,
      task_id: taskId,
      category: null,
      planned_amount: Number(plannedAmount) || 0,
      actual_amount: 0,
      notes: notes?.trim() || null,
    })
    .select(SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('That task already has a budget row.');
    throw error;
  }
  audit({ actorId, action: 'create', entityType: 'budget', entityId: data.id, after: data, context: { project_id: projectId, task_id: taskId } });
  return data;
}

export async function updateBudgetAmount(id, { field, newAmount, reason, actorId }) {
  if (!['planned_amount', 'actual_amount'].includes(field)) throw new Error('Invalid field.');
  const { data: before, error: e0 } = await supabase.from('project_budgets').select('*').eq('id', id).single();
  if (e0) throw e0;
  const prev = Number(before[field] || 0);
  const next = Number(newAmount) || 0;
  const delta = next - prev;
  if (delta === 0) return before;

  const patch = { [field]: next, updated_at: new Date().toISOString() };
  const { data, error } = await supabase.from('project_budgets').update(patch).eq('id', id).select(SELECT).single();
  if (error) throw error;

  const variance = Number(data.planned_amount || 0) - Number(data.actual_amount || 0);
  await supabase.from('budget_variance_history').insert({
    budget_id: id,
    field,
    previous_amount: prev,
    new_amount: next,
    delta,
    variance,
    reason: reason?.trim() || null,
    changed_by: actorId ?? null,
  });
  audit({
    actorId, action: 'update', entityType: 'budget', entityId: id,
    before: { [field]: prev }, after: { [field]: next },
    context: { project_id: data.project_id, task_id: data.task_id, delta, reason: reason ?? null },
  });
  // Notify PM about budget changes (unless PM is the actor)
  try {
    const { data: proj } = await supabase.from('projects').select('name, project_manager_id').eq('id', data.project_id).single();
    if (proj?.project_manager_id && proj.project_manager_id !== actorId) {
      notifyMany([{
        recipient_profile_id: proj.project_manager_id, subject_profile_id: actorId ?? null,
        type: 'budget_change',
        message: `Budget ${field === 'planned_amount' ? 'planned' : 'actual'} changed in "${proj.name}" (Δ ₹${delta.toLocaleString('en-IN')}).\n#project=${data.project_id}`,
        email: true,
      }]);
    }
  } catch { /* ignore */ }
  return data;
}

export async function updateBudgetNotes(id, notes, { actorId } = {}) {
  const cleaned = notes?.trim() || null;
  const { data, error } = await supabase.from('project_budgets').update({ notes: cleaned, updated_at: new Date().toISOString() }).eq('id', id).select(SELECT).single();
  if (error) throw error;
  audit({ actorId, action: 'update', entityType: 'budget', entityId: id, after: { notes: cleaned }, context: { project_id: data.project_id } });
  return data;
}

export async function removeBudget(id, { actorId } = {}) {
  const { data: before } = await supabase.from('project_budgets').select('*').eq('id', id).single();
  const { error } = await supabase.from('project_budgets').delete().eq('id', id);
  if (error) throw error;
  audit({ actorId, action: 'delete', entityType: 'budget', entityId: id, before, context: { project_id: before?.project_id } });
}

export async function listBudgetHistory(budgetId) {
  const { data, error } = await supabase
    .from('budget_variance_history')
    .select(`*, changer:profiles!budget_variance_history_changed_by_fkey ( id, first_name, last_name, email )`)
    .eq('budget_id', budgetId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
