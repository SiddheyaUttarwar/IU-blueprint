import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listPendingRequests, listRequests, decideRequest } from '../services/projectStatusRequests.js';

function matchesQuery(r, term) {
  if (!term) return true;
  const t = term.toLowerCase();
  const proj = (r.projects?.name ?? '').toLowerCase();
  const reason = (r.reason ?? '').toLowerCase();
  const req = `${r.requester?.first_name ?? ''} ${r.requester?.last_name ?? ''} ${r.requester?.email ?? ''}`.toLowerCase();
  return proj.includes(t) || reason.includes(t) || req.includes(t);
}

const LABEL = { on_hold: 'Put on Hold', cancelled: 'Cancel', active: 'Resume', completed: 'Mark Complete' };

function fmtName(p) {
  if (!p) return '—';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—';
}
function fmtWhen(d) { return d ? new Date(d).toLocaleString() : ''; }

export default function Approvals() {
  const { profile, isAdmin, hasRole } = useAuth();
  const toast = useToast();
  const [pending, setPending] = useState([]);
  const [decided, setDecided] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { request, decision }
  const [note, setNote] = useState('');
  const [tab, setTab] = useState('pending'); // 'pending' | 'decided'
  const [q, setQ] = useState('');

  const canDecideGlobal = isAdmin || hasRole?.('leadership');
  // A per-request snapshot approver may decide even without a global role.
  function canDecideRequest(r) {
    if (canDecideGlobal) return true;
    const snap = Array.isArray(r?.approver_snapshot) ? r.approver_snapshot : [];
    return !!profile?.id && snap.includes(profile.id);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = await listPendingRequests();
        if (cancelled) return;
        setPending(p);
        // Decided list: fetch a page of recent decided across all projects — we don't have that endpoint,
        // so aggregate per project id from the pending list is not enough. Add a simple query here.
        setDecided([]); // filled below on tab switch
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load approvals.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  async function loadDecided() {
    // Fetch decided across projects present in `pending` (and previously touched)
    const projectIds = Array.from(new Set([...pending, ...decided].map((r) => r.project_id).filter(Boolean)));
    if (!projectIds.length) { setDecided([]); return; }
    try {
      const per = await Promise.all(projectIds.map((pid) => listRequests(pid)));
      const flat = per.flat().filter((r) => r.status !== 'pending');
      setDecided(flat.sort((a, b) => (b.decided_at ?? '').localeCompare(a.decided_at ?? '')));
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  function openDecide(req, decision) {
    setModal({ request: req, decision });
    setNote('');
  }

  async function submitDecide(e) {
    e?.preventDefault();
    if (!modal) return;
    if (modal.decision === 'rejected' && !note.trim()) {
      toast.error('Rejection reason is required.');
      return;
    }
    setBusy(true);
    try {
      await decideRequest(modal.request.id, profile?.id, modal.decision, note);
      setPending((prev) => prev.filter((x) => x.id !== modal.request.id));
      setModal(null);
      toast.success(modal.decision === 'approved' ? 'Approved.' : 'Rejected.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card">Loading…</div>;

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Approvals</h2>
        <input
          type="search"
          className="tpl-input"
          placeholder="Filter by project, requester, or reason…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ maxWidth: 320 }}
          aria-label="Search approvals"
        />
      </div>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Project status change requests submitted by Project Managers. Leadership and Project Admins can approve or reject.
      </div>

      <div className="tabs">
        <button type="button" className={`tab ${tab === 'pending' ? 'is-active' : ''}`} onClick={() => setTab('pending')}>
          Pending <span className="tab__count">{pending.filter((r) => matchesQuery(r, q)).length}</span>
        </button>
        <button type="button" className={`tab ${tab === 'decided' ? 'is-active' : ''}`} onClick={() => { setTab('decided'); loadDecided(); }}>
          Decided
        </button>
      </div>

      {tab === 'pending' ? (
        (() => {
          const filtered = pending.filter((r) => matchesQuery(r, q));
          return filtered.length === 0 ? (
            <div className="card"><div className="masters-users__empty">{q ? `No pending approvals matching "${q}".` : 'No pending approvals.'}</div></div>
          ) : (
          <ul className="approvals-list">
            {filtered.map((r) => (
              <li key={r.id} className="approvals-list__item approvals-list__item--pending">
                <div className="approvals-list__main">
                  <div>
                    <b>{LABEL[r.requested_status] ?? r.requested_status}</b>
                    {r.projects?.name && <> · <Link to={`/projects/${r.projects.id}`}>{r.projects.name}</Link></>}
                  </div>
                  <div className="form-hint">
                    Requested by <b>{fmtName(r.requester)}</b> · {fmtWhen(r.created_at)}
                  </div>
                  {r.reason && <div style={{ marginTop: 6 }}><i>Reason:</i> {r.reason}</div>}
                </div>
                {canDecideRequest(r) && (
                  <div className="approvals-list__actions">
                    <button type="button" className="btn-primary btn-primary--sm" disabled={busy} onClick={() => openDecide(r, 'approved')}>Approve</button>
                    <button type="button" className="btn-secondary btn-secondary--sm" disabled={busy} onClick={() => openDecide(r, 'rejected')}>Reject</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          );
        })()
      ) : (
        (() => {
          const filtered = decided.filter((r) => matchesQuery(r, q));
          return filtered.length === 0 ? (
          <div className="card"><div className="masters-users__empty">{q ? `No decided requests matching "${q}".` : 'No decided requests visible.'}</div></div>
        ) : (
          <ul className="approvals-list">
            {filtered.map((r) => (
              <li key={r.id} className={`approvals-list__item approvals-list__item--${r.status}`}>
                <div className="approvals-list__main">
                  <div>
                    <b>{LABEL[r.requested_status] ?? r.requested_status}</b>
                    <span className={`badge-admin approvals-list__badge approvals-list__badge--${r.status}`}>{r.status}</span>
                  </div>
                  <div className="form-hint">
                    Requested by {fmtName(r.requester)} · {fmtWhen(r.created_at)} · Decided by {fmtName(r.decider)} · {fmtWhen(r.decided_at)}
                  </div>
                  {r.reason && <div style={{ marginTop: 4 }}><i>Reason:</i> {r.reason}</div>}
                  {r.decision_note && <div><i>Decision:</i> {r.decision_note}</div>}
                </div>
              </li>
            ))}
          </ul>
          );
        })()
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>
              {modal.decision === 'approved' ? 'Approve' : 'Reject'} — {LABEL[modal.request.requested_status] ?? modal.request.requested_status}
            </h3>
            <div className="form-hint" style={{ marginBottom: 8 }}><i>Reason:</i> {modal.request.reason || '—'}</div>
            <form onSubmit={submitDecide}>
              <label className="login-field">
                <span>
                  {modal.decision === 'rejected' ? 'Rejection reason' : 'Note'}
                  {modal.decision === 'rejected' && <span style={{ color: '#b3261e' }}> *</span>}
                </span>
                <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500}
                  required={modal.decision === 'rejected'} autoFocus
                  placeholder={modal.decision === 'rejected' ? 'Explain why the request is being rejected…' : 'Optional note'} />
              </label>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>
                  {busy ? 'Saving…' : (modal.decision === 'approved' ? 'Approve' : 'Reject')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
