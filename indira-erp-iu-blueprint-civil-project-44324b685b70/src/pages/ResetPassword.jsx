import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient.js';
import { updatePassword, signOut } from '../services/auth.js';
import { IconEye, IconEyeOff } from '../components/Icons.jsx';

export default function ResetPassword() {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setHasSession(!!data.session);
      setLoading(false);
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setBusy(true);
    const { error: updateError } = await updatePassword(password);
    if (updateError) {
      setError(updateError.message);
      setBusy(false);
      return;
    }
    setDone(true);
    await signOut();
    setTimeout(() => navigate('/login', { replace: true }), 1500);
  }

  if (loading) return null;

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
          {!hasSession ? (
            <>
              <div className="login-header">
                <h1 className="login-title">Invalid or expired link</h1>
                <p className="login-subtitle">
                  This reset link is no longer valid. Request a new one from the sign-in page.
                </p>
              </div>
              <button
                type="button"
                className="btn-primary"
                onClick={() => navigate('/login', { replace: true })}
              >
                Back to sign in
              </button>
            </>
          ) : done ? (
            <>
              <div className="login-header">
                <h1 className="login-title">Password updated</h1>
                <p className="login-subtitle">Redirecting you to sign in with your new password…</p>
              </div>
            </>
          ) : (
            <>
              <div className="login-header">
                <h1 className="login-title">Set a new password</h1>
                <p className="login-subtitle">Choose a password you don&apos;t use anywhere else.</p>
              </div>

              <form onSubmit={handleSubmit} className="login-form">
                <div className="login-field">
                  <div className="login-field__label-row">
                    <span>New password</span>
                  </div>
                  <div className="login-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="new-password"
                      minLength={6}
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
                  <span>Confirm new password</span>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    autoComplete="new-password"
                    minLength={6}
                  />
                </label>

                {error && <div className="login-error">{error}</div>}

                <button type="submit" className="btn-primary" disabled={busy}>
                  {busy ? 'Updating…' : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
