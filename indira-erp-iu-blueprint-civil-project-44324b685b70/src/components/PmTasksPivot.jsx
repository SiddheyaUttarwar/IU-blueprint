import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listPendingPmItems, dismissPmItem } from '../services/pmPivot.js';

const TYPE_LABEL = {
  budget: 'Budget',
  indent_assign: 'Indent Assign',
  indent_map: 'Indent Map',
  milestone_date: 'Milestone',
};

export default function PmTasksPivot() {
  const { profile } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { items: pending } = await listPendingPmItems(profile?.id);
        if (!cancelled) setItems(pending);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load pending items.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, toast]);

  const byProject = useMemo(() => {
    const m = new Map();
    for (const it of items) {
      const key = it.project.id;
      if (!m.has(key)) m.set(key, { project: it.project, items: [] });
      m.get(key).items.push(it);
    }
    return Array.from(m.values());
  }, [items]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function dismiss(item) {
    setBusy(true);
    try {
      await dismissPmItem(profile?.id, item.type, item.itemId);
      setItems((prev) => prev.filter((x) => x.key !== item.key));
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusy(false); }
  }

  if (loading) return <div className="card">Loading…</div>;

  return (
    <>
      <h2 className="page-title">My Tasks — Management</h2>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Pending management items across your projects. Mark <b>Not Required</b> to dismiss items you don&apos;t plan to address.
      </div>

      {byProject.length === 0 ? (
        <div className="card"><div className="masters-users__empty">All caught up — no pending management items.</div></div>
      ) : (
        <div className="my-tasks-projects">
          {byProject.map(({ project, items: pItems }) => {
            const open = expanded.has(project.id);
            return (
              <div key={project.id} className="my-tasks-proj">
                <button type="button" className="my-tasks-proj__head" onClick={() => toggle(project.id)} aria-expanded={open}>
                  <span className="my-tasks-proj__toggle" aria-hidden="true">{open ? '▾' : '▸'}</span>
                  <span className="my-tasks-proj__title">
                    <Link to={`/projects/${project.id}`} onClick={(e) => e.stopPropagation()}>{project.name}</Link>
                  </span>
                  <span className={`status-pill status-pill--${project.status}`}>{project.status?.replace('_', ' ')}</span>
                  <span className="my-tasks-proj__counts">
                    <span>{pItems.length} pending</span>
                  </span>
                </button>
                {open && (
                  <div className="my-tasks-proj__body">
                    <ul className="my-tasks-sublist">
                      {pItems.map((it) => (
                        <li key={it.key} className="my-tasks-sub">
                          <div className="my-tasks-sub__main">
                            <div className="my-tasks-sub__name">
                              <span className="my-tasks-kind">{TYPE_LABEL[it.type] ?? it.type}</span> {it.label}
                            </div>
                          </div>
                          <div className="my-tasks-sub__side">
                            <Link to={it.link} className="btn-primary btn-primary--sm">Open</Link>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }} title="Dismiss from this list">
                              <input type="checkbox" onChange={() => dismiss(it)} disabled={busy} />
                              <span>Not required</span>
                            </label>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
