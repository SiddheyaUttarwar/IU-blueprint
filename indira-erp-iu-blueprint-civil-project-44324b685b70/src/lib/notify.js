import { supabase } from './supabaseClient.js';

// Fire-and-forget helper. Inserts a batch of notifications.
// Rows with `email: true` are considered for SMTP delivery — the row is flagged email_pending
// ONLY if the recipient has not disabled the module the notification belongs to (per
// user_notification_prefs). Missing pref row = enabled by default. The in-app bell row is
// always inserted regardless of module preference.
// If the email/module columns don't exist yet (migration not applied) the insert falls back
// to a core-columns-only insert so the bell keeps working.
const CORE_COLS = ['recipient_profile_id', 'subject_profile_id', 'type', 'message'];

// Maps notification.type → notification_modules.key. Keep in sync with seed at
// supabase/migrations/20260908_location_notif_rag.sql.
const TYPE_TO_MODULE = {
  task_assigned: 'tasks',
  task_update: 'tasks',
  project_started: 'tasks',
  message_mention: 'mentions',
  message_posted: 'messages',
  indent_delivery: 'indent_deliveries',
  indent_item_added: 'indent_deliveries',
  document_uploaded: 'documents',
  funding_change: 'budget_variance',
  budget_change: 'budget_variance',
  baseline_pending: 'approvals',
  baseline_pending_receipt: 'baseline_changes',
  baseline_approved: 'baseline_changes',
  baseline_rejected: 'baseline_changes',
  baseline_dates_changed: 'baseline_changes',
  status_request_pending: 'approvals',
  status_request_approved: 'approvals',
  status_request_rejected: 'approvals',
  milestone_soon: 'milestones',
};

function stripToCore(row) {
  const out = {};
  for (const k of CORE_COLS) if (k in row) out[k] = row[k];
  return out;
}

// Returns Set of "userId|moduleKey" combos where the recipient has explicitly disabled email.
async function loadDisabledPairs(userIds, moduleKeys) {
  if (!userIds.length || !moduleKeys.length) return new Set();
  const { data: mods } = await supabase
    .from('notification_modules')
    .select('id, key')
    .in('key', moduleKeys);
  const modIdByKey = new Map((mods ?? []).map((m) => [m.key, m.id]));
  const modIds = [...modIdByKey.values()];
  if (!modIds.length) return new Set();
  const { data: prefs } = await supabase
    .from('user_notification_prefs')
    .select('user_id, module_id, enabled')
    .in('user_id', userIds)
    .in('module_id', modIds)
    .eq('enabled', false);
  const keyByModId = new Map([...modIdByKey.entries()].map(([k, v]) => [v, k]));
  const disabled = new Set();
  for (const p of prefs ?? []) {
    const k = keyByModId.get(p.module_id);
    if (k) disabled.add(`${p.user_id}|${k}`);
  }
  return disabled;
}

export async function notifyMany(rows) {
  const clean = (rows ?? []).filter((r) => r && r.recipient_profile_id);
  if (!clean.length) return;
  try {
    const needEmail = clean.filter((r) => r.email && !r.email_to).map((r) => r.recipient_profile_id);
    let emailByProfile = new Map();
    if (needEmail.length) {
      const { data: pfs } = await supabase.from('profiles').select('id, email').in('id', needEmail);
      emailByProfile = new Map((pfs ?? []).map((p) => [p.id, p.email]));
    }

    const emailRecipients = [...new Set(clean.filter((r) => r.email).map((r) => r.recipient_profile_id))];
    const moduleKeysInBatch = [...new Set(
      clean.filter((r) => r.email).map((r) => TYPE_TO_MODULE[r.type]).filter(Boolean),
    )];
    const disabled = await loadDisabledPairs(emailRecipients, moduleKeysInBatch);

    const payload = clean.map((r) => {
      const { email, ...rest } = r;
      const module_key = TYPE_TO_MODULE[r.type] ?? null;
      if (!email) return { ...rest, module_key };
      const to = r.email_to ?? emailByProfile.get(r.recipient_profile_id) ?? null;
      const optedOut = module_key && disabled.has(`${r.recipient_profile_id}|${module_key}`);
      return { ...rest, module_key, email_pending: !!to && !optedOut, email_to: to };
    });

    const { error } = await supabase.from('notifications').insert(payload);
    if (!error) return;
    // 42703 = undefined_column (migration not applied yet). Retry without email/module fields.
    if (error.code === '42703' || /email_pending|email_to|email_sent|module_key/.test(error.message || '')) {
      const fallback = payload.map(stripToCore);
      const { error: err2 } = await supabase.from('notifications').insert(fallback);
      if (err2) console.warn('notify insert (core-only) failed:', err2.message);
      return;
    }
    console.warn('notify insert failed:', error.message);
  } catch (err) {
    console.warn('notify failed:', err?.message);
  }
}

// Given a task-level context, return the project manager's profile id + set of assignee ids.
export async function resolveTaskAudience(taskId) {
  const { data } = await supabase
    .from('project_tasks')
    .select('assigned_to_ids, projects!project_tasks_project_id_fkey!inner ( id, name, project_manager_id )')
    .eq('id', taskId).single();
  const project = data?.projects ?? null;
  const assignees = new Set(Array.isArray(data?.assigned_to_ids) ? data.assigned_to_ids : []);
  return { project, assignees };
}
