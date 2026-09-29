import { useEffect, useMemo, useState } from 'react';
import RequiredMark from './RequiredMark.jsx';

export default function AddProjectTemplateModal({ open, projectTypes, existingNames, onCancel, onSave, busy = false }) {
  const [projectTypeId, setProjectTypeId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (open) {
      setProjectTypeId('');
      setName('');
      setDescription('');
      setErrors({});
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const activeTypes = useMemo(() => (projectTypes ?? []).filter((t) => t.is_active !== false), [projectTypes]);
  const nameLocked = !projectTypeId;

  function clearError(k) {
    setErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  }

  function handleSave() {
    const next = {};
    const trimmed = name.trim();
    if (!trimmed) next.name = 'Template name is required.';
    else if ((existingNames ?? []).some((n) => n.toLowerCase() === trimmed.toLowerCase())) {
      next.name = 'A template with this name already exists.';
    }
    if (!projectTypeId) next.projectTypeId = 'Select a project type first.';
    setErrors(next);
    if (Object.keys(next).length) return;
    // New templates always start as drafts — they only become visible to others
    // when the user clicks Save (publish) on the Build Structure page.
    onSave({
      projectTypeId,
      name: trimmed,
      description: description.trim() || null,
      isDraft: true,
    });
  }

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="apt-title">
      <div className="modal modal--wide">
        <div className="modal__header">
          <h3 id="apt-title" className="modal__title">Add Project Template</h3>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal__body">
          <label className={`login-field${errors.projectTypeId ? ' login-field--invalid' : ''}`}>
            <span>Project Type<RequiredMark /></span>
            <select
              value={projectTypeId}
              onChange={(e) => { setProjectTypeId(e.target.value); clearError('projectTypeId'); }}
              aria-invalid={!!errors.projectTypeId}
              autoFocus
            >
              <option value="">Select project type…</option>
              {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {errors.projectTypeId && <span className="form-error-inline">{errors.projectTypeId}</span>}
            {!errors.projectTypeId && <span className="form-hint">Pick this first — template name unlocks after.</span>}
          </label>

          <label className={`login-field${errors.name ? ' login-field--invalid' : ''}`}>
            <span>Template Name<RequiredMark /></span>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); clearError('name'); }}
              placeholder="e.g. Multi-Storey Building — Standard"
              maxLength={140}
              disabled={nameLocked}
              aria-invalid={!!errors.name}
            />
            {errors.name && <span className="form-error-inline">{errors.name}</span>}
            {!errors.name && nameLocked && <span className="form-hint">Select a project type first.</span>}
          </label>

          <label className="login-field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Short summary of what this template is for."
            />
          </label>
        </div>
        <div className="modal__footer" style={{ gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="button" className="btn-primary btn-primary--sm" onClick={handleSave} disabled={busy}>
            {busy ? 'Creating…' : 'Create Template'}
          </button>
        </div>
        <div className="form-hint" style={{ padding: '0 16px 12px', fontSize: 12 }}>
          New templates start as a private draft. Add tasks on the next page, then click <b>Draft</b> to keep it private or <b>Save</b> to publish for everyone.
        </div>
      </div>
    </div>
  );
}
