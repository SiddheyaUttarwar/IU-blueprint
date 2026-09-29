import { useEffect, useState } from 'react';

// Small modal used from IndentSection + BudgetSection to submit a targeted amount change
// through the baseline_change_requests approval queue. Keeps the request payload minimal:
// only the one item/task being edited is included in the before/after snapshots.
// target = 'indent_item' | 'task_amount'
export default function AmountChangeBaselineModal({
  target, entity, currentValues, onClose, onSubmit,
}) {
  const [values, setValues] = useState(() => ({ ...currentValues }));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const fields = target === 'indent_item'
    ? [
        { key: 'buy_qty',        label: 'Quantity Indented' },
        { key: 'unit_price',     label: 'Amount per Item' },
        { key: 'planned_amount', label: 'Planned Amount Override' },
      ]
    : [
        { key: 'planned_amount', label: 'Planned Amount' },
      ];

  const changed = fields.filter((f) => (currentValues[f.key] ?? null) !== (values[f.key] ?? null));

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (changed.length === 0) { setError('No changes to submit.'); return; }
    if (reason.trim().length < 20) { setError('Reason must be at least 20 characters.'); return; }
    setBusy(true);
    try {
      await onSubmit({ afterValues: values, reason: reason.trim() });
      onClose();
    } catch (err) { setError(err.message || 'Failed to submit.'); } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>Change Baseline — {target === 'indent_item' ? 'Indent Item' : 'Task Budget'}</h3>
        <div className="form-hint" style={{ marginBottom: 10 }}>
          <b>{entity.name}</b> — changes go to Leadership for approval. Nothing applies until approved.
        </div>
        <form onSubmit={submit}>
          {fields.map((f) => {
            const changedNow = (currentValues[f.key] ?? null) !== (values[f.key] ?? null);
            return (
              <label key={f.key} className="login-field">
                <span>{f.label} {changedNow && <span style={{ color: '#f59e0b', fontWeight: 600 }}>(changed)</span>}</span>
                <input
                  type="number" step="any" min={0}
                  value={values[f.key] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value === '' ? null : Number(e.target.value) }))}
                  placeholder={currentValues[f.key] != null ? `Current: ${currentValues[f.key]}` : '—'}
                  style={changedNow ? { background: '#fef3c7', borderColor: '#f59e0b' } : undefined}
                />
              </label>
            );
          })}
          <label className="login-field">
            <span>Reason for baseline change <span style={{ color: '#dc2626' }}>*</span></span>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3} minLength={20} maxLength={1000} required
              placeholder="Why is this amount changing? Leadership will see this."
            />
            <span className="form-hint">{reason.trim().length}/20 characters minimum</span>
          </label>
          {error && <div className="form-errors" role="alert"><div className="form-errors__title">{error}</div></div>}
          <div className="modal-card__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="form-hint">{changed.length === 0 ? 'No fields changed.' : `${changed.length} field${changed.length === 1 ? '' : 's'} changed.`}</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn-primary btn-primary--sm" disabled={busy || changed.length === 0}>
                {busy ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
