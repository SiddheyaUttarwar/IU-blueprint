import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  listBudgets, addBudgetForTask, updateBudgetAmount, updateBudgetNotes,
  removeBudget, listBudgetHistory,
} from '../services/projectBudgets.js';
import { getProjectStructure } from '../services/projects.js';
import { createBaselineChangeRequest } from '../services/baselineChangeRequests.js';
import { IconPlus, IconTrash } from './Icons.jsx';
import NumberInput from './NumberInput.jsx';

function fmtMoney(n) {
  const num = Number(n);
  if (n == null || Number.isNaN(num)) return '₹0';
  return `₹${num.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fmtWhen(d) { return d ? new Date(d).toLocaleString() : ''; }
function fmtName(p) {
  if (!p) return '—';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—';
}

export default function BudgetSection({ project, embedded = false }) {
  const { profile, isProjectManager } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addingTaskIds, setAddingTaskIds] = useState([]);
  // Local per-row pending edits: { [rowId]: { planned_amount?: string, actual_amount?: string } }
  const [pending, setPending] = useState({});
  const [reasonModal, setReasonModal] = useState(null); // { rowId, field, before, next }
  const [reasonText, setReasonText] = useState('');
  const [historyFor, setHistoryFor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [b, s] = await Promise.all([
          listBudgets(project.id),
          getProjectStructure(project.id),
        ]);
        if (cancelled) return;
        setRows(b);
        setTasks(s.tasks ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load budget.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [project.id, toast]);

  const usedTaskIds = useMemo(() => new Set(rows.map((r) => r.task_id).filter(Boolean)), [rows]);
  // Only top-level tasks — exclude subtasks
  const availableTasks = useMemo(
    () => tasks.filter((t) => !t.parent_task_id && !usedTaskIds.has(t.id)),
    [tasks, usedTaskIds],
  );

  async function addSelected() {
    if (!addingTaskIds.length) { toast.error('Pick at least one task.'); return; }
    setBusy(true);
    try {
      const created = [];
      for (const tid of addingTaskIds) {
        try { created.push(await addBudgetForTask(project.id, tid, { actorId: profile?.id })); }
        catch (err) { toast.error(err.message || 'Failed to add.'); }
      }
      setRows((prev) => [...prev, ...created]);
      setAddingTaskIds([]);
      toast.success(`Added ${created.length} budget row${created.length === 1 ? '' : 's'}.`);
    } finally { setBusy(false); }
  }

  function setPendingField(rowId, field, value) {
    setPending((prev) => ({ ...prev, [rowId]: { ...(prev[rowId] ?? {}), [field]: value } }));
  }
  function pendingValue(row, field) {
    return pending[row.id]?.[field] ?? String(row[field] ?? '');
  }
  function isDirty(row, field) {
    const p = pending[row.id]?.[field];
    if (p == null) return false;
    return Number(p || 0) !== Number(row[field] || 0);
  }

  function openReasonForField(row, field) {
    const before = Number(row[field] || 0);
    const next = Number(pending[row.id]?.[field] ?? 0);
    if (before === next) { toast.info('No change to save.'); return; }
    setReasonModal({ rowId: row.id, field, before, next });
    setReasonText('');
  }

  async function commitReason(e) {
    e?.preventDefault();
    if (!reasonModal) return;
    if (reasonText.trim().length < 5) { toast.error('Reason is required.'); return; }
    setBusy(true);
    try {
      // planned_amount is a baseline field → route through leadership approval instead of direct write.
      // actual_amount tracks reality and stays a direct write with a variance note.
      if (reasonModal.field === 'planned_amount') {
        if (reasonText.trim().length < 20) {
          toast.error('Baseline change reason must be at least 20 characters.');
          setBusy(false); return;
        }
        const row = rows.find((r) => r.id === reasonModal.rowId);
        const taskId = row?.task_id;
        const taskName = row?.task?.name;
        await createBaselineChangeRequest({
          projectId: project.id,
          requestedBy: profile?.id,
          reason: reasonText.trim(),
          beforeSnapshot: { task_amounts: [{ task_id: taskId, task_name: taskName, planned_amount: reasonModal.before }] },
          afterSnapshot:  { task_amounts: [{ task_id: taskId, task_name: taskName, planned_amount: reasonModal.next }] },
        });
        setPending((prev) => {
          const { [reasonModal.rowId]: rowPending, ...rest } = prev;
          if (!rowPending) return prev;
          const remaining = { ...rowPending }; delete remaining[reasonModal.field];
          return Object.keys(remaining).length ? { ...rest, [reasonModal.rowId]: remaining } : rest;
        });
        setReasonModal(null); setReasonText('');
        toast.success('Baseline change submitted for leadership approval.');
      } else {
        const updated = await updateBudgetAmount(reasonModal.rowId, {
          field: reasonModal.field, newAmount: reasonModal.next, reason: reasonText, actorId: profile?.id,
        });
        setRows((prev) => prev.map((r) => r.id === updated.id ? updated : r));
        setPending((prev) => {
          const { [reasonModal.rowId]: rowPending, ...rest } = prev;
          if (!rowPending) return prev;
          const remaining = { ...rowPending }; delete remaining[reasonModal.field];
          return Object.keys(remaining).length ? { ...rest, [reasonModal.rowId]: remaining } : rest;
        });
        setReasonModal(null); setReasonText('');
        toast.success('Saved with variance note.');
      }
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  async function saveNotes(id, notes) {
    try {
      const updated = await updateBudgetNotes(id, notes, { actorId: profile?.id });
      setRows((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function remove(row) {
    if (!window.confirm(`Delete budget for "${row.task?.name ?? 'task'}"?`)) return;
    try {
      await removeBudget(row.id, { actorId: profile?.id });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function openHistory(row) {
    try {
      const h = await listBudgetHistory(row.id);
      setHistoryFor({ row, history: h });
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  const totalPlanned = rows.reduce((s, r) => s + Number(r.planned_amount || 0), 0);
  const totalActual = rows.reduce((s, r) => s + Number(r.actual_amount || 0), 0);
  const variance = totalPlanned - totalActual;

  const Wrapper = embedded ? 'div' : 'section';
  return (
    <Wrapper className={embedded ? 'budget-embedded' : 'card'} style={embedded ? undefined : { marginTop: 16 }}>
      {!embedded && (
        <div>
          <h3 className="masters-section__title" style={{ marginTop: 0 }}>Budget</h3>
          <div className="form-hint">One budget row per task. Every planned/actual change is captured in variance history with a mandatory reason.</div>
        </div>
      )}
      {embedded && (
        <div className="form-hint" style={{ marginBottom: 8 }}>
          One budget row per task. Every planned/actual change is captured in variance history with a mandatory reason.
        </div>
      )}

      {isProjectManager && (
        <div className="budget-add-bar">
          <label className="login-field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            <span>Add budget for tasks (multi-select)</span>
            {availableTasks.length === 0 ? (
              <div className="form-hint">All tasks already have budget rows{tasks.length === 0 ? ' — add tasks first' : ''}.</div>
            ) : (
              <select multiple value={addingTaskIds} onChange={(e) => setAddingTaskIds(Array.from(e.target.selectedOptions).map((o) => o.value))} size={Math.min(6, availableTasks.length + 1)}>
                {availableTasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            )}
          </label>
          <button type="button" className="btn-primary btn-primary--sm" onClick={addSelected} disabled={busy || !addingTaskIds.length}>
            <IconPlus /> Add {addingTaskIds.length || ''}
          </button>
        </div>
      )}

      {loading ? (
        <div className="masters-users__empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="masters-users__empty">No budget rows yet.</div>
      ) : (
        <div className="budget-table">
          <div className="budget-table__row budget-table__row--head">
            <div>Task</div><div>Planned</div><div>Actual</div><div>Variance</div><div>Notes</div><div>Actions</div>
          </div>
          {rows.map((r) => {
            const v = Number(r.planned_amount || 0) - Number(r.actual_amount || 0);
            const plannedDirty = isDirty(r, 'planned_amount');
            const actualDirty = isDirty(r, 'actual_amount');
            return (
              <div key={r.id} className="budget-table__row">
                <div>{r.task?.name ?? <em className="form-hint">(deleted task)</em>}</div>
                <div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <NumberInput
                      value={pendingValue(r, 'planned_amount')}
                      onChange={(nv) => setPendingField(r.id, 'planned_amount', nv)}
                      disabled={!isProjectManager}
                    />
                    {plannedDirty && isProjectManager && (
                      <button type="button" className="btn-primary btn-primary--sm" style={{ padding: '4px 8px' }} onClick={() => openReasonForField(r, 'planned_amount')}>Save</button>
                    )}
                  </div>
                </div>
                <div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <NumberInput
                      value={pendingValue(r, 'actual_amount')}
                      onChange={(nv) => setPendingField(r.id, 'actual_amount', nv)}
                      disabled={!isProjectManager}
                    />
                    {actualDirty && isProjectManager && (
                      <button type="button" className="btn-primary btn-primary--sm" style={{ padding: '4px 8px' }} onClick={() => openReasonForField(r, 'actual_amount')}>Save</button>
                    )}
                  </div>
                </div>
                <div style={{ color: v < 0 ? '#b3261e' : v > 0 ? '#166534' : 'inherit' }}>{fmtMoney(v)}</div>
                <div>
                  <input
                    type="text"
                    className="tpl-input"
                    defaultValue={r.notes ?? ''}
                    onBlur={(e) => e.target.value !== (r.notes ?? '') && saveNotes(r.id, e.target.value)}
                    disabled={!isProjectManager}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => openHistory(r)}>History</button>
                  {isProjectManager && (
                    <button type="button" className="icon-btn icon-btn--danger" onClick={() => remove(r)} aria-label="Delete"><IconTrash /></button>
                  )}
                </div>
              </div>
            );
          })}
          <div className="budget-table__row budget-table__row--total">
            <div><b>Total</b></div>
            <div><b>{fmtMoney(totalPlanned)}</b></div>
            <div><b>{fmtMoney(totalActual)}</b></div>
            <div style={{ color: variance < 0 ? '#b3261e' : variance > 0 ? '#166534' : 'inherit' }}><b>{fmtMoney(variance)}</b></div>
            <div /><div />
          </div>
        </div>
      )}

      {reasonModal && (
        <div className="modal-backdrop" onClick={() => setReasonModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {reasonModal.field === 'planned_amount' ? 'Change Baseline — Planned Amount' : 'Change Actual Amount'}
            </h3>
            <div className="form-hint" style={{ marginBottom: 8 }}>
              Previous: <b>{fmtMoney(reasonModal.before)}</b> → New: <b>{fmtMoney(reasonModal.next)}</b> · Delta: <b style={{ color: reasonModal.next - reasonModal.before < 0 ? '#b3261e' : '#166534' }}>{fmtMoney(reasonModal.next - reasonModal.before)}</b>
            </div>
            {reasonModal.field === 'planned_amount' && (
              <div className="form-hint" style={{ marginBottom: 8, padding: 8, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4, color: '#422006' }}>
                <b>Baseline change:</b> this request goes to Leadership for approval. Nothing applies until approved. Reason must be at least 20 characters.
              </div>
            )}
            <form onSubmit={commitReason}>
              <label className="login-field">
                <span>Reason for change <span style={{ color: '#b3261e' }}>*</span></span>
                <textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} required maxLength={1000} minLength={reasonModal.field === 'planned_amount' ? 20 : 5} autoFocus />
                {reasonModal.field === 'planned_amount' && <span className="form-hint">{reasonText.trim().length}/20 characters minimum</span>}
              </label>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setReasonModal(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>
                  {reasonModal.field === 'planned_amount' ? (busy ? 'Submitting…' : 'Submit for Approval') : (busy ? 'Saving…' : 'Save')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyFor && (
        <div className="modal-backdrop" onClick={() => setHistoryFor(null)}>
          <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Variance history — {historyFor.row.task?.name}</h3>
            {historyFor.history.length === 0 ? (
              <div className="form-hint">No changes recorded yet.</div>
            ) : (
              <table className="tpl-table" style={{ fontSize: 12 }}>
                <thead><tr><th>When</th><th>Field</th><th>Previous</th><th>New</th><th>Delta</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>
                  {historyFor.history.map((h) => (
                    <tr key={h.id}>
                      <td>{fmtWhen(h.created_at)}</td>
                      <td>{h.field === 'planned_amount' ? 'Planned' : 'Actual'}</td>
                      <td>{fmtMoney(h.previous_amount)}</td>
                      <td>{fmtMoney(h.new_amount)}</td>
                      <td style={{ color: Number(h.delta) < 0 ? '#b3261e' : '#166534' }}>{fmtMoney(h.delta)}</td>
                      <td>{h.reason || '—'}</td>
                      <td>{fmtName(h.changer)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setHistoryFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </Wrapper>
  );
}
