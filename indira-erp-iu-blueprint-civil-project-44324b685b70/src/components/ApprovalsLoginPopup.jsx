import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../lib/supabaseClient.js';

const SEEN_KEY = 'iu-blueprint.approvalsPopupSeenSessionId';

// Login popup shown once per session for Leadership / Project Admin.
// Displays pending-approvals count with a "Go to Approvals" CTA.
export default function ApprovalsLoginPopup() {
  const { session, hasRole, isAdmin } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!session?.access_token) return;
    if (!(isAdmin || hasRole?.('leadership'))) return;

    // Only show once per browser session per Supabase session id
    let seenId = '';
    try { seenId = window.sessionStorage.getItem(SEEN_KEY) || ''; } catch { /* ignore */ }
    const sid = session.user?.id + '|' + session.access_token.slice(-12);
    if (seenId === sid) return;

    let cancelled = false;
    (async () => {
      try {
        const { count: c } = await supabase
          .from('project_status_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        if (cancelled) return;
        if ((c ?? 0) > 0) {
          setCount(c ?? 0);
          setOpen(true);
        }
        try { window.sessionStorage.setItem(SEEN_KEY, sid); } catch { /* ignore */ }
      } catch { /* ignore */ }
    })();
    return () => { cancelled = true; };
  }, [session?.access_token, session?.user?.id, isAdmin, hasRole]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>Pending approvals</h3>
        <p>You have <b>{count}</b> pending approval{count === 1 ? '' : 's'} waiting for your review.</p>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setOpen(false)}>Later</button>
          <button type="button" className="btn-primary btn-primary--sm" onClick={() => { setOpen(false); navigate('/approvals'); }}>
            Go to Approvals
          </button>
        </div>
      </div>
    </div>
  );
}
