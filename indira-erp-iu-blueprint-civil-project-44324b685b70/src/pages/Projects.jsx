import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../context/ToastContext.jsx';
import { listProjects, listAllProjectTasksLite, removeProject } from '../services/projects.js';
import { getRagConfig } from '../services/ragConfig.js';
import { computeProjectRag } from '../lib/ragCalc.js';
import { useAuth } from '../context/AuthContext.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { IconPlus, IconTrash } from '../components/Icons.jsx';


const STATUS_LABEL = {
  planning: 'Planning',
  active: 'Ongoing',
  on_hold: 'Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

function fmtName(p) {
  if (!p) return '';
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return full || p.email || '';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}

function toneClass(tone) { return tone === 'not_rated' ? 'na' : tone; }

// Fall back to task rollup when the project's own start_date/end_date is null.
// BUG-06: Dashboard already rolls up; the list used to show "—" for the same rows.
function effectiveRange(project, tasks) {
  if (project.start_date && project.end_date) return { start: project.start_date, end: project.end_date };
  const parentIds = new Set(tasks.map((t) => t.parent_task_id).filter(Boolean));
  let s = project.start_date ?? null;
  let e = project.end_date ?? null;
  for (const t of tasks) {
    if (parentIds.has(t.id)) continue; // skip summaries — they roll up
    if (t.start_date && (!s || t.start_date < s)) s = t.start_date;
    if (t.end_date && (!e || t.end_date > e)) e = t.end_date;
  }
  return { start: s, end: e };
}

// Same idea for the actual window — prefer the project's own actual dates, fall back to
// min(leaf.actual_start) → max(leaf.actual_completion) if either project field is null.
function actualEffectiveRange(project, tasks) {
  let s = project.actual_start_date ?? null;
  let e = project.actual_end_date ?? null;
  if (s && e) return { start: s, end: e };
  const parentIds = new Set(tasks.map((t) => t.parent_task_id).filter(Boolean));
  for (const t of tasks) {
    if (parentIds.has(t.id)) continue;
    if (t.actual_start_date && (!s || t.actual_start_date < s)) s = t.actual_start_date;
    if (t.actual_completion_date && (!e || t.actual_completion_date > e)) e = t.actual_completion_date;
  }
  return { start: s, end: e };
}

export default function Projects() {
  const { isProjectManager, profile } = useAuth();
  const canCreate = isProjectManager;
  const canDelete = isProjectManager;
  const canEdit = isProjectManager;
  const toast = useToast();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [ragConfig, setRagConfig] = useState(null);
  const [tasksByProject, setTasksByProject] = useState(new Map());
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('all'); // 'all' | 'mine'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [data, cfg, allTasks] = await Promise.all([
          listProjects(),
          getRagConfig().catch(() => null),
          listAllProjectTasksLite().catch(() => []),
        ]);
        if (!cancelled) {
          setRows(data);
          setRagConfig(cfg);
          const m = new Map();
          for (const t of allTasks) {
            if (!m.has(t.project_id)) m.set(t.project_id, []);
            m.get(t.project_id).push(t);
          }
          setTasksByProject(m);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load projects.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const scoped = useMemo(() => {
    if (scope === 'mine' && profile?.id) {
      return rows.filter((r) => r.created_by_profile?.id === profile.id);
    }
    return rows;
  }, [rows, scope, profile]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((r) => {
      const tpl = r.project_templates?.name ?? '';
      const type = r.project_templates?.project_types?.name ?? '';
      const campus = r.campuses?.name ?? '';
      const school = r.schools?.name ?? '';
      const createdBy = fmtName(r.created_by_profile);
      return (
        r.name.toLowerCase().includes(q)
        || tpl.toLowerCase().includes(q)
        || type.toLowerCase().includes(q)
        || campus.toLowerCase().includes(q)
        || school.toLowerCase().includes(q)
        || createdBy.toLowerCase().includes(q)
      );
    });
  }, [scoped, query]);

  const myCount = useMemo(
    () => (profile?.id ? rows.filter((r) => r.created_by_profile?.id === profile.id).length : 0),
    [rows, profile],
  );

  const exportColumns = [
    { key: 'sr', label: 'Sr. No.', value: (_r, i) => i + 1 },
    { key: 'name', label: 'Project' },
    { key: 'class', label: 'Class', value: (r) => (r.project_class === 'greenfield' ? 'Greenfield' : 'Brownfield') },
    // Blank-template projects don't have a template but carry project_type_id directly.
    { key: 'type', label: 'Project Type', value: (r) => r.project_templates?.project_types?.name ?? r.project_types?.name ?? '' },
    { key: 'template', label: 'Project Template', value: (r) => `${r.project_templates?.name ?? ''} v${r.template_versions?.version_no ?? ''}` },
    { key: 'campus', label: 'Campus', value: (r) => r.campuses?.name ?? '' },
    { key: 'school', label: 'School', value: (r) => r.schools?.name ?? '' },
    { key: 'created_by', label: 'Created By', value: (r) => fmtName(r.created_by_profile) },
    { key: 'planned_start', label: 'Planned Start', value: (r) => effectiveRange(r, tasksByProject.get(r.id) ?? []).start ?? '' },
    { key: 'planned_end', label: 'Planned End', value: (r) => effectiveRange(r, tasksByProject.get(r.id) ?? []).end ?? '' },
    { key: 'progress', label: 'Progress %', value: (r) => {
      const rag = computeProjectRag(ragConfig, r, tasksByProject.get(r.id) ?? []);
      return rag.actualPct != null ? Math.round(rag.actualPct) : '';
    } },
    { key: 'health', label: 'Health', value: (r) => {
      const rag = computeProjectRag(ragConfig, r, tasksByProject.get(r.id) ?? []);
      return rag.overall.label;
    } },
    { key: 'status', label: 'Status', value: (r) => STATUS_LABEL[r.status] ?? r.status },
  ];
  const exportRows = filtered.map((r, i) => ({ ...r, __i: i }));
  const exportColumnsIndexed = exportColumns.map((c) => ({
    ...c,
    value: c.value ? (r) => c.value(r, r.__i ?? 0) : undefined,
  }));

  async function handleDelete(row) {
    if (!window.confirm(`Delete project "${row.name}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await removeProject(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success(`Deleted ${row.name}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete.');
    } finally {
      setBusyId('');
    }
  }

  function handleEdit(row) {
    toast.info?.('Project edit will open in a future phase.');
    navigate(`/projects/${row.id}`);
  }
  function handleUpdate(row) {
    toast.info?.('Progress update will open in the Member Task phase.');
    navigate(`/projects/${row.id}`);
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>Projects</h2>
        {canCreate && (
          <button
            type="button"
            className="btn-primary btn-primary--sm"
            onClick={() => navigate('/projects/new/manual')}
          >
            <IconPlus /> Create Project
          </button>
        )}
      </div>

      <div className="tabs" role="tablist" style={{ marginTop: 12 }}>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'all'}
          className={`tabs__tab${scope === 'all' ? ' is-active' : ''}`}
          onClick={() => setScope('all')}
        >
          All Projects <span className="tabs__count">({rows.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scope === 'mine'}
          className={`tabs__tab${scope === 'mine' ? ' is-active' : ''}`}
          onClick={() => setScope('mine')}
          disabled={!profile?.id}
        >
          My Projects <span className="tabs__count">({myCount})</span>
        </button>
      </div>

      <div className="card" style={{ marginTop: 0 }}>
        <div className="masters-users__toolbar">
          <input
            type="search"
            className="masters-users__search"
            placeholder="Search projects by name, template, type, campus, school, creator…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search projects"
          />
          <ExportButton filename={scope === 'mine' ? 'my-projects' : 'projects'} columns={exportColumnsIndexed} rows={exportRows} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {loading ? (
          <div className="masters-users__empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="masters-users__empty">
            {scope === 'mine'
              ? (canCreate
                ? <>You haven&apos;t created any projects yet. Click <b>Create Project</b> above to add one.</>
                : 'You haven\'t created any projects.')
              : (canCreate
                ? <>No projects yet. Click <b>Create Project</b> to add one.</>
                : 'No projects yet.')}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="masters-users__table projects-table table--responsive">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Sr. No.</th>
                  <th>Project</th>
                  <th>Class</th>
                  <th>Project Type</th>
                  <th>Project Template</th>
                  <th>Campus</th>
                  <th>School</th>
                  <th>Created By</th>
                  <th>Timeline</th>
                  <th style={{ minWidth: 160 }}>Progress</th>
                  <th>Health</th>
                  <th>Status</th>
                  {canEdit && <th className="masters-users__action-col">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const rag = computeProjectRag(ragConfig, r, tasksByProject.get(r.id) ?? []);
                  const progress = rag.actualPct != null ? Math.round(rag.actualPct) : 0;
                  const health = { label: rag.overall.label, tone: toneClass(rag.overall.tone) };
                  return (
                    <tr key={r.id}>
                      <td data-label="Sr. No.">{i + 1}</td>
                      <td data-label="Project">
                        <Link to={`/projects/${r.id}`} className="table-link">{r.name}</Link>
                      </td>
                      <td data-label="Class">{r.project_class === 'greenfield' ? 'Greenfield' : 'Brownfield'}</td>
                      <td data-label="Project Type">{r.project_templates?.project_types?.name ?? r.project_types?.name ?? '—'}</td>
                      <td data-label="Project Template">
                        {r.project_templates?.name ?? '—'}{' '}
                        {r.template_versions && <span className="version-pill">v{r.template_versions.version_no}</span>}
                      </td>
                      <td data-label="Campus">{r.campuses?.name ?? '—'}</td>
                      <td data-label="School">{r.schools?.name ?? '—'}</td>
                      <td data-label="Created By">{fmtName(r.created_by_profile) || '—'}</td>
                      <td data-label="Timeline">
                        <div className="timeline-cell">
                          {(() => { const rng = effectiveRange(r, tasksByProject.get(r.id) ?? []); return (
                            <div><span className="timeline-cell__label">Planned:</span> {fmtDate(rng.start)} → {fmtDate(rng.end)}</div>
                          ); })()}
                          {(() => {
                            const arng = actualEffectiveRange(r, tasksByProject.get(r.id) ?? []);
                            if (!arng.start && !arng.end) return <div className="timeline-cell__muted"><span className="timeline-cell__label">Actual:</span> — not started</div>;
                            return <div className="timeline-cell__muted"><span className="timeline-cell__label">Actual:</span> {fmtDate(arng.start)} → {arng.end ? fmtDate(arng.end) : 'in progress'}</div>;
                          })()}
                        </div>
                      </td>
                      <td data-label="Progress">
                        <div className="progress-cell">
                          <div className="progress-cell__bar">
                            <div className="progress-cell__fill" style={{ width: `${progress}%` }} />
                            <div className="progress-cell__baseline" title="Baseline (target 100%)" />
                          </div>
                          <span className="progress-cell__label">{progress}%</span>
                        </div>
                      </td>
                      <td data-label="Health">
                        <span className={`health-pill health-pill--${health.tone}`}>{health.label}</span>
                      </td>
                      <td data-label="Status">
                        {r.is_draft ? (
                          <span className="draft-chip" title="Not yet finalised — visible only to you">Draft</span>
                        ) : (
                          <span className={`status-pill status-pill--${r.status}`}>{STATUS_LABEL[r.status] ?? r.status}</span>
                        )}
                      </td>
                      {canEdit && (
                        <td>
                          <div className="row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => handleEdit(r)}
                              aria-label={`Edit ${r.name}`}
                              title="Edit"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => handleUpdate(r)}
                              aria-label={`Update ${r.name}`}
                              title="Update progress"
                            >
                              ↻
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                className="icon-btn icon-btn--danger"
                                onClick={() => handleDelete(r)}
                                disabled={busyId === r.id}
                                aria-label={`Delete ${r.name}`}
                                title="Delete"
                              >
                                <IconTrash />
                              </button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
