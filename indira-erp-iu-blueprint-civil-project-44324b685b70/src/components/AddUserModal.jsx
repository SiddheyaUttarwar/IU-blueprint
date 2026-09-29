import { useEffect, useState } from 'react';
import RequiredMark from './RequiredMark.jsx';
import { ROLE_DISPLAY_ORDER, ROLE_LABELS } from '../services/roles.js';

// Single source of truth for role checkbox order; Add User + Change Roles both consume this.
const ROLES = ROLE_DISPLAY_ORDER.map((value) => ({ value, label: ROLE_LABELS[value] }));

// Require a domain with a real TLD (min 2 chars) so a@b, test@localhost, test@gamil all fail.
const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

export default function AddUserModal({ open, existingEmails = [], prefill = null, onCancel, onSave, busy = false, apiError = null }) {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [mobile, setMobile] = useState('');
  const [roles, setRoles] = useState(['member']);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setFirstName(prefill?.firstName ?? '');
      setLastName(prefill?.lastName ?? '');
      setEmail(prefill?.email ?? '');
      setMobile(prefill?.mobileNumber ?? '');
      setRoles(prefill?.roles ?? ['member']);
      setErrors({});
    }
  }, [open, prefill]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  function toggleRole(value) {
    setRoles((prev) => (prev.includes(value) ? prev.filter((r) => r !== value) : [...prev, value]));
  }

  function handleSubmit(e) {
    e.preventDefault();
    const next = {};
    const trimmedEmail = email.trim().toLowerCase();
    if (!firstName.trim()) next.firstName = 'First name is required.';
    if (!lastName.trim()) next.lastName = 'Last name is required.';
    if (!trimmedEmail) next.email = 'Email is required.';
    else if (!EMAIL_RE.test(trimmedEmail)) next.email = 'Enter a valid email address.';
    else if (existingEmails.some((e2) => e2.toLowerCase() === trimmedEmail)) {
      next.email = 'A user with this email is already enrolled.';
    }
    if (roles.length === 0) next.roles = 'Select at least one role.';
    setErrors(next);
    if (Object.keys(next).length) return;
    onSave({
      email: trimmedEmail,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mobileNumber: mobile.trim() || null,
      roles,
    });
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="au-title">
      <div className="modal modal--wide">
        <div className="modal__header">
          <h3 id="au-title" className="modal__title">Add User</h3>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal__body">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className={`login-field${errors.firstName ? ' login-field--invalid' : ''}`}>
                <span>First Name<RequiredMark /></span>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => { setFirstName(e.target.value); if (errors.firstName) setErrors({ ...errors, firstName: undefined }); }}
                  maxLength={80}
                  autoFocus
                />
                {errors.firstName && <span className="form-error-inline" role="alert">{errors.firstName}</span>}
              </label>
              <label className={`login-field${errors.lastName ? ' login-field--invalid' : ''}`}>
                <span>Last Name<RequiredMark /></span>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => { setLastName(e.target.value); if (errors.lastName) setErrors({ ...errors, lastName: undefined }); }}
                  maxLength={80}
                />
                {errors.lastName && <span className="form-error-inline" role="alert">{errors.lastName}</span>}
              </label>
            </div>

            <label className={`login-field${errors.email ? ' login-field--invalid' : ''}`}>
              <span>Email<RequiredMark /></span>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); if (errors.email) setErrors({ ...errors, email: undefined }); }}
                maxLength={200}
                autoComplete="off"
                required
                pattern="[a-zA-Z0-9._%+-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}"
                title="Enter a valid email address like name@example.com"
              />
              {errors.email && <span className="form-error-inline" role="alert">{errors.email}</span>}
              {!errors.email && <span className="form-hint">The user will receive a &ldquo;Set your password&rdquo; email at this address.</span>}
            </label>

            <label className="login-field">
              <span>Mobile Number</span>
              <input
                type="tel"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
                maxLength={20}
                autoComplete="off"
                placeholder="Optional"
              />
            </label>

            <div className={`login-field${errors.roles ? ' login-field--invalid' : ''}`}>
              <span>Roles<RequiredMark /></span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 6 }}>
                {ROLES.map((r) => (
                  <label key={r.value} className="inline-form__checkbox">
                    <input
                      type="checkbox"
                      checked={roles.includes(r.value)}
                      onChange={() => { toggleRole(r.value); if (errors.roles) setErrors({ ...errors, roles: undefined }); }}
                    />
                    <span>{r.label}</span>
                  </label>
                ))}
              </div>
              {errors.roles && <span className="form-error-inline" role="alert">{errors.roles}</span>}
            </div>
          </div>
          {apiError && (
            <div className="form-errors" role="alert" aria-live="assertive" style={{ margin: '0 16px 8px' }}>
              <div className="form-errors__title">Enrolment failed</div>
              <ul className="form-errors__list"><li>{apiError}</li></ul>
            </div>
          )}
          <div className="modal__footer">
            <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>
              {busy ? 'Enrolling…' : 'Enrol & Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
