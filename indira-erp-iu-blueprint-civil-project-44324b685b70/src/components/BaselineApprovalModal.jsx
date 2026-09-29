import React, { useEffect, useMemo, useState } from 'react';
import { computeSnapshotDiff } from '../services/baselineChangeRequests.js';

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

// Leadership-facing modal. Split-screen showing the full project structure BEFORE and AFTER
// the requested change, with every changed date highlighted. Approve applies the diff and writes
// baselines; reject requires a decision reason.
export default function BaselineApprovalModal({ request, onClose, onApprove, onReject, readOnly = false }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rejectMode, setRejectMode] = useState(false);
  const [decisionReason, setDecisionReason] = useState('');

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const diff = useMemo(() => computeSnapshotDiff(request.before_snapshot, request.after_snapshot), [request]);
  const totalChanges = diff.project.length + diff.tasks.length + diff.milestones.length + (diff.indentItems?.length ?? 0) + (diff.taskAmounts?.length ?? 0);
  const isScheduleRequest = diff.project.length + diff.tasks.length + diff.milestones.length > 0;
  const hasAmountChanges = (diff.indentItems?.length ?? 0) + (diff.taskAmounts?.length ?? 0) > 0;

  const beforeTree = useMemo(() => buildTree(request.before_snapshot?.tasks ?? []), [request]);
  const afterTree = useMemo(() => buildTree(request.after_snapshot?.tasks ?? []), [request]);

  const changedTaskIds = new Set(diff.tasks.map((t) => t.id));
  const changedMsIds = new Set(diff.milestones.map((m) => m.id));

  async function handleApprove() {
    setBusy(true); setError('');
    try {
      await onApprove({ requestId: request.id, decisionReason: decisionReason.trim() || null });
      onClose();
    } catch (err) {
      setError(err.message || 'Approval failed.');
    } finally { setBusy(false); }
  }
  async function handleReject() {
    setError('');
    if (decisionReason.trim().length < 5) { setError('Please provide a rejection reason (min 5 characters).'); return; }
    setBusy(true);
    try {
      await onReject({ requestId: request.id, decisionReason: decisionReason.trim() });
      onClose();
    } catch (err) {
      setError(err.message || 'Rejection failed.');
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card--wide" style={{ maxWidth: 1200, maxHeight: '90vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 12, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0 }}>Baseline Change Request</h3>
            <div className="form-hint" style={{ marginTop: 4 }}>
              Requested by <b>{fmtName(request.requester)}</b> on {new Date(request.requested_at).toLocaleString()} · {totalChanges} change{totalChanges === 1 ? '' : 's'}
            </div>
          </div>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close" disabled={busy}>×</button>
        </div>

        <div className="bcr-reason-box">
          <div className="bcr-reason-box__label">Reason from requester</div>
          <div className="bcr-reason-box__body">{request.reason}</div>
        </div>

        {isScheduleRequest && (
          <div className="bcr-split">
            <div className="bcr-split__pane">
              <div className="bcr-split__title">Before (current baseline)</div>
              <SnapshotView
                snapshot={request.before_snapshot}
                tree={beforeTree}
                changedTaskIds={changedTaskIds}
                changedMsIds={changedMsIds}
                side="before"
                projectDiff={diff.project}
              />
            </div>
            <div className="bcr-split__pane">
              <div className="bcr-split__title">After (proposed baseline)</div>
              <SnapshotView
                snapshot={request.after_snapshot}
                tree={afterTree}
                changedTaskIds={changedTaskIds}
                changedMsIds={changedMsIds}
                side="after"
                projectDiff={diff.project}
              />
            </div>
          </div>
        )}

        {hasAmountChanges && (
          <div className="bcr-amount-diffs">
            <h4 className="bcr-amount-diffs__title">Amount changes</h4>
            {diff.indentItems?.length > 0 && (
              <table className="bcr-amount-diffs__table">
                <thead>
                  <tr><th style={{ width: '35%' }}>Indent Item</th><th style={{ width: '20%' }}>Field</th><th style={{ width: '20%' }}>Before</th><th style={{ width: '25%' }}>After</th></tr>
                </thead>
                <tbody>
                  {diff.indentItems.map((c, i) => (
                    <tr key={`ii-${i}`}>
                      <td>{c.name}</td>
                      <td>{c.field.replace('_', ' ')}</td>
                      <td>{c.before ?? '—'}</td>
                      <td><b>{c.after ?? '—'}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {diff.taskAmounts?.length > 0 && (
              <table className="bcr-amount-diffs__table">
                <thead>
                  <tr><th style={{ width: '55%' }}>Task Budget</th><th style={{ width: '20%' }}>Before Planned</th><th style={{ width: '25%' }}>After Planned</th></tr>
                </thead>
                <tbody>
                  {diff.taskAmounts.map((c, i) => (
                    <tr key={`ta-${i}`}>
                      <td>{c.name || c.task_id}</td>
                      <td>{c.before != null ? `₹${Number(c.before).toLocaleString('en-IN')}` : '—'}</td>
                      <td><b>{c.after != null ? `₹${Number(c.after).toLocaleString('en-IN')}` : '—'}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {totalChanges === 0 && (
          <div className="form-hint" style={{ marginTop: 8, padding: 8, background: '#f5f7fa', borderRadius: 4 }}>
            No differences detected between the snapshots.
          </div>
        )}

        <div className="bcr-decision">
          {!readOnly && <label className="login-field">
            <span>{rejectMode ? 'Rejection reason (required)' : 'Decision note (optional)'}</span>
            <textarea
              value={decisionReason}
              onChange={(e) => setDecisionReason(e.target.value)}
              rows={2}
              maxLength={500}
              placeholder={rejectMode ? 'Why is this being rejected?' : 'Any note for the requester (optional).'}
            />
          </label>}
          {readOnly && request.decision_reason && (
            <div className="form-hint" style={{ marginTop: 8, padding: 8, background: '#f5f7fa', borderRadius: 4 }}>
              <b>Decision note:</b> {request.decision_reason}
            </div>
          )}
          {error && <div className="form-errors" role="alert"><div className="form-errors__title">{error}</div></div>}
          <div className="modal-card__actions" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Close</button>
            {!readOnly && (!rejectMode ? (
              <>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setRejectMode(true)} disabled={busy}>Reject…</button>
                <button type="button" className="btn-primary btn-primary--sm" onClick={handleApprove} disabled={busy || totalChanges === 0}>
                  {busy ? 'Applying…' : `Approve & Apply${totalChanges > 0 ? ` (${totalChanges})` : ''}`}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => { setRejectMode(false); setDecisionReason(''); }} disabled={busy}>Back</button>
                <button type="button" className="btn-primary btn-primary--sm" style={{ background: '#b3261e' }} onClick={handleReject} disabled={busy}>
                  {busy ? 'Rejecting…' : 'Confirm Reject'}
                </button>
              </>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtName(p) {
  if (!p) return 'Unknown';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || 'Unknown';
}

function buildTree(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, { ...t, children: [] }]));
  const roots = [];
  for (const t of byId.values()) {
    if (t.parent_task_id && byId.has(t.parent_task_id)) byId.get(t.parent_task_id).children.push(t);
    else roots.push(t);
  }
  return roots;
}

function SnapshotView({ snapshot, tree, changedTaskIds, changedMsIds, projectDiff }) {
  // Compute rolled-up range for summary rows (min/max of leaf descendants).
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

  // Flatten the tree to a linear array of rows, preserving depth.
  const rows = [];
  function pushRow(t, wbs, depth) {
    const isSummary = (t.children?.length ?? 0) > 0;
    const range = isSummary ? summaryRange(t) : { start: t.start_date, end: t.end_date };
    const days = daysBetween(range.start, range.end);
    rows.push({ ...t, wbs, depth, isSummary, computedStart: range.start, computedEnd: range.end, computedDays: days });
    (t.children ?? []).forEach((c, i) => pushRow(c, `${wbs}.${i + 1}`, depth + 1));
  }
  tree.forEach((t, i) => pushRow(t, String(i + 1), 0));

  return (
    <>
      <div className="bcr-snap-project">
        <ProjectField label="Name" value={snapshot?.project?.name} changed={projectDiff.some((c) => c.field === 'name')} />
        <ProjectField label="Description" value={snapshot?.project?.description || '—'} changed={projectDiff.some((c) => c.field === 'description')} />
        <ProjectField label="Planned Start" value={fmtDate(snapshot?.project?.start_date)} changed={projectDiff.some((c) => c.field === 'start_date')} />
        <ProjectField label="Planned End" value={fmtDate(snapshot?.project?.end_date)} changed={projectDiff.some((c) => c.field === 'end_date')} />
      </div>
      <div className="bcr-snap-table">
        <div className="bcr-snap-row bcr-snap-row--head">
          <div>WBS</div><div>Task</div><div>Start</div><div>End</div><div>Days</div>
        </div>
        {rows.length === 0 && <div className="form-hint" style={{ padding: 8 }}>(no tasks)</div>}
        {rows.map((r) => (
          <div
            key={r.id}
            className={`bcr-snap-row${r.isSummary ? ' bcr-snap-row--summary' : ''}${changedTaskIds.has(r.id) ? ' bcr-snap-row--changed' : ''}`}
          >
            <div>{r.wbs}</div>
            <div className="bcr-snap-row__name" style={{ paddingLeft: r.depth * 12 }} title={r.name}>
              {r.isSummary ? 'Σ ' : '• '}{r.name}
            </div>
            <div>{fmtDate(r.computedStart)}</div>
            <div>{fmtDate(r.computedEnd)}</div>
            <div>{r.computedDays ?? '—'}</div>
          </div>
        ))}
        {(snapshot?.milestones ?? []).length > 0 && (
          <>
            <div className="bcr-snap-table__ms-label">Milestones</div>
            {snapshot.milestones.map((m, i) => (
              <div key={m.id} className={`bcr-snap-row${changedMsIds.has(m.id) ? ' bcr-snap-row--changed' : ''}`}>
                <div>M{i + 1}</div>
                <div className="bcr-snap-row__name" title={m.name}>◆ {m.name}</div>
                <div>{fmtDate(m.target_date)}</div>
                <div>—</div>
                <div>—</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

function ProjectField({ label, value, changed }) {
  return (
    <div className={`bcr-snap-project__field${changed ? ' bcr-snap-project__field--changed' : ''}`}>
      <span className="bcr-snap-project__label">{label}</span>
      <span className="bcr-snap-project__value">{value ?? '—'}</span>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  const dd = new Date(d);
  return Number.isNaN(dd.getTime()) ? '—' : dd.toLocaleDateString();
}
