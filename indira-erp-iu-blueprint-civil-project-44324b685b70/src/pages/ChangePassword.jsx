import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { updatePassword, verifyCurrentPassword } from '../services/auth.js';
import { clearMustChangePassword } from '../services/profiles.js';
import { useAuth } from '../context/AuthContext.jsx';
import { IconEye, IconEyeOff } from '../components/Icons.jsx';
import BackButton from '../components/BackButton.jsx';

const DEFAULT_PASSWORD = 'IndiraU@2026';

export default function ChangePassword() {
  const { profile, refreshProfile } = useAuth();
  // First-time users (must_change_password=true) skip the current-password gate — they don't have
  // one yet; the default was set by the invite flow. Everyone else must prove they know it.
  const requireCurrent = !profile?.must_change_password;
  const [currentPassword, setCurrentPassword] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (requireCurrent && !currentPassword) return setError('Enter your current password.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password === DEFAULT_PASSWORD) return setError('Pick a password different from the default.');
    if (requireCurrent && password === currentPassword) return setError('New password must be different from current password.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setBusy(true);
    if (requireCurrent) {
      const check = await verifyCurrentPassword(currentPassword);
      if (!check.ok) {
        setError('Current password is incorrect.');
        setBusy(false);
        return;
      }
    }
    const { error: updateErr } = await updatePassword(password);
    if (updateErr) {
      setError(updateErr.message);
      setBusy(false);
      return;
    }
    try {
      if (profile?.id) await clearMustChangePassword(profile.id);
      await refreshProfile();
    } catch (err) {
      setError(err.message || 'Password saved, but profile update failed.');
      setBusy(false);
      return;
    }
    setDone(true);
    setBusy(false);
    setTimeout(() => navigate('/', { replace: true }), 1200);
  }

  return (
    <>
      <BackButton label="Back" />
      <h2 className="page-title">Change Password</h2>
      <div className="card change-password-card">
        {done ? (
          <div className="login-info">Password updated. Redirecting…</div>
        ) : (
          <form onSubmit={handleSubmit} className="login-form">
            {requireCurrent && (
              <div className="login-field">
                <div className="login-field__label-row"><span>Current password</span></div>
                <div className="login-input-wrapper">
                  <input
                    type={showCurrent ? 'text' : 'password'}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="current-password"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="login-eye"
                    onClick={() => setShowCurrent((v) => !v)}
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                  >
                    {showCurrent ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </div>
            )}
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
            <div className="login-field">
              <div className="login-field__label-row"><span>Confirm new password</span></div>
              <div className="login-input-wrapper">
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="login-eye"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                >
                  {showConfirm ? <IconEyeOff /> : <IconEye />}
                </button>
              </div>
            </div>
            {error && <div className="login-error">{error}</div>}
            <button type="submit" className="btn-primary" disabled={busy}>
              {busy ? 'Updating…' : 'Update password'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
