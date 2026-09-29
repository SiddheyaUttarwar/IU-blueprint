import { supabase } from '../lib/supabaseClient.js';
import { audit } from '../lib/audit.js';
import { notifyMany } from '../lib/notify.js';

export const FUNDING_SOURCES = [
  { value: 'school_budget', label: 'School Budget' },
  { value: 'campus_budget', label: 'Campus Budget' },
  { value: 'non_budget', label: 'Non-Budget' },
  { value: 'bank_loan', label: 'Bank Loan' },
];

const VALID_SOURCES = new Set(FUNDING_SOURCES.map((s) => s.value));

export function labelFor(source) {
  return FUNDING_SOURCES.find((s) => s.value === source)?.label ?? source;
}

export async function listFunding(projectId) {
  const { data, error } = await supabase
    .from('project_funding')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function addFundingRows(projectId, sources, { amount = 0, notes = '', actorId } = {}) {
  const rows = (sources ?? []).filter((s) => VALID_SOURCES.has(s)).map((source) => ({
    project_id: projectId,
    source,
    amount: Number(amount) || 0,
    notes: notes?.trim() || null,
  }));
  if (!rows.length) throw new Error('Pick at least one funding source.');
  const { data, error } = await supabase.from('project_funding').insert(rows).select('*');
  if (error) throw error;
  (data ?? []).forEach((r) => audit({
    actorId, action: 'create', entityType: 'funding', entityId: r.id, after: r, context: { project_id: projectId, source: r.source },
  }));
  return data ?? [];
}

export async function updateFundingAmount(id, { newAmount, reason, actorId }) {
  const { data: before, error: e0 } = await supabase.from('project_funding').select('*').eq('id', id).single();
  if (e0) throw e0;
  const prev = Number(before.amount || 0);
  const next = Number(newAmount) || 0;
  const delta = next - prev;
  if (delta === 0) return before;

  const { data, error } = await supabase.from('project_funding')
    .update({ amount: next })
    .eq('id', id).select('*').single();
  if (error) throw error;

  await supabase.from('funding_variance_history').insert({
    funding_id: id, previous_amount: prev, new_amount: next, delta,
    reason: reason?.trim() || null, changed_by: actorId ?? null,
  });
  audit({
    actorId, action: 'update', entityType: 'funding', entityId: id,
    before: { amount: prev }, after: { amount: next },
    context: { project_id: data.project_id, source: data.source, delta, reason: reason ?? null },
  });
  // Notify PM of funding changes
  try {
    const { data: proj } = await supabase.from('projects').select('name, project_manager_id').eq('id', data.project_id).single();
    if (proj?.project_manager_id && proj.project_manager_id !== actorId) {
      notifyMany([{
        recipient_profile_id: proj.project_manager_id, subject_profile_id: actorId ?? null,
        type: 'funding_change',
        message: `Funding (${labelFor(data.source)}) changed in "${proj.name}" (Δ ₹${delta.toLocaleString('en-IN')}).\n#project=${data.project_id}`,
        email: true,
      }]);
    }
  } catch { /* ignore */ }
  return data;
}

export async function updateFundingNotes(id, notes, { actorId } = {}) {
  const cleaned = notes?.trim() || null;
  const { data, error } = await supabase.from('project_funding').update({ notes: cleaned }).eq('id', id).select('*').single();
  if (error) throw error;
  audit({ actorId, action: 'update', entityType: 'funding', entityId: id, after: { notes: cleaned }, context: { project_id: data.project_id } });
  return data;
}

export async function removeFunding(id, { actorId } = {}) {
  const { data: before } = await supabase.from('project_funding').select('*').eq('id', id).single();
  const { error } = await supabase.from('project_funding').delete().eq('id', id);
  if (error) throw error;
  audit({ actorId, action: 'delete', entityType: 'funding', entityId: id, before, context: { project_id: before?.project_id } });
}

export async function listFundingHistory(fundingId) {
  const { data, error } = await supabase
    .from('funding_variance_history')
    .select(`*, changer:profiles!funding_variance_history_changed_by_fkey ( id, first_name, last_name, email )`)
    .eq('funding_id', fundingId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
