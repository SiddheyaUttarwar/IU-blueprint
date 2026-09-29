import React, { useEffect, useMemo, useState } from 'react';

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

// PM-facing modal. Collects proposed changes to:
//  - project name / description / planned start / planned end (auto-fetched from earliest/latest task if project fields are empty)
//  - planned start/end for every LEAF task (summary rows roll up from children)
//  - target date for every milestone
// Submits a baseline_change_request with before/after snapshots + a mandatory reason.
// Nothing is written to project_tasks/projects/project_milestones directly — the leadership
// approval step applies the diff and captures baselines.
export default function ChangeBaselineModal({ project, structure, onClose, onSubmit }) {
  // Compute earliest task start / latest task end so we can pre-fill project Planned Start/End when null.
  const leafRange = useMemo(() => {
    const parentIds = new Set((structure.tasks ?? []).map((t) => t.parent_task_id).filter(Boolean));
    let s = null, e = null;
    for (const t of structure.tasks ?? []) {
      if (parentIds.has(t.id)) continue; // summary — skip
      if (t.start_date && (!s || t.start_date < s)) s = t.start_date;
      if (t.end_date && (!e || t.end_date > e)) e = t.end_date;
    }
    return { start: s, end: e };
  }, [structure]);

  const initial = useMemo(() => ({
    project: {
      name: project.name ?? '',
      description: project.description ?? '',
      start_date: project.start_date || leafRange.start || '',
      end_date: project.end_date || leafRange.end || '',
    },
    tasks: (structure.tasks ?? []).map((t) => ({
      id: t.id,
      parent_task_id: t.parent_task_id ?? null,
      name: t.name,
      task_type: t.task_type,
      start_date: t.start_date ?? '',
      end_date: t.end_date ?? '',
    })),
    milestones: (structure.milestones ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      target_date: m.target_date ?? '',
    })),
  }), [project, structure, leafRange]);

  const [after, setAfter] = useState(initial);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // Build a nested tree for readability using parent_task_id.
  const tree = useMemo(() => {
    const byId = new Map(after.tasks.map((t) => [t.id, { ...t, children: [] }]));
    const roots = [];
    for (const t of byId.values()) {
      if (t.parent_task_id && byId.has(t.parent_task_id)) byId.get(t.parent_task_id).children.push(t);
      else roots.push(t);
    }
    return roots;
  }, [after.tasks]);

  function patchProject(field, value) {
    setAfter((prev) => ({ ...prev, project: { ...prev.project, [field]: value } }));
  }
  function patchTask(id, field, value) {
    setAfter((prev) => ({
      ...prev,
      tasks: prev.tasks.map((t) => (t.id === id ? { ...t, [field]: value } : t)),
    }));
  }
  function patchMilestone(id, value) {
    setAfter((prev) => ({
      ...prev,
      milestones: prev.milestones.map((m) => (m.id === id ? { ...m, target_date: value } : m)),
    }));
  }

  const changedCount = useMemo(() => {
    let n = 0;
    for (const k of ['name', 'description', 'start_date', 'end_date']) {
      if ((initial.project[k] ?? '') !== (after.project[k] ?? '')) n += 1;
    }
    const initTaskMap = new Map(initial.tasks.map((t) => [t.id, t]));
    for (const t of after.tasks) {
      const it = initTaskMap.get(t.id);
      if (!it) continue;
      if ((it.start_date ?? '') !== (t.start_date ?? '')) n += 1;
      if ((it.end_date ?? '') !== (t.end_date ?? '')) n += 1;
    }
    const initMsMap = new Map(initial.milestones.map((m) => [m.id, m]));
    for (const m of after.milestones) {
      const im = initMsMap.get(m.id);
      if (!im) continue;
      if ((im.target_date ?? '') !== (m.target_date ?? '')) n += 1;
    }
    return n;
  }, [after, initial]);

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (changedCount === 0) { setError('No changes to submit.'); return; }
    if (reason.trim().length < 20) { setError('Reason must be at least 20 characters.'); return; }
    // BUG-14: don't submit impossible date windows. Approving them would break rollups + earned-schedule.
    if (after.project.start_date && after.project.end_date && after.project.end_date < after.project.start_date) {
      setError(`Project planned end (${after.project.end_date}) cannot be before planned start (${after.project.start_date}).`);
      return;
    }
    for (const t of after.tasks) {
      if (t.start_date && t.end_date && t.end_date < t.start_date) {
        setError(`Task "${t.name}": end date (${t.end_date}) cannot be before start date (${t.start_date}).`);
        return;
      }
    }
    setBusy(true);
    try {
      await onSubmit({ beforeSnapshot: initial, afterSnapshot: after, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err.message || 'Failed to submit baseline change request.');
    } finally { setBusy(false); }
  }

  // Summary date range from leaf descendants — mirrors the ProjectDetail rollup.
  function summaryRange(node) {
    let s = null, e = null;
    function walk(n) {
      if (n.children?.length) n.children.forEach(walk);
      else {
        if (n.start_date && (!s || n.start_date < s)) s = n.start_date;
        if (n.end_date && (!e || n.end_date > e)) e = n.end_date;
      }
    }
    walk(node);
    return { start: s, end: e };
  }

  function renderTaskRow(t, wbs, depth) {
    const isSummary = (t.children?.length ?? 0) > 0;
    const initTask = initial.tasks.find((x) => x.id === t.id);
    const startChanged = initTask && (initTask.start_date ?? '') !== (t.start_date ?? '');
    const endChanged = initTask && (initTask.end_date ?? '') !== (t.end_date ?? '');
    const range = isSummary ? summaryRange(t) : { start: t.start_date, end: t.end_date };
    const days = daysBetween(range.start, range.end);
    return (
      <React.Fragment key={t.id}>
        <div className={`bcr-row${isSummary ? ' bcr-row--summary' : ''}`}>
          <div className="bcr-row__wbs">{wbs}</div>
          <div className="bcr-row__name" style={{ paddingLeft: depth * 14 }} title={t.name}>
            {isSummary ? 'Σ ' : '• '}{t.name}
          </div>
          {isSummary ? (
            <div className="bcr-row__ro">{range.start ? new Date(range.start).toLocaleDateString() : '—'}</div>
          ) : (
            <input
              type="date" className="tpl-input"
              value={t.start_date || ''}
              onChange={(e) => patchTask(t.id, 'start_date', e.target.value)}
              title="Planned start"
              style={startChanged ? { background: '#fef3c7', borderColor: '#f59e0b' } : undefined}
            />
          )}
          {isSummary ? (
            <div className="bcr-row__ro">{range.end ? new Date(range.end).toLocaleDateString() : '—'}</div>
          ) : (
            <input
              type="date" className="tpl-input"
              value={t.end_date || ''}
              onChange={(e) => patchTask(t.id, 'end_date', e.target.value)}
              title="Planned end"
              style={endChanged ? { background: '#fef3c7', borderColor: '#f59e0b' } : undefined}
            />
          )}
          <div className="bcr-row__days">{days ?? '—'}</div>
        </div>
        {t.children?.map((c, i) => renderTaskRow(c, `${wbs}.${i + 1}`, depth + 1))}
      </React.Fragment>
    );
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card--wide" style={{ maxWidth: 900 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div>
            <h3 style={{ margin: 0 }}>Change Baseline</h3>
            <div className="form-hint" style={{ marginTop: 4 }}>
              Propose changes to the project baseline. A leadership user must approve before anything applies.
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>
        <form onSubmit={submit}>
          <div className="bcr-section">
            <div className="bcr-section__title">Project</div>
            <label className="login-field">
              <span>Project Name</span>
              <input type="text" value={after.project.name} onChange={(e) => patchProject('name', e.target.value)} maxLength={200} required />
            </label>
            <label className="login-field">
              <span>Description</span>
              <textarea value={after.project.description ?? ''} onChange={(e) => patchProject('description', e.target.value)} rows={3} maxLength={1000} />
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label className="login-field">
                <span>Planned Start</span>
                <input type="date" value={after.project.start_date ?? ''} onChange={(e) => patchProject('start_date', e.target.value)} />
              </label>
              <label className="login-field">
                <span>Planned End</span>
                <input type="date" value={after.project.end_date ?? ''} onChange={(e) => patchProject('end_date', e.target.value)} />
              </label>
            </div>
          </div>

          <div className="bcr-section">
            <div className="bcr-section__title">
              Tasks &amp; Subtasks
              <span className="form-hint" style={{ marginLeft: 8, fontWeight: 400 }}>
                Only leaf tasks are directly editable. Summary dates roll up from their children.
              </span>
            </div>
            <div className="bcr-table">
              <div className="bcr-row bcr-row--head">
                <div>WBS</div><div>Task</div><div>Planned Start</div><div>Planned End</div><div>Days</div>
              </div>
              {tree.length === 0
                ? <div className="form-hint" style={{ padding: 8 }}>No tasks in this project.</div>
                : tree.map((t, i) => renderTaskRow(t, String(i + 1), 0))}
            </div>
          </div>

          {after.milestones.length > 0 && (
            <div className="bcr-section">
              <div className="bcr-section__title">Milestones</div>
              <div className="bcr-table">
                <div className="bcr-row bcr-row--head bcr-row--ms">
                  <div>Milestone</div><div>Target Date</div>
                </div>
                {after.milestones.map((m) => {
                  const im = initial.milestones.find((x) => x.id === m.id);
                  const changed = im && (im.target_date ?? '') !== (m.target_date ?? '');
                  return (
                    <div key={m.id} className="bcr-row bcr-row--ms">
                      <div className="bcr-row__name">◆ {m.name}</div>
                      <input
                        type="date" className="tpl-input"
                        value={m.target_date || ''}
                        onChange={(e) => patchMilestone(m.id, e.target.value)}
                        style={changed ? { background: '#fef3c7', borderColor: '#f59e0b' } : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="bcr-section">
            <label className="login-field">
              <span>Reason for baseline change <span style={{ color: '#dc2626' }}>*</span></span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                minLength={20}
                maxLength={1000}
                required
                placeholder="Explain why this baseline needs to change. Leadership will see this along with the diff."
              />
              <span className="form-hint">{reason.trim().length}/20 characters minimum</span>
            </label>
          </div>

          {error && <div className="form-errors" role="alert"><div className="form-errors__title">{error}</div></div>}

          <div className="modal-card__actions" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="form-hint">
              {changedCount === 0 ? 'No changes yet.' : `${changedCount} field${changedCount === 1 ? '' : 's'} changed.`}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="submit" className="btn-primary btn-primary--sm" disabled={busy || changedCount === 0}>
                {busy ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
