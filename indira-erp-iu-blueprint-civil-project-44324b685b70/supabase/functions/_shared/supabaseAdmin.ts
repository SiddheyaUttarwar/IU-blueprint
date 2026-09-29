import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

export function adminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function requireAdminCaller(authHeader: string | null) {
  if (!authHeader) throw new Error('unauthenticated');
  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) throw new Error('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) throw new Error('unauthenticated');

  const admin = adminClient();
  const { data: profile, error: pErr } = await admin
    .from('profiles')
    .select('id, role, email')
    .eq('auth_user_id', userData.user.id)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!profile || profile.role !== 'project_admin') throw new Error('forbidden');
  return { authUser: userData.user, profile };
}
