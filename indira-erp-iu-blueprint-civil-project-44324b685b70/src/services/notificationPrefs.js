import { supabase } from '../lib/supabaseClient.js';

export async function listNotificationModules() {
  const { data, error } = await supabase
    .from('notification_modules')
    .select('id, key, name, description, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order');
  if (error) throw error;
  return data ?? [];
}

// Returns Map(module_id → { enabled }) for the given user. Missing rows default to enabled=true.
export async function listPrefsForUser(userId) {
  if (!userId) return new Map();
  const { data, error } = await supabase
    .from('user_notification_prefs')
    .select('module_id, enabled')
    .eq('user_id', userId);
  if (error) throw error;
  const m = new Map();
  for (const r of data ?? []) m.set(r.module_id, r);
  return m;
}

export async function setPref(userId, moduleId, enabled) {
  const { data, error } = await supabase
    .from('user_notification_prefs')
    .upsert({ user_id: userId, module_id: moduleId, enabled, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,module_id' })
    .select('module_id, enabled').single();
  if (error) throw error;
  return data;
}
