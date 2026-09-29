import { supabase } from '../lib/supabaseClient.js';

export function signInWithEmail(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

// After a failed login, ask the DB whether this email has a pending invitation. Safe to expose
// for the invited case only — see check_invitation_pending() in schema.sql.
export async function checkInvitationPending(email) {
  try {
    const { data, error } = await supabase.rpc('check_invitation_pending', { check_email: email });
    if (error) return false;
    return !!data;
  } catch { return false; }
}

export function signInWithMicrosoft() {
  return supabase.auth.signInWithOAuth({
    provider: 'azure',
    options: {
      scopes: 'openid email profile',
      redirectTo: `${window.location.origin}/`,
      // BUG-20: domain_hint pre-selects the org tenant and skips the multi-domain account picker
      // in most cases. The hard rule is enforced post-callback in AuthContext regardless.
      queryParams: { domain_hint: 'indirauniversity.edu.in' },
    },
  });
}

export function resetPassword(email) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password`,
  });
}

export function updatePassword(newPassword) {
  return supabase.auth.updateUser({ password: newPassword });
}

// Verify the current session's password before allowing an update. Supabase doesn't require the
// current password on updateUser, so we re-authenticate against the session's email as a check
// (BUG-18). Fails cleanly if the caller lied about their old password.
export async function verifyCurrentPassword(currentPassword) {
  const { data: sess } = await supabase.auth.getUser();
  const email = sess?.user?.email;
  if (!email) return { ok: false, error: { message: 'No active session.' } };
  const { error } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
  if (error) return { ok: false, error };
  return { ok: true };
}

export function signOut() {
  return supabase.auth.signOut();
}
