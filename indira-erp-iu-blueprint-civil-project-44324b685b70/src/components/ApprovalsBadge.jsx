import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';

// Small badge showing pending approvals count. Used in Sidebar next to Approvals link.
export default function ApprovalsBadge() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const { count: c } = await supabase
          .from('project_status_requests')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending');
        if (!cancelled) setCount(c ?? 0);
      } catch { /* ignore */ }
    }
    load();
    const t = setInterval(load, 60_000); // refresh every 60s
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  if (count === 0) return null;
  return <span className="nav-badge" aria-label={`${count} pending approvals`}>{count}</span>;
}
