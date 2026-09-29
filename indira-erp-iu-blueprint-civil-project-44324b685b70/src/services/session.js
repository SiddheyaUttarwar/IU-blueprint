import { supabase } from '../lib/supabaseClient.js';

export async function initSession() {
  const { data, error } = await supabase.functions.invoke('session-init', { body: {} });
  if (error) throw new Error(error.message || 'session-init failed');
  return data;
}
