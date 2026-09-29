import { useEffect, useState } from 'react';
import AssigneePicker from './AssigneePicker.jsx';

export default function TaskEditModal({ task, profiles, onClose, onSave, requireReason = true }) {
  const nameLocked = !!task.source_template_task_id;
  const [name, setName] = useState(task.name ?? '');
  const [startDate, setStartDate] = useState(task.start_date ?? '');
  const [endDate, setEndDate] = useState(task.end_date ?? '');
  const [assignedIds, setAssignedIds] = useState(Array.isArray(task.assigned_to_ids) ? task.assigned_to_ids : []);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);

  const startChanged = (startDate || '') !== (task.start_date ?? '');
  const endChanged = (endDate || '') !== (task.end_date ?? '');
  const datesChanged = startChanged || endChanged;
  const reasonNeeded = requireReason && datesChanged;

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (startDate && endDate && startDate > endDate) { alert('End date cannot be before start date.'); return; }
    if (reasonNeeded && !reason.trim()) {
      setReasonError('Please state why dates are changing — this is stored on the baseline for audit.');
      return;
    }
    setBusy(true);
    try {
      const patch = {
        start_date: startDate || null,
        end_date: endDate || null,
        assigned_to_ids: assignedIds,
      };
      if (!nameLocked) patch.name = (name ?? '').trim();
      if (reasonNeeded) patch._baselineReason = reason.trim(); // consumed by handleSaveTaskEdit → writeBaseline({ reason })
      await onSave(patch);
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>Edit task</h3>
        <form onSubmit={submit}>
          <label className="login-field">
            <span>Name {nameLocked && <em className="form-hint">(locked — from template)</em>}</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={nameLocked} maxLength={200} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="login-field">
              <span>Start Date</span>
              <input type="date" value={startDate ?? ''} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="login-field">
              <span>End Date</span>
              <input type="date" value={endDate ?? ''} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <label className="login-field">
            <span>Assignees</span>
            <AssigneePicker
              profiles={profiles ?? []}
              selected={assignedIds}
              onToggle={(id) => setAssignedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])}
            />
          </label>
          {reasonNeeded && (
            <label className={`login-field${reasonError ? ' login-field--invalid' : ''}`}>
              <span>Reason for date change<span style={{ color: '#b02a37' }}>*</span></span>
              <input
                type="text"
                value={reason}
                onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(''); }}
                placeholder="e.g. Weather delay — monsoon spillover"
                maxLength={200}
                autoFocus
              />
              {reasonError
                ? <span className="form-error-inline">{reasonError}</span>
                : <span className="form-hint">Required. Stored on the baseline so future audits know why the plan shifted.</span>}
            </label>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
