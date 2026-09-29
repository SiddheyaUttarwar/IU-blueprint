import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  listAllRequests,
  approveBaselineChangeRequest, rejectBaselineChangeRequest,
  computeSnapshotDiff,
} from '../services/baselineChangeRequests.js';
import BaselineApprovalModal from './BaselineApprovalModal.jsx';

// Leadership-facing approvals list. Rendered inside My Tasks so leadership treats each pending
// request as a "task" that needs a decision. Approve / View / Reject actions are gated to leadership.
function categoryFor(req) {
  const diff = computeSnapshotDiff(req.before_snapshot, req.after_snapshot);
  const cats = [];
  if (diff.project.some((c) => c.field === 'start_date' || c.field === 'end_date')) cats.push('Schedule');
  if (diff.project.some((c) => c.field === 'name' || c.field === 'description')) cats.push('Project');
  if (diff.tasks.length || diff.milestones.length) {
    if (!cats.includes('Schedule')) cats.push('Schedule');
  }
  if ((diff.indentItems?.length ?? 0) + (diff.taskAmounts?.length ?? 0) > 0) cats.push('Cost');
  return cats.length ? cats.join(' + ') : '—';
}
function fmtName(p) { return p ? (`${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—') : '—'; }
function fmtWhen(d) { return d ? new Date(d).toLocaleString() : '—'; }

export default function LeadershipApprovalsList() {
  const { profile } = useAuth();
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending');
  const [reviewing, setReviewing] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const rows = await listAllRequests();
        if (!cancelled) setRequests(rows);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load approvals.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  const counts = useMemo(() => ({
    pending: requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
  }), [requests]);
  const filtered = useMemo(() => requests.filter((r) => r.status === tab), [requests, tab]);

  async function handleApprove({ requestId, decisionReason }) {
    await approveBaselineChangeRequest({ requestId, deciderId: profile?.id, decisionReason });
    setRequests((prev) => prev.map((r) => r.id === requestId ? { ...r, status: 'approved', decided_by: profile?.id, decided_at: new Date().toISOString(), decision_reason: decisionReason ?? null } : r));
    toast.success('Approved and applied.');
  }
  async function handleReject({ requestId, decisionReason }) {
    await rejectBaselineChangeRequest({ requestId, deciderId: profile?.id, decisionReason });
    setRequests((prev) => prev.map((r) => r.id === requestId ? { ...r, status: 'rejected', decided_by: profile?.id, decided_at: new Date().toISOString(), decision_reason: decisionReason } : r));
    toast.success('Rejected.');
  }

  return (
    <>
      <h2 className="page-title">My Tasks — Baseline Approvals</h2>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Every baseline change proposed by a Project Manager needs your decision. Approving applies the diff and captures ghost baselines on the Gantt.
      </div>

      <div className="icb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'pending'} className={`icb-tabs__tab${tab === 'pending' ? ' is-active' : ''}`} onClick={() => setTab('pending')}>Pending ({counts.pending})</button>
        <button type="button" role="tab" aria-selected={tab === 'approved'} className={`icb-tabs__tab${tab === 'approved' ? ' is-active' : ''}`} onClick={() => setTab('approved')}>Approved ({counts.approved})</button>
        <button type="button" role="tab" aria-selected={tab === 'rejected'} className={`icb-tabs__tab${tab === 'rejected' ? ' is-active' : ''}`} onClick={() => setTab('rejected')}>Rejected ({counts.rejected})</button>
      </div>

      {loading ? (
        <div className="card">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card"><div className="masters-users__empty">No {tab} requests.</div></div>
      ) : (
        <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
          <table className="bcr-approvals-table table--responsive">
            <thead>
              <tr>
                <th style={{ width: '18%' }}>Project</th>
                <th style={{ width: '12%' }}>Category</th>
                <th style={{ width: '16%' }}>Requested by</th>
                <th style={{ width: '15%' }}>Submitted</th>
                <th style={{ width: '10%' }}>Status</th>
                {tab !== 'pending' && <th style={{ width: '14%' }}>Decided by</th>}
                {tab !== 'pending' && <th style={{ width: '14%' }}>Decided at</th>}
                <th style={{ width: '15%', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Project"><Link to={`/projects/${r.project_id}`} className="table-link">{r.projects?.name ?? r.project_id}</Link></td>
                  <td data-label="Category">{categoryFor(r)}</td>
                  <td data-label="Requested by">{fmtName(r.requester)}</td>
                  <td data-label="Submitted">{fmtWhen(r.requested_at)}</td>
                  <td data-label="Status"><span className={`status-pill status-pill--${r.status}`}>{r.status}</span></td>
                  {tab !== 'pending' && <td data-label="Decided by">{fmtName(r.decider)}</td>}
                  {tab !== 'pending' && <td data-label="Decided at">{fmtWhen(r.decided_at)}</td>}
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setReviewing(r)}>
                      {tab === 'pending' ? 'Review' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {reviewing && (
        <BaselineApprovalModal
          request={reviewing}
          onClose={() => setReviewing(null)}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </>
  );
}
