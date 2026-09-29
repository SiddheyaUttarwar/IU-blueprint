import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listRequests, submitRequest, decideRequest } from '../services/projectStatusRequests.js';

function fmtName(p) {
  if (!p) return '—';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—';
}
function fmtWhen(d) {
  if (!d) return '';
  return new Date(d).toLocaleString();
}
const LABEL = { on_hold: 'Hold', cancelled: 'Cancel', active: 'Resume', completed: 'Complete' };

export default function StatusRequestSection({ project, onStatusChanged }) {
  const { profile, isProjectManager, isAdmin } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [composeStatus, setComposeStatus] = useState('');
  const [reason, setReason] = useState('');
  const [decidingRequest, setDecidingRequest] = useState(null); // {request, decision}
  const [decisionNote, setDecisionNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const data = await listRequests(project.id);
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load requests.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [project.id, toast]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!composeStatus) return;
    if (!reason.trim()) { toast.error('Reason is required.'); return; }
    setBusy(true);
    try {
      const created = await submitRequest(project.id, profile?.id, composeStatus, reason);
      setRows((prev) => [created, ...prev]);
      setComposeStatus(''); setReason('');
      toast.success('Request submitted for admin approval.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  function openDecide(req, decision) {
    setDecidingRequest({ request: req, decision });
    setDecisionNote('');
  }

  async function submitDecide(e) {
    e?.preventDefault();
    if (!decidingRequest) return;
    const { request: req, decision } = decidingRequest;
    if (decision === 'rejected' && !decisionNote.trim()) {
      toast.error('Rejection reason is required.');
      return;
    }
    setBusy(true);
    try {
      await decideRequest(req.id, profile?.id, decision, decisionNote);
      const refresh = await listRequests(project.id);
      setRows(refresh);
      if (decision === 'approved') {
        onStatusChanged?.(req.requested_status);
        toast.success(`Approved — project set to ${req.requested_status.replace('_', ' ')}.`);
      } else {
        toast.info('Request rejected.');
      }
      setDecidingRequest(null);
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  const pending = rows.filter((r) => r.status === 'pending');

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <h3 className="masters-section__title" style={{ marginTop: 0 }}>Status Change Requests</h3>
      <div className="form-hint">
        Hold, Cancel, or Resume requires Project Admin approval.
      </div>

      {isProjectManager && (
        <form onSubmit={handleSubmit} style={{ marginTop: 10, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="login-field" style={{ margin: 0, minWidth: 140 }}>
            <span>Requested Change</span>
            <select className="tpl-select" value={composeStatus} onChange={(e) => setComposeStatus(e.target.value)}>
              <option value="">— Choose —</option>
              {project.status === 'active' && <option value="on_hold">Put on Hold</option>}
              {project.status === 'planning' && <option value="on_hold">Put on Hold</option>}
              {project.status === 'on_hold' && <option value="active">Resume</option>}
              {(project.status !== 'cancelled' && project.status !== 'completed') && <option value="cancelled">Cancel</option>}
              {(project.status !== 'completed' && project.status !== 'cancelled') && <option value="completed">Mark Complete</option>}
            </select>
          </label>
          <label className="login-field" style={{ margin: 0, flex: 1, minWidth: 220 }}>
            <span>Reason</span>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this change needed?" maxLength={500} />
          </label>
          <button type="submit" className="btn-primary btn-primary--sm" disabled={busy || !composeStatus}>Submit</button>
        </form>
      )}

      {loading ? (
        <div className="masters-users__empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="masters-users__empty" style={{ marginTop: 10 }}>No requests yet.</div>
      ) : (
        <ul className="requests-list" style={{ listStyle: 'none', padding: 0, marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => (
            <li key={r.id} className={`requests-list__item requests-list__item--${r.status}`}>
              <div>
                <b>{LABEL[r.requested_status] ?? r.requested_status}</b>
                <span className={`badge-admin requests-list__badge requests-list__badge--${r.status}`}>{r.status}</span>
                <div className="form-hint">By {fmtName(r.requester)} · {fmtWhen(r.created_at)}</div>
                {r.reason && <div style={{ marginTop: 4 }}><i>Reason:</i> {r.reason}</div>}
                {r.status !== 'pending' && (
                  <div className="form-hint" style={{ marginTop: 4 }}>
                    Decided by {fmtName(r.decider)} · {fmtWhen(r.decided_at)}
                    {r.decision_note && <> · <i>{r.decision_note}</i></>}
                  </div>
                )}
              </div>
              {isAdmin && r.status === 'pending' && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn-primary btn-primary--sm" disabled={busy} onClick={() => openDecide(r, 'approved')}>Approve</button>
                  <button type="button" className="btn-secondary btn-secondary--sm" disabled={busy} onClick={() => openDecide(r, 'rejected')}>Reject</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending.length > 0 && <div className="form-hint" style={{ marginTop: 8 }}>{pending.length} pending request{pending.length === 1 ? '' : 's'}.</div>}

      {decidingRequest && (
        <div className="modal-backdrop" onClick={() => setDecidingRequest(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {decidingRequest.decision === 'approved' ? 'Approve' : 'Reject'} — {decidingRequest.request.requested_status.replace('_', ' ')}
            </h3>
            <div className="form-hint" style={{ marginBottom: 8 }}>
              <i>Reason:</i> {decidingRequest.request.reason || '—'}
            </div>
            <form onSubmit={submitDecide}>
              <label className="login-field">
                <span>
                  {decidingRequest.decision === 'rejected' ? 'Rejection reason' : 'Note'}
                  {decidingRequest.decision === 'rejected' && <span style={{ color: '#b3261e' }}> *</span>}
                </span>
                <textarea
                  rows={3}
                  value={decisionNote}
                  onChange={(e) => setDecisionNote(e.target.value)}
                  maxLength={500}
                  required={decidingRequest.decision === 'rejected'}
                  autoFocus
                  placeholder={decidingRequest.decision === 'rejected' ? 'Explain why the request is being rejected…' : 'Optional note'}
                />
              </label>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setDecidingRequest(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>
                  {busy ? 'Saving…' : (decidingRequest.decision === 'approved' ? 'Approve' : 'Reject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
