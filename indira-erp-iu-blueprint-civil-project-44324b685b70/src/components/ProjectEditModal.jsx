import { useEffect, useState } from 'react';

export default function ProjectEditModal({ project, onClose, onSave }) {
  const [name, setName] = useState(project.name ?? '');
  const [description, setDescription] = useState(project.description ?? '');
  const [startDate, setStartDate] = useState(project.start_date ?? '');
  const [endDate, setEndDate] = useState(project.end_date ?? '');
  const [actualStart, setActualStart] = useState(project.actual_start_date ?? '');
  const [actualEnd, setActualEnd] = useState(project.actual_end_date ?? '');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e) {
    e.preventDefault();
    if (startDate && endDate && startDate > endDate) { alert('End date cannot be before start date.'); return; }
    if (!name.trim()) { alert('Project name is required.'); return; }
    setBusy(true);
    try {
      await onSave({
        name: name.trim(),
        description: description?.trim() || null,
        start_date: startDate || null,
        end_date: endDate || null,
        actual_start_date: actualStart || null,
        actual_end_date: actualEnd || null,
      });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card--wide">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Change Baseline</h3>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <label className="login-field">
            <span>Project Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
          </label>
          <label className="login-field">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000} />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label className="login-field">
              <span>Planned Start</span>
              <input type="date" value={startDate ?? ''} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label className="login-field">
              <span>Planned End</span>
              <input type="date" value={endDate ?? ''} onChange={(e) => setEndDate(e.target.value)} />
            </label>
            <label className="login-field">
              <span>Actual Start</span>
              <input type="date" value={actualStart ?? ''} onChange={(e) => setActualStart(e.target.value)} />
            </label>
            <label className="login-field">
              <span>Actual End</span>
              <input type="date" value={actualEnd ?? ''} onChange={(e) => setActualEnd(e.target.value)} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
