import { supabase } from '../lib/supabaseClient.js';
import { notifyMany } from '../lib/notify.js';

export async function listMyNotifications(recipientProfileId, { limit = 20 } = {}) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_profile_id', recipientProfileId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function countUnread(recipientProfileId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_profile_id', recipientProfileId)
    .is('read_at', null);
  if (error) throw error;
  return count ?? 0;
}

export async function markRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId);
  if (error) throw error;
}

export async function markAllRead(recipientProfileId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_profile_id', recipientProfileId)
    .is('read_at', null);
  if (error) throw error;
}

// Phase K: milestone approaching pre-alerts (5-day window)
export async function ensureMilestoneAlerts(recipientProfileId, { windowDays = 5 } = {}) {
  if (!recipientProfileId) return 0;
  const today = new Date();
  const cutoff = new Date(today.getTime() + windowDays * 24 * 60 * 60 * 1000);
  const iso = cutoff.toISOString().slice(0, 10);
  const { data: ms, error } = await supabase
    .from('project_milestones')
    .select('id, name, target_date, project_id, projects!project_milestones_project_id_fkey!inner(id, name)')
    .not('target_date', 'is', null)
    .lte('target_date', iso)
    .gte('target_date', today.toISOString().slice(0, 10))
    .is('reached_date', null);
  if (error) throw error;
  if (!ms?.length) return 0;

  const { data: existing } = await supabase
    .from('notifications')
    .select('message')
    .eq('recipient_profile_id', recipientProfileId)
    .eq('type', 'milestone_soon');
  const seen = new Set((existing ?? []).map((r) => r.message));

  const rows = ms
    .map((m) => ({
      recipient_profile_id: recipientProfileId,
      type: 'milestone_soon',
      message: `Milestone "${m.name}" in "${m.projects?.name}" due ${m.target_date}`,
      email: true,
    }))
    .filter((r) => !seen.has(r.message));
  if (!rows.length) return 0;
  await notifyMany(rows);
  return rows.length;
}
