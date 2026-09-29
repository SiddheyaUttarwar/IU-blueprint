import { supabase } from '../lib/supabaseClient.js';
import { audit } from '../lib/audit.js';
import { notifyMany } from '../lib/notify.js';

const SELECT = `
  id, project_id, requested_status, reason, status, decision_note, created_at, decided_at, approver_snapshot,
  requester:profiles!project_status_requests_requested_by_fkey ( id, first_name, last_name, email ),
  decider:profiles!project_status_requests_decided_by_fkey ( id, first_name, last_name, email )
`;

export async function listRequests(projectId) {
  const { data, error } = await supabase
    .from('project_status_requests')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listPendingRequests() {
  const { data, error } = await supabase
    .from('project_status_requests')
    .select(SELECT + ', projects ( id, name )')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function submitRequest(projectId, requesterId, requestedStatus, reason) {
  const trimmed = reason?.trim();
  if (!trimmed) throw new Error('Reason is required to submit a status change request.');

  // Freeze the project's current approver list into the request. Later approver-list changes on the
  // project row will NOT affect this pending request — snapshot approvers still have to complete it.
  let proj = null;
  try {
    const { data } = await supabase.from('projects').select('name, approver_ids, project_manager_id').eq('id', projectId).single();
    proj = data;
  } catch { /* handled below */ }
  if (!proj) {
    const { data } = await supabase.from('projects').select('name, project_manager_id').eq('id', projectId).single();
    proj = data;
  }
  const snapshot = Array.isArray(proj?.approver_ids) ? proj.approver_ids : [];

  const insertRow = {
    project_id: projectId,
    requested_status: requestedStatus,
    requested_by: requesterId ?? null,
    reason: trimmed,
    status: 'pending',
    approver_snapshot: snapshot,
  };
  let ins = await supabase.from('project_status_requests').insert(insertRow).select(SELECT).single();
  if (ins.error && (ins.error.code === '42703' || /approver_snapshot/.test(ins.error.message || ''))) {
    delete insertRow.approver_snapshot;
    ins = await supabase.from('project_status_requests').insert(insertRow)
      .select(SELECT.replace(', approver_snapshot', '')).single();
  }
  const { data, error } = ins;
  if (error) throw error;
  audit({
    actorId: requesterId, action: 'submit', entityType: 'status_request', entityId: data.id,
    after: { requested_status: requestedStatus }, context: { project_id: projectId, reason: trimmed },
  });

  const notifyIds = snapshot.filter((id) => id && id !== requesterId);
  if (notifyIds.length) {
    notifyMany(notifyIds.map((pid) => ({
      recipient_profile_id: pid, subject_profile_id: requesterId ?? null,
      type: 'status_request_pending',
      message: `Approval needed: "${proj?.name ?? 'a project'}" — request to ${requestedStatus.replace('_', ' ')}.\n#project=${projectId}`,
      email: true,
    })));
  }
  return data;
}

export async function decideRequest(requestId, deciderId, decision, note) {
  if (!['approved', 'rejected'].includes(decision)) throw new Error('Invalid decision.');
  const trimmedNote = note?.trim();
  if (decision === 'rejected' && !trimmedNote) throw new Error('Rejection reason is required.');
  const { data: req, error: e1 } = await supabase
    .from('project_status_requests')
    .update({
      status: decision,
      decided_by: deciderId ?? null,
      decided_at: new Date().toISOString(),
      decision_note: trimmedNote || null,
    })
    .eq('id', requestId)
    .select('*')
    .single();
  if (e1) throw e1;
  if (decision === 'approved') {
    const { error: e2 } = await supabase.from('projects').update({ status: req.requested_status, updated_at: new Date().toISOString() }).eq('id', req.project_id);
    if (e2) throw e2;
  }
  audit({
    actorId: deciderId, action: decision, entityType: 'status_request', entityId: requestId,
    after: { status: decision, decided_note: trimmedNote || null },
    context: { project_id: req.project_id, requested_status: req.requested_status },
  });
  if (req.requested_by && req.requested_by !== deciderId) {
    notifyMany([{
      recipient_profile_id: req.requested_by, subject_profile_id: deciderId ?? null,
      type: `status_request_${decision}`,
      message: decision === 'approved'
        ? `Your request to change project status to "${req.requested_status.replace('_', ' ')}" was approved.\n#project=${req.project_id}`
        : `Your request to change project status was rejected: ${trimmedNote || 'no reason given'}.\n#project=${req.project_id}`,
      email: true,
    }]);
  }
  return req;
}
