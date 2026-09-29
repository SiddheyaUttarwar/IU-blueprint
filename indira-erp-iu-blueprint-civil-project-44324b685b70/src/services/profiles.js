import { supabase } from '../lib/supabaseClient.js';

export async function getMyProfile() {
  const { data: userData } = await supabase.auth.getUser();
  const uid = userData?.user?.id;
  if (!uid) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('auth_user_id', uid)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;
  // SSO fallback: OAuth-created auth id won't match the invite auth id.
  // link_my_profile() (SECURITY DEFINER) finds by email and links auth_user_id on first SSO login.
  const { data: linked, error: rpcErr } = await supabase.rpc('link_my_profile');
  if (rpcErr) throw rpcErr;
  return linked ?? null;
}

export async function clearMustChangePassword(profileId) {
  const { error } = await supabase
    .from('profiles')
    .update({ must_change_password: false })
    .eq('id', profileId);
  if (error) throw error;
}

export async function listProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role, roles')
    .order('email', { ascending: true });
  if (error) throw error;
  return data ?? [];
}
