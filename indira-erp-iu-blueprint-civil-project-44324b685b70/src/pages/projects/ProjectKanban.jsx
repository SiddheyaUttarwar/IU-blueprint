import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject, getProjectStructure, setProjectTaskStatus } from '../../services/projects.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import BackButton from '../../components/BackButton.jsx';

const COLUMNS = [
  { key: 'not_started', label: 'Not Started' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'done', label: 'Done' },
  { key: 'on_hold', label: 'On Hold' },
];

export default function ProjectKanban() {
  const { projectId } = useParams();
  const { isProjectManager, profile } = useAuth();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dragId, setDragId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [proj, struct] = await Promise.all([getProject(projectId), getProjectStructure(projectId)]);
        if (!cancelled) { setProject(proj); setTasks(struct.tasks); }
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [projectId, toast]);

  const byStatus = useMemo(() => {
    const m = new Map(COLUMNS.map((c) => [c.key, []]));
    for (const t of tasks) {
      const key = m.has(t.status) ? t.status : 'not_started';
      m.get(key).push(t);
    }
    return m;
  }, [tasks]);

  function canMoveTask(t) {
    if (isProjectManager) return true;
    if (!profile?.id) return false;
    const ids = Array.isArray(t.assigned_to_ids) ? t.assigned_to_ids : [];
    return ids.includes(profile.id);
  }

  async function drop(colKey) {
    if (!dragId) return;
    const task = tasks.find((t) => t.id === dragId);
    setDragId(null);
    if (!task || task.status === colKey) return;
    if (!canMoveTask(task)) { toast.error('You cannot change this task.'); return; }
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: colKey } : t));
    try {
      await setProjectTaskStatus(task.id, colKey, task);
    } catch (err) {
      toast.error(err.message || 'Failed to move.');
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: task.status } : t));
    }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (!project) return <div className="card">Project not found.</div>;

  return (
    <>
      <BackButton to={`/projects/${projectId}`} label="Back to Project" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>{project.name} — Kanban</h2>
        <Link to={`/projects/${projectId}/gantt`} className="btn-secondary btn-secondary--sm">Gantt view →</Link>
      </div>
      <div className="kanban">
        {COLUMNS.map((c) => (
          <div
            key={c.key}
            className="kanban__col"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => drop(c.key)}
          >
            <div className="kanban__col-head">
              <span>{c.label}</span>
              <span className="form-hint">{byStatus.get(c.key).length}</span>
            </div>
            <div className="kanban__col-body">
              {byStatus.get(c.key).map((t) => (
                <div
                  key={t.id}
                  className="kanban__card"
                  draggable={canMoveTask(t)}
                  onDragStart={() => setDragId(t.id)}
                  onDragEnd={() => setDragId(null)}
                >
                  <div className="kanban__card-title">{t.name}</div>
                  <div className="form-hint">
                    {t.parent_task_id && <span>subtask · </span>}
                    {t.end_date ? `Due ${t.end_date}` : 'No due date'}
                  </div>
                </div>
              ))}
              {byStatus.get(c.key).length === 0 && <div className="form-hint" style={{ padding: 10 }}>—</div>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
