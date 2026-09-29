import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  listMyRequests, computeSnapshotDiff,
} from '../services/baselineChangeRequests.js';
import BaselineApprovalModal from '../components/BaselineApprovalModal.jsx';

// PM-facing page: own submitted baseline change requests + their current status.
// PMs cannot approve/reject — the "View" button opens the approval modal in read-only mode.
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

export default function BaselineApprovals() {
  const { profile, isProjectManager } = useAuth();
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
        const rows = await listMyRequests(profile?.id);
        if (!cancelled) setRequests(rows);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load requests.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, toast]);

  const counts = useMemo(() => ({
    pending: requests.filter((r) => r.status === 'pending').length,
    approved: requests.filter((r) => r.status === 'approved').length,
    rejected: requests.filter((r) => r.status === 'rejected').length,
  }), [requests]);
  const filtered = useMemo(() => requests.filter((r) => r.status === tab), [requests, tab]);

  if (!isProjectManager) {
    return <div className="card">This page is for Project Managers. Leadership sees baseline approvals inside My Tasks.</div>;
  }

  const readOnlyToast = async () => { toast.error('Only Leadership can approve or reject. You can only view your submissions.'); };

  return (
    <>
      <h2 className="page-title">Baseline Approvals</h2>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Your submitted baseline change requests and their current status. Approve/reject decisions are handled by Leadership.
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
                <th style={{ width: '22%' }}>Project</th>
                <th style={{ width: '14%' }}>Category</th>
                <th style={{ width: '18%' }}>Submitted</th>
                <th style={{ width: '12%' }}>Status</th>
                {tab !== 'pending' && <th style={{ width: '15%' }}>Decided by</th>}
                {tab !== 'pending' && <th style={{ width: '15%' }}>Decided at</th>}
                <th style={{ width: '12%', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td data-label="Project"><Link to={`/projects/${r.project_id}`} className="table-link">{r.projects?.name ?? r.project_id}</Link></td>
                  <td data-label="Category">{categoryFor(r)}</td>
                  <td data-label="Submitted">{fmtWhen(r.requested_at)}</td>
                  <td data-label="Status"><span className={`status-pill status-pill--${r.status}`}>{r.status}</span></td>
                  {tab !== 'pending' && <td data-label="Decided by">{fmtName(r.decider)}</td>}
                  {tab !== 'pending' && <td data-label="Decided at">{fmtWhen(r.decided_at)}</td>}
                  <td style={{ textAlign: 'right' }}>
                    <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setReviewing(r)}>View changes</button>
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
          readOnly
          onClose={() => setReviewing(null)}
          onApprove={readOnlyToast}
          onReject={readOnlyToast}
        />
      )}
    </>
  );
}
