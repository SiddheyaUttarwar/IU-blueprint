import { useEffect, useState } from 'react';
import { signInWithEmail, signInWithMicrosoft, resetPassword, checkInvitationPending } from '../services/auth.js';
import { IconEye, IconEyeOff } from '../components/Icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { enrollmentError, clearEnrollmentError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (enrollmentError) {
      setError(enrollmentError);
      setBusy(false);
    }
  }, [enrollmentError]);

  function resetMessages() {
    setError('');
    setInfo('');
    clearEnrollmentError();
  }

  async function handleEmailSubmit(e) {
    e.preventDefault();
    resetMessages();
    setBusy(true);
    const { error: signInError } = await signInWithEmail(email, password);
    if (signInError) {
      // BUG-19: keep the generic "invalid credentials" for the unknown-email / wrong-password case
      // (avoids user enumeration), but rescue the "invited but never logged in" case with a hint
      // that actually helps. The RPC returns true ONLY for that specific state.
      const pending = email ? await checkInvitationPending(email) : false;
      if (pending) {
        setError('You are registered but have not set a password yet. Please open the invitation link we emailed you and set your password before signing in.');
      } else {
        setError(signInError.message);
      }
      setBusy(false);
    }
  }

  async function handleMicrosoft() {
    resetMessages();
    setBusy(true);
    const { error: oauthError } = await signInWithMicrosoft();
    if (oauthError) {
      setError(oauthError.message);
      setBusy(false);
    }
  }

  async function handleForgotPassword() {
    resetMessages();
    if (!email) {
      setError('Enter your email above, then click "Forgot password?".');
      return;
    }
    setBusy(true);
    const { error: resetError } = await resetPassword(email);
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
    } else {
      setInfo(`Password reset link sent to ${email}. Check your inbox.`);
    }
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
          <div className="login-header">
            <h1 className="login-title">Welcome</h1>
            <p className="login-subtitle">Sign in to your account</p>
          </div>

          <button
            type="button"
            className="btn-microsoft"
            onClick={handleMicrosoft}
            disabled={busy}
          >
            <MicrosoftLogo />
            Sign in with Microsoft
          </button>

          <div className="login-divider">
            <span>or continue with email</span>
          </div>

          <form onSubmit={handleEmailSubmit} className="login-form">
            <label className="login-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </label>

            <div className="login-field">
              <div className="login-field__label-row">
                <span>Password</span>
                <button
                  type="button"
                  className="login-forgot"
                  onClick={handleForgotPassword}
                  disabled={busy}
                >
                  Forgot password?
                </button>
              </div>
              <div className="login-input-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
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

            {error && <div className="login-error">{error}</div>}
            {info && <div className="login-info">{info}</div>}

            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}

function MicrosoftLogo() {
  return (
    <svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

