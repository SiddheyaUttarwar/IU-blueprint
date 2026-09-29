import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  listFunding, addFundingRows, updateFundingAmount, updateFundingNotes,
  removeFunding, listFundingHistory, FUNDING_SOURCES, labelFor,
} from '../services/projectFunding.js';
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

export default function FundingSection({ project }) {
  const { profile, isProjectManager } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pickedSources, setPickedSources] = useState([]);
  const [pending, setPending] = useState({}); // { [rowId]: string }
  const [reasonModal, setReasonModal] = useState(null);
  const [reasonText, setReasonText] = useState('');
  const [historyFor, setHistoryFor] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await listFunding(project.id);
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load funding.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [project.id, toast]);

  function toggleSource(v) {
    setPickedSources((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]);
  }

  async function addRows() {
    if (!pickedSources.length) { toast.error('Pick at least one source.'); return; }
    setBusy(true);
    try {
      const created = await addFundingRows(project.id, pickedSources, { amount: 0, actorId: profile?.id });
      setRows((prev) => [...prev, ...created]);
      setPickedSources([]);
      toast.success(`Added ${created.length} funding row${created.length === 1 ? '' : 's'}.`);
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  function pendingValue(row) { return pending[row.id] ?? String(row.amount ?? ''); }
  function isDirty(row) {
    const p = pending[row.id];
    if (p == null) return false;
    return Number(p || 0) !== Number(row.amount || 0);
  }

  function openReason(row) {
    const before = Number(row.amount || 0);
    const next = Number(pending[row.id] ?? 0);
    if (before === next) { toast.info('No change to save.'); return; }
    setReasonModal({ rowId: row.id, before, next, source: row.source });
    setReasonText('');
  }

  async function commitReason(e) {
    e?.preventDefault();
    if (!reasonModal) return;
    if (!reasonText.trim()) { toast.error('Reason is required.'); return; }
    setBusy(true);
    try {
      const updated = await updateFundingAmount(reasonModal.rowId, { newAmount: reasonModal.next, reason: reasonText, actorId: profile?.id });
      setRows((prev) => prev.map((r) => r.id === updated.id ? updated : r));
      setPending((prev) => { const rest = { ...prev }; delete rest[reasonModal.rowId]; return rest; });
      setReasonModal(null); setReasonText('');
      toast.success('Saved with variance note.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  async function saveNotes(id, notes) {
    try {
      const updated = await updateFundingNotes(id, notes, { actorId: profile?.id });
      setRows((prev) => prev.map((r) => r.id === updated.id ? updated : r));
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function remove(row) {
    if (!window.confirm(`Delete this ${labelFor(row.source)} entry?`)) return;
    try {
      await removeFunding(row.id, { actorId: profile?.id });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function openHistory(row) {
    try {
      const h = await listFundingHistory(row.id);
      setHistoryFor({ row, history: h });
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  const total = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const bySource = FUNDING_SOURCES
    .map((s) => ({ source: s.value, label: s.label, total: rows.filter((r) => r.source === s.value).reduce((sum, r) => sum + Number(r.amount || 0), 0) }))
    .filter((x) => x.total > 0);

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div>
        <h3 className="masters-section__title" style={{ marginTop: 0 }}>Funding Sources</h3>
        <div className="form-hint">Pick one or more sources — each creates its own row. Amount changes are captured in variance history with a mandatory reason.</div>
      </div>

      {isProjectManager && (
        <div className="funding-add-bar">
          <div className="funding-source-list">
            {FUNDING_SOURCES.map((s) => (
              <label key={s.value} className={`funding-source-chip${pickedSources.includes(s.value) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={pickedSources.includes(s.value)} onChange={() => toggleSource(s.value)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          <button type="button" className="btn-primary btn-primary--sm" onClick={addRows} disabled={busy || !pickedSources.length}>
            <IconPlus /> Add {pickedSources.length ? `(${pickedSources.length})` : ''}
          </button>
        </div>
      )}

      {loading ? (
        <div className="masters-users__empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="masters-users__empty">No funding entries yet.</div>
      ) : (
        <div className="funding-table" style={{ marginTop: 12 }}>
          <div className="funding-table__row funding-table__row--head">
            <div>Source</div><div>Amount</div><div>Notes</div><div>Actions</div>
          </div>
          {rows.map((r) => {
            const dirty = isDirty(r);
            return (
              <div key={r.id} className="funding-table__row">
                <div>{labelFor(r.source)}</div>
                <div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <NumberInput value={pendingValue(r)} onChange={(nv) => setPending((prev) => ({ ...prev, [r.id]: nv }))} disabled={!isProjectManager} />
                    {dirty && isProjectManager && (
                      <button type="button" className="btn-primary btn-primary--sm" style={{ padding: '4px 8px' }} onClick={() => openReason(r)}>Save</button>
                    )}
                  </div>
                </div>
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
          <div className="funding-table__row funding-table__row--total">
            <div>Total</div>
            <div>{fmtMoney(total)}</div>
            <div className="form-hint">
              {bySource.map((x, i) => (
                <span key={x.source}>{x.label}: <b>{fmtMoney(x.total)}</b>{i < bySource.length - 1 ? ' · ' : ''}</span>
              ))}
            </div>
            <div />
          </div>
        </div>
      )}

      {reasonModal && (
        <div className="modal-backdrop" onClick={() => setReasonModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Change {labelFor(reasonModal.source)} amount</h3>
            <div className="form-hint" style={{ marginBottom: 8 }}>
              Previous: <b>{fmtMoney(reasonModal.before)}</b> → New: <b>{fmtMoney(reasonModal.next)}</b> · Delta: <b style={{ color: reasonModal.next - reasonModal.before < 0 ? '#b3261e' : '#166534' }}>{fmtMoney(reasonModal.next - reasonModal.before)}</b>
            </div>
            <form onSubmit={commitReason}>
              <label className="login-field">
                <span>Reason for change <span style={{ color: '#b3261e' }}>*</span></span>
                <textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} required maxLength={500} autoFocus />
              </label>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setReasonModal(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>Save</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {historyFor && (
        <div className="modal-backdrop" onClick={() => setHistoryFor(null)}>
          <div className="modal-card modal-card--wide" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Variance history — {labelFor(historyFor.row.source)}</h3>
            {historyFor.history.length === 0 ? (
              <div className="form-hint">No changes recorded yet.</div>
            ) : (
              <table className="tpl-table" style={{ fontSize: 12 }}>
                <thead><tr><th>When</th><th>Previous</th><th>New</th><th>Delta</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>
                  {historyFor.history.map((h) => (
                    <tr key={h.id}>
                      <td>{fmtWhen(h.created_at)}</td>
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
    </section>
  );
}
