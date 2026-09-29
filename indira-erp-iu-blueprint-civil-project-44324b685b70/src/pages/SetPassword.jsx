import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';
import { updatePassword } from '../services/auth.js';
import { clearMustChangePassword } from '../services/profiles.js';
import { getMyProfile } from '../services/profiles.js';
import { IconEye, IconEyeOff } from '../components/Icons.jsx';

export default function SetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    async function completeAuth() {
      try {
        const url = new URL(window.location.href);
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type');
        const code = url.searchParams.get('code');

        if (tokenHash && type) {
          const { error: otpErr } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (otpErr) throw otpErr;
        } else if (code) {
          const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
          if (exErr) throw exErr;
        }

        window.history.replaceState({}, '', window.location.pathname);

        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setLinkError('Your invite link is invalid or has expired. Ask your Project Admin to re-send it.');
          return;
        }
        setReady(true);
      } catch (err) {
        setLinkError(err.message || 'Could not verify your invite link.');
      }
    }
    completeAuth();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');
    setBusy(true);
    const { error: updateErr } = await updatePassword(password);
    if (updateErr) {
      const msg = updateErr.message || '';
      const looksExpired = /expired|session|jwt|invalid|missing|auth/i.test(msg);
      setError(looksExpired
        ? 'Your invite link has expired or the session was lost. Please open the invite email again — if the link no longer works, ask your Project Admin to re-send it.'
        : msg || 'Could not set your password. Try again.');
      setBusy(false);
      return;
    }
    try {
      const me = await getMyProfile();
      if (me?.id) await clearMustChangePassword(me.id);
    } catch (err) {
      // Password was saved; only the flag-clear failed. Log and continue rather than blocking the user.
      console.warn('clearMustChangePassword failed (non-fatal):', err?.message ?? err);
    }
    setDone(true);
    setBusy(false);
    setTimeout(() => { window.location.href = '/'; }, 1200);
  }

  return (
    <div className="login-page">
      <aside className="login-brand">
        <div className="login-brand__card">
          <img src="/logo.png" alt="Indira BluePrint" className="login-brand__logo" />
          <h2 className="login-brand__name">Indira Blueprint</h2>
          <p className="login-brand__parent">Indira University</p>
          <p className="login-brand__tagline">Project Management System</p>
        </div>
      </aside>
      <section className="login-panel">
        <div className="login-card">
          {linkError ? (
            <>
              <div className="login-header">
                <h1 className="login-title">Invalid or expired link</h1>
                <p className="login-subtitle">{linkError}</p>
              </div>
              <button type="button" className="btn-primary" onClick={() => navigate('/login', { replace: true })}>
                Back to sign in
              </button>
            </>
          ) : !ready ? (
            <div className="login-header">
              <h1 className="login-title">Verifying your invite…</h1>
              <p className="login-subtitle">One moment.</p>
            </div>
          ) : done ? (
            <div className="login-header">
              <h1 className="login-title">Password set</h1>
              <p className="login-subtitle">Signing you in…</p>
            </div>
          ) : (
            <>
              <div className="login-header">
                <h1 className="login-title">Set your password</h1>
                <p className="login-subtitle">Choose a password to finish setting up your account. You must set a password before continuing.</p>
              </div>
              <form onSubmit={handleSubmit} className="login-form">
                <div className="login-field">
                  <div className="login-field__label-row"><span>New password</span></div>
                  <div className="login-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={8}
                      autoComplete="new-password"
                      autoFocus
                    />
                    <button
                      type="button"
                      className="login-eye"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </div>
                <label className="login-field">
                  <span>Confirm password</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                  />
                </label>
                {error && <div className="login-error">{error}</div>}
                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Set password'}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
