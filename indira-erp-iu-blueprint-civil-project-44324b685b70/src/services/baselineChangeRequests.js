import { supabase } from '../lib/supabaseClient.js';
import { audit } from '../lib/audit.js';
import { writeBaseline } from './projectBaselines.js';
import { notifyMany } from '../lib/notify.js';

const REQUEST_SELECT = `
  id, project_id, requested_by, requested_at, reason,
  before_snapshot, after_snapshot, approver_snapshot,
  status, decided_by, decided_at, decision_reason,
  requester:profiles!baseline_change_requests_requested_by_fkey ( id, first_name, last_name, email ),
  decider:profiles!baseline_change_requests_decided_by_fkey ( id, first_name, last_name, email )
`;

export async function createBaselineChangeRequest({
  projectId, requestedBy, reason, beforeSnapshot, afterSnapshot,
}) {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length < 20) throw new Error('Reason must be at least 20 characters.');
  if (!beforeSnapshot || !afterSnapshot) throw new Error('Both before and after snapshots are required.');

  // Snapshot the project's current approver list. Later changes to approver_ids don't affect this request.
  // approver_ids and approver_snapshot are added by the 20260911 migration — fall back gracefully
  // if either column isn't there yet.
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
    requested_by: requestedBy,
    reason: trimmed,
    before_snapshot: beforeSnapshot,
    after_snapshot: afterSnapshot,
    approver_snapshot: snapshot,
  };
  let ins = await supabase.from('baseline_change_requests').insert(insertRow).select(REQUEST_SELECT).single();
  if (ins.error && (ins.error.code === '42703' || /approver_snapshot/.test(ins.error.message || ''))) {
    delete insertRow.approver_snapshot;
    ins = await supabase.from('baseline_change_requests').insert(insertRow)
      .select(REQUEST_SELECT.replace(', approver_snapshot', '')).single();
  }
  const { data, error } = ins;
  if (error) throw error;
  audit({ actorId: requestedBy, action: 'insert', entityType: 'baseline_change_request', entityId: data.id, after: data });

  // Notify snapshot approvers (project-level) + fall back to leadership + always include the PM.
  const recipientSet = new Set(snapshot.filter((id) => id && id !== requestedBy));
  if (recipientSet.size === 0) {
    const { data: leaders } = await supabase
      .from('profiles')
      .select('id')
      .or('role.eq.leadership,roles.cs.{leadership}');
    for (const l of (leaders ?? [])) if (l.id && l.id !== requestedBy) recipientSet.add(l.id);
  }
  if (proj?.project_manager_id && proj.project_manager_id !== requestedBy) recipientSet.add(proj.project_manager_id);
  // Also always echo a receipt notification back to the requester so the bell shows "your request is pending".
  const recipientIds = [...recipientSet];
  if (recipientIds.length) {
    notifyMany(recipientIds.map((pid) => ({
      recipient_profile_id: pid, subject_profile_id: requestedBy ?? null,
      type: 'baseline_pending',
      message: `Baseline change approval needed for "${proj?.name ?? 'a project'}".\n#project=${projectId}`,
      email: true,
    })));
  }
  if (requestedBy) {
    notifyMany([{
      recipient_profile_id: requestedBy, subject_profile_id: requestedBy,
      type: 'baseline_pending_receipt',
      message: `Your baseline change request for "${proj?.name ?? 'a project'}" is awaiting approval.\n#project=${projectId}`,
      email: false,
    }]);
  }
  return data;
}

export async function listPendingForProject(projectId) {
  const { data, error } = await supabase
    .from('baseline_change_requests')
    .select(REQUEST_SELECT)
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAllPending() {
  const { data, error } = await supabase
    .from('baseline_change_requests')
    .select(`${REQUEST_SELECT}, projects ( id, name )`)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// All requests visible to the current authenticated caller — RLS restricts to their scope.
// Returned with the project name so we can render "Project" column in the approvals page.
export async function listAllRequests(statusFilter = null) {
  let q = supabase
    .from('baseline_change_requests')
    .select(`${REQUEST_SELECT}, projects ( id, name )`)
    .order('requested_at', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

// PM own-requests (client-side filter to callers requested_by).
export async function listMyRequests(profileId, statusFilter = null) {
  if (!profileId) return [];
  let q = supabase
    .from('baseline_change_requests')
    .select(`${REQUEST_SELECT}, projects ( id, name )`)
    .eq('requested_by', profileId)
    .order('requested_at', { ascending: false });
  if (statusFilter) q = q.eq('status', statusFilter);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function getRequest(id) {
  const { data, error } = await supabase
    .from('baseline_change_requests')
    .select(REQUEST_SELECT)
    .eq('id', id).single();
  if (error) throw error;
  return data;
}

// Applies the after_snapshot to the project. Iterates through the diff and:
// - Updates project row (name, description, start_date, end_date) when changed
// - For each task with changed dates: writes a baseline snapshot of the BEFORE dates, then updates the task
// - For each milestone with changed target_date: writes a milestone-date baseline, then updates
// - Marks the request as approved
export async function approveBaselineChangeRequest({ requestId, deciderId, decisionReason }) {
  const req = await getRequest(requestId);
  if (req.status !== 'pending') throw new Error(`Request is already ${req.status}.`);
  const before = req.before_snapshot;
  const after = req.after_snapshot;

  // Project-level fields
  const projectPatch = {};
  for (const field of ['name', 'description', 'start_date', 'end_date']) {
    if ((before.project?.[field] ?? null) !== (after.project?.[field] ?? null)) {
      projectPatch[field] = after.project[field];
    }
  }
  if (Object.keys(projectPatch).length > 0) {
    projectPatch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('projects').update(projectPatch).eq('id', req.project_id);
    if (error) throw error;
  }

  // Task date changes: snapshot old, then patch new. Collect affected task ids for assignee notify.
  const beforeTaskMap = new Map((before.tasks ?? []).map((t) => [t.id, t]));
  const changedTaskIds = [];
  for (const at of after.tasks ?? []) {
    const bt = beforeTaskMap.get(at.id);
    if (!bt) continue;
    const startChanged = (bt.start_date ?? null) !== (at.start_date ?? null);
    const endChanged = (bt.end_date ?? null) !== (at.end_date ?? null);
    if (!startChanged && !endChanged) continue;
    changedTaskIds.push(at.id);
    await writeBaseline({
      projectId: req.project_id, taskId: at.id, kind: 'task_date',
      previousStart: bt.start_date, previousEnd: bt.end_date,
      reason: req.reason, actorId: deciderId,
    });
    const { error } = await supabase.from('project_tasks')
      .update({ start_date: at.start_date, end_date: at.end_date, updated_at: new Date().toISOString() })
      .eq('id', at.id);
    if (error) throw error;
  }

  // Milestone target_date changes
  const beforeMsMap = new Map((before.milestones ?? []).map((m) => [m.id, m]));
  for (const am of after.milestones ?? []) {
    const bm = beforeMsMap.get(am.id);
    if (!bm) continue;
    if ((bm.target_date ?? null) === (am.target_date ?? null)) continue;
    await writeBaseline({
      projectId: req.project_id, taskId: am.id, kind: 'milestone_date',
      previousStart: bm.target_date, previousEnd: null,
      reason: req.reason, actorId: deciderId,
    });
    const { error } = await supabase.from('project_milestones')
      .update({ target_date: am.target_date, updated_at: new Date().toISOString() })
      .eq('id', am.id);
    if (error) throw error;
  }

  // Indent item amount changes: planned_amount / buy_qty / unit_price. History is captured
  // by the existing indent_item_variance_history trigger via updateIndentItem-shaped writes.
  const beforeIndentMap = new Map((before.indent_items ?? []).map((it) => [it.id, it]));
  for (const ait of after.indent_items ?? []) {
    const bit = beforeIndentMap.get(ait.id);
    if (!bit) continue;
    const patch = {};
    for (const f of ['planned_amount', 'buy_qty', 'unit_price']) {
      if ((bit[f] ?? null) !== (ait[f] ?? null)) patch[f] = ait[f];
    }
    if (Object.keys(patch).length === 0) continue;
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from('indent_items').update(patch).eq('id', ait.id);
    if (error) throw error;
  }

  // Task budget (project_task_amounts) planned_amount changes. Snapshot old via
  // project_task_baselines kind='task_amount' so the audit trail is complete.
  const beforeTaskAmt = new Map((before.task_amounts ?? []).map((a) => [a.task_id, a]));
  for (const at of after.task_amounts ?? []) {
    const bt = beforeTaskAmt.get(at.task_id);
    if (!bt) continue;
    if ((bt.planned_amount ?? null) === (at.planned_amount ?? null)) continue;
    await writeBaseline({
      projectId: req.project_id, taskId: at.task_id, kind: 'task_amount',
      previousStart: null, previousEnd: null, previousAmount: bt.planned_amount,
      reason: req.reason, actorId: deciderId,
    });
    // Upsert on task_id — project_task_amounts has a unique(task_id) constraint.
    const { error } = await supabase.from('project_task_amounts')
      .upsert({ task_id: at.task_id, planned_amount: at.planned_amount, updated_at: new Date().toISOString(), updated_by: deciderId }, { onConflict: 'task_id' });
    if (error) throw error;
  }

  const { data: decided, error: decErr } = await supabase
    .from('baseline_change_requests')
    .update({
      status: 'approved',
      decided_by: deciderId,
      decided_at: new Date().toISOString(),
      decision_reason: (decisionReason ?? '').trim() || null,
    })
    .eq('id', requestId)
    .select(REQUEST_SELECT).single();
  if (decErr) throw decErr;
  audit({ actorId: deciderId, action: 'approve', entityType: 'baseline_change_request', entityId: requestId, after: decided });
  const notifRecipients = new Set();
  if (req.requested_by && req.requested_by !== deciderId) notifRecipients.add(req.requested_by);
  if (changedTaskIds.length) {
    const { data: assigneeRows } = await supabase
      .from('project_tasks')
      .select('assigned_to_ids')
      .in('id', changedTaskIds);
    for (const row of assigneeRows ?? []) {
      for (const pid of row.assigned_to_ids ?? []) {
        if (pid && pid !== deciderId) notifRecipients.add(pid);
      }
    }
  }
  if (notifRecipients.size) {
    notifyMany([...notifRecipients].map((pid) => ({
      recipient_profile_id: pid, subject_profile_id: deciderId,
      type: pid === req.requested_by ? 'baseline_approved' : 'baseline_dates_changed',
      message: pid === req.requested_by
        ? `Your baseline change request has been approved and applied.\n#project=${req.project_id}`
        : `A task you are assigned to has updated dates from an approved baseline change.\n#project=${req.project_id}`,
      email: pid === req.requested_by,
    })));
  }
  return decided;
}

export async function rejectBaselineChangeRequest({ requestId, deciderId, decisionReason }) {
  const trimmed = (decisionReason ?? '').trim();
  if (trimmed.length < 5) throw new Error('Please provide a rejection reason (min 5 characters).');
  const { data, error } = await supabase
    .from('baseline_change_requests')
    .update({
      status: 'rejected',
      decided_by: deciderId,
      decided_at: new Date().toISOString(),
      decision_reason: trimmed,
    })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select(REQUEST_SELECT).single();
  if (error) throw error;
  audit({ actorId: deciderId, action: 'reject', entityType: 'baseline_change_request', entityId: requestId, after: data });
  if (data.requested_by && data.requested_by !== deciderId) {
    notifyMany([{
      recipient_profile_id: data.requested_by, subject_profile_id: deciderId,
      type: 'baseline_rejected',
      message: `Your baseline change request was rejected: ${trimmed}\n#project=${data.project_id}`,
      email: true,
    }]);
  }
  return data;
}

// Compare two snapshots and return the list of changed fields.
// Used by the approval modal to highlight what changed.
export function computeSnapshotDiff(before, after) {
  const changes = { project: [], tasks: [], milestones: [], indentItems: [], taskAmounts: [] };
  for (const field of ['name', 'description', 'start_date', 'end_date']) {
    if ((before?.project?.[field] ?? null) !== (after?.project?.[field] ?? null)) {
      changes.project.push({ field, before: before?.project?.[field] ?? null, after: after?.project?.[field] ?? null });
    }
  }
  const beforeTasks = new Map((before?.tasks ?? []).map((t) => [t.id, t]));
  for (const at of after?.tasks ?? []) {
    const bt = beforeTasks.get(at.id);
    if (!bt) continue;
    const startChanged = (bt.start_date ?? null) !== (at.start_date ?? null);
    const endChanged = (bt.end_date ?? null) !== (at.end_date ?? null);
    if (startChanged || endChanged) {
      changes.tasks.push({
        id: at.id, name: at.name,
        start: { before: bt.start_date ?? null, after: at.start_date ?? null, changed: startChanged },
        end:   { before: bt.end_date ?? null,   after: at.end_date ?? null,   changed: endChanged },
      });
    }
  }
  const beforeMs = new Map((before?.milestones ?? []).map((m) => [m.id, m]));
  for (const am of after?.milestones ?? []) {
    const bm = beforeMs.get(am.id);
    if (!bm) continue;
    if ((bm.target_date ?? null) !== (am.target_date ?? null)) {
      changes.milestones.push({
        id: am.id, name: am.name,
        before: bm.target_date ?? null, after: am.target_date ?? null,
      });
    }
  }
  const beforeIndent = new Map((before?.indent_items ?? []).map((it) => [it.id, it]));
  for (const ait of after?.indent_items ?? []) {
    const bit = beforeIndent.get(ait.id);
    if (!bit) continue;
    for (const f of ['planned_amount', 'buy_qty', 'unit_price']) {
      if ((bit[f] ?? null) !== (ait[f] ?? null)) {
        changes.indentItems.push({
          id: ait.id, name: ait.item_name, field: f,
          before: bit[f] ?? null, after: ait[f] ?? null,
        });
      }
    }
  }
  const beforeTaskAmt = new Map((before?.task_amounts ?? []).map((a) => [a.task_id, a]));
  for (const at of after?.task_amounts ?? []) {
    const bt = beforeTaskAmt.get(at.task_id);
    if (!bt) continue;
    if ((bt.planned_amount ?? null) !== (at.planned_amount ?? null)) {
      changes.taskAmounts.push({
        task_id: at.task_id, name: at.task_name,
        before: bt.planned_amount ?? null, after: at.planned_amount ?? null,
      });
    }
  }
  return changes;
}
