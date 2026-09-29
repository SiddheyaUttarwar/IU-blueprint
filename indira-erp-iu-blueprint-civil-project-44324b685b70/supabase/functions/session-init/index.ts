import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) throw new Error('unauthenticated');
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const userClient = createClient(url, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) throw new Error('unauthenticated');
    const authUser = userData.user;

    const admin = adminClient();
    const { data: profile, error: pErr } = await admin
      .from('profiles')
      .select('*')
      .ilike('email', authUser.email ?? '')
      .maybeSingle();
    if (pErr) throw pErr;

    if (!profile) {
      return new Response(JSON.stringify({ enrolled: false }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const patches: Record<string, unknown> = {};
    if (profile.auth_user_id !== authUser.id) patches.auth_user_id = authUser.id;

    const isFirstLogin = !profile.first_login_at;
    if (isFirstLogin) patches.first_login_at = new Date().toISOString();

    const provider = authUser.app_metadata?.provider;
    if (provider && provider !== 'email' && profile.source !== 'sso') patches.source = 'sso';

    let updated = profile;
    if (Object.keys(patches).length) {
      const { data: u, error: uErr } = await admin
        .from('profiles')
        .update(patches)
        .eq('id', profile.id)
        .select()
        .single();
      if (uErr) throw uErr;
      updated = u;
    }

    if (isFirstLogin && profile.enrolled_by) {
      const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email;
      await admin.from('notifications').insert({
        recipient_profile_id: profile.enrolled_by,
        subject_profile_id: profile.id,
        type: 'first_login',
        message: `${displayName} signed in for the first time.`,
      });
    }

    return new Response(JSON.stringify({ enrolled: true, profile: updated }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const status = msg === 'unauthenticated' ? 401 : 400;
    return new Response(JSON.stringify({ error: msg }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
