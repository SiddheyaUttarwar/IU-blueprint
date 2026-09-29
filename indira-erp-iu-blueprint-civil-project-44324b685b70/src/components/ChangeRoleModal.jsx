import { useEffect, useState } from 'react';
import { ROLE_DISPLAY_ORDER, ROLE_LABELS } from '../services/roles.js';

export default function ChangeRoleModal({ open, profile, onCancel, onSave, busy = false }) {
  const initial = new Set(profile?.roles?.length ? profile.roles : [profile?.role].filter(Boolean));
  const [selected, setSelected] = useState(initial);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(new Set(profile?.roles?.length ? profile.roles : [profile?.role].filter(Boolean)));
      setError('');
    }
  }, [open, profile]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open || !profile) return null;

  function toggle(role) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  function handleSave() {
    if (selected.size === 0) {
      setError('Assign at least one role.');
      return;
    }
    onSave([...selected]);
  }

  const displayName = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="crm-title">
      <div className="modal">
        <div className="modal__header">
          <h3 id="crm-title" className="modal__title">Change Roles</h3>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal__body">
          <p className="modal__subtitle">Assigning roles for <b>{displayName}</b> ({profile.email})</p>
          <ul className="role-check-list">
            {ROLE_DISPLAY_ORDER.map((r) => (
              <li key={r}>
                <label className="role-check">
                  <input
                    type="checkbox"
                    checked={selected.has(r)}
                    onChange={() => toggle(r)}
                    disabled={busy}
                  />
                  <span>{ROLE_LABELS[r]}</span>
                </label>
              </li>
            ))}
          </ul>
          {error && <div className="form-errors" role="alert"><div className="form-errors__title">{error}</div></div>}
        </div>
        <div className="modal__footer">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary btn-primary--sm" onClick={handleSave} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
