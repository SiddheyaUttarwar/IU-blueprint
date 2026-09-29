import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { listMyTasks } from '../services/projects.js';
import { listMyIndentItems } from '../services/indentDeliveries.js';
import { listLatestUpdatesForTasks } from '../services/subtaskUpdates.js';
import SubtaskUpdateModal from '../components/SubtaskUpdateModal.jsx';
import IndentDeliveryModal from '../components/IndentDeliveryModal.jsx';
import PmTasksPivot from '../components/PmTasksPivot.jsx';
import LeadershipApprovalsList from '../components/LeadershipApprovalsList.jsx';

function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : '—'; }
function daysLeft(due) {
  if (!due) return null;
  return Math.ceil((new Date(due).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
function fmtName(p) {
  if (!p) return '—';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || '—';
}

export default function MyTasks() {
  const { isProjectManager, isLeadership } = useAuth();
  if (isProjectManager) return <PmTasksPivot />;
  if (isLeadership) return <LeadershipApprovalsList />;
  return <MemberMyTasks />;
}

function MemberMyTasks() {
  const { profile } = useAuth();
  const [subs, setSubs] = useState([]);
  const [items, setItems] = useState([]);
  const [latestByTask, setLatestByTask] = useState(new Map());
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(new Set());
  const [updatingSub, setUpdatingSub] = useState(null);
  const [receivingItem, setReceivingItem] = useState(null);
  const [groupBy, setGroupBy] = useState('project'); // 'project' (default) | 'overall'

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [t, i] = await Promise.all([
          listMyTasks(profile?.id).catch(() => []),
          listMyIndentItems(profile?.id).catch(() => []),
        ]);
        if (cancelled) return;
        setSubs(t); setItems(i);
        const latest = t.length ? await listLatestUpdatesForTasks(t.map((x) => x.id)).catch(() => new Map()) : new Map();
        if (!cancelled) setLatestByTask(latest);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [profile?.id]);

  // One entry per project: { project, tasks: [{ parent, subs: [] }], items: [] }
  const byProject = useMemo(() => {
    const m = new Map();
    for (const s of subs) {
      const proj = s.projects;
      if (!proj) continue;
      if (!m.has(proj.id)) m.set(proj.id, { project: proj, tasks: new Map(), items: [] });
      const tasks = m.get(proj.id).tasks;
      const key = s.parent?.id ?? '_none';
      if (!tasks.has(key)) tasks.set(key, { parent: s.parent, subs: [] });
      tasks.get(key).subs.push(s);
    }
    for (const it of items) {
      const proj = it.indent?.project;
      if (!proj) continue;
      if (!m.has(proj.id)) m.set(proj.id, { project: proj, tasks: new Map(), items: [] });
      m.get(proj.id).items.push(it);
    }
    return Array.from(m.values()).map((p) => ({
      project: p.project,
      tasks: Array.from(p.tasks.values()),
      items: p.items,
    }));
  }, [subs, items]);

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function afterUpdate(saved) {
    setLatestByTask((prev) => { const n = new Map(prev); n.set(saved.task_id, saved); return n; });
  }
  function afterDelivery(patch) {
    setItems((prev) => prev.map((it) => it.id === patch.id ? { ...it, received_qty: patch.received_qty } : it));
  }

  if (loading) return <div className="card">Loading…</div>;

  if (byProject.length === 0) {
    return (
      <>
        <h2 className="page-title">My Tasks</h2>
        <div className="card"><div className="masters-users__empty">Nothing assigned to you right now.</div></div>
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>My Tasks</h2>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="form-hint" style={{ margin: 0 }}>Group by:</span>
          <button type="button"
            className={`btn-secondary btn-secondary--sm${groupBy === 'project' ? ' is-active' : ''}`}
            style={groupBy === 'project' ? { background: '#155685', color: '#fff', borderColor: '#155685' } : {}}
            onClick={() => setGroupBy('project')}>By Project</button>
          <button type="button"
            className={`btn-secondary btn-secondary--sm${groupBy === 'overall' ? ' is-active' : ''}`}
            style={groupBy === 'overall' ? { background: '#155685', color: '#fff', borderColor: '#155685' } : {}}
            onClick={() => setGroupBy('overall')}>Overall</button>
        </div>
      </div>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        {groupBy === 'project'
          ? 'Projects where you have work assigned. Click a project to drill down into your tasks, subtasks, and Indent Cum Budget items.'
          : 'All your assigned subtasks and items across every project — flat list, sorted by due date.'}
      </div>

      {groupBy === 'overall' && (
        <div className="card" style={{ padding: 0 }}>
          <MyTasksTable
            rows={[...subs].sort((a, b) => (a.end_date || '9999').localeCompare(b.end_date || '9999'))}
            latestByTask={latestByTask}
            onOpenUpdate={(s) => setUpdatingSub({ subtask: s, parent: '', project: s.projects?.name ?? '' })}
          />
        </div>
      )}

      {groupBy === 'project' && <div className="my-tasks-projects">
        {byProject.map(({ project, tasks, items: pItems }) => {
          const open = expanded.has(project.id);
          const subCount = tasks.reduce((n, t) => n + t.subs.length, 0);
          const itemsPending = pItems.filter((it) => Number(it.received_qty ?? 0) < Number(it.buy_qty ?? 0)).length;
          return (
            <div key={project.id} className="my-tasks-proj">
              <button type="button" className="my-tasks-proj__head" onClick={() => toggle(project.id)} aria-expanded={open}>
                <span className="my-tasks-proj__toggle" aria-hidden="true">{open ? '▾' : '▸'}</span>
                <span className="my-tasks-proj__title">
                  <Link to={`/projects/${project.id}`} onClick={(e) => e.stopPropagation()}>{project.name}</Link>
                </span>
                <span className={`status-pill status-pill--${project.status}`}>{project.status?.replace('_', ' ')}</span>
                <span className="my-tasks-proj__counts">
                  {subCount > 0 && <span>{subCount} subtask{subCount === 1 ? '' : 's'}</span>}
                  {pItems.length > 0 && <span>{pItems.length} item{pItems.length === 1 ? '' : 's'}{itemsPending ? ` (${itemsPending} pending)` : ''}</span>}
                </span>
              </button>

              {open && (
                <div className="my-tasks-proj__body">
                  {project.status !== 'active' && (
                    <div className="member-gate-notice">
                      {project.status === 'planning' && <>Project is <b>Planning</b>. Updates are disabled until the Project Manager starts the project.</>}
                      {project.status === 'on_hold' && <>Project is <b>On Hold</b>. Updates are disabled until the Project Manager resumes it.</>}
                      {project.status === 'completed' && <>Project has been <b>Completed</b>. Task and delivery updates are no longer needed — the record is read-only.</>}
                      {project.status === 'cancelled' && <>Project has been <b>Cancelled</b>. No further updates are accepted.</>}
                    </div>
                  )}
                  {tasks.length > 0 && tasks.map(({ parent, subs: pSubs }) => (
                    <div key={parent?.id ?? 'none'} className="my-tasks-task-block">
                      <div className="my-tasks-task-name">{parent?.name ?? '(No parent task)'}</div>
                      <ul className="my-tasks-sublist">
                        {pSubs.map((s) => {
                          const dLeft = daysLeft(s.end_date);
                          const done = s.status === 'done';
                          const overdue = dLeft != null && dLeft < 0 && !done;
                          const latest = latestByTask.get(s.id);
                          return (
                            <li key={s.id} className={`my-tasks-sub ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}`}>
                              <div className="my-tasks-sub__main">
                                <div className="my-tasks-sub__name"><span className="my-tasks-kind">Subtask</span> {s.name}</div>
                                <div className="form-hint">
                                  Due {fmtDate(s.end_date)}
                                  {dLeft != null && !done && <span style={{ marginLeft: 6, color: overdue ? '#b3261e' : '#a56a00' }}>{overdue ? `(${Math.abs(dLeft)}d overdue)` : `(${dLeft}d left)`}</span>}
                                </div>
                                {latest ? (
                                  <div className="my-tasks-sub__preview">
                                    <b>Latest update:</b> {fmtDate(latest.update_date)} by {fmtName(latest.author)}
                                    {latest.notes && <span> · <i>{latest.notes.length > 80 ? latest.notes.slice(0, 80) + '…' : latest.notes}</i></span>}
                                    <span className="my-tasks-sub__till"> · till {fmtDate(latest.update_date)}</span>
                                  </div>
                                ) : (
                                  <div className="my-tasks-sub__preview my-tasks-sub__preview--empty">No updates yet.</div>
                                )}
                              </div>
                              <div className="my-tasks-sub__side">
                                <span className={`status-pill status-pill--${s.status ?? 'not_started'}`}>{(s.status ?? 'not_started').replace('_', ' ')}</span>
                                <button type="button" className="btn-primary btn-primary--sm" onClick={() => setUpdatingSub({ subtask: s, parent: parent?.name ?? '', project: project.name })} disabled={project.status !== 'active'} title={project.status === 'active' ? 'Log update' : project.status === 'completed' ? 'Project completed — updates locked' : project.status === 'cancelled' ? 'Project cancelled' : project.status === 'on_hold' ? 'Project on hold' : 'Project not started yet'}>Update</button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}

                  {pItems.length > 0 && (
                    <div className="my-tasks-task-block">
                      <div className="my-tasks-task-name">Indent Cum Budget items</div>
                      <ul className="my-tasks-sublist">
                        {pItems.map((it) => {
                          const rec = Number(it.received_qty ?? 0);
                          const buy = Number(it.buy_qty ?? 0);
                          const state = rec >= buy && buy > 0 ? 'done' : rec > 0 ? 'partial' : 'none';
                          return (
                            <li key={it.id} className="my-tasks-sub">
                              <div className="my-tasks-sub__main">
                                <div className="my-tasks-sub__name">
                                  <span className="my-tasks-kind">Item</span> {it.item_name}
                                  {it.item_description ? <span className="form-hint"> · {it.item_description}</span> : null}
                                </div>
                                <div className="form-hint">Indent #{it.indent?.indent_number} · {fmtDate(it.indent?.indent_date)}</div>
                              </div>
                              <div className="my-tasks-sub__side">
                                <span className={`recv-pill recv-pill--${state}`}>{rec} / {buy}{it.unit ? ` ${it.unit}` : ''}</span>
                                <button type="button" className="btn-primary btn-primary--sm" onClick={() => setReceivingItem({ item: it, projectName: project.name })} disabled={project.status !== 'active'} title={project.status === 'active' ? 'Record delivery' : project.status === 'completed' ? 'Project completed — deliveries locked' : project.status === 'cancelled' ? 'Project cancelled' : project.status === 'on_hold' ? 'Project on hold' : 'Project not started yet'}>Update</button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>}

      {updatingSub && (
        <SubtaskUpdateModal
          subtask={updatingSub.subtask}
          parentTaskName={updatingSub.parent}
          projectName={updatingSub.project}
          onClose={() => setUpdatingSub(null)}
          onSaved={afterUpdate}
        />
      )}
      {receivingItem && (
        <IndentDeliveryModal
          item={receivingItem.item}
          projectName={receivingItem.projectName}
          onClose={() => setReceivingItem(null)}
          onSaved={afterDelivery}
        />
      )}
    </>
  );
}

// Flat MyTasks table matching the screenshot: TASK · PROJECT · PLANNED · STATUS · ACTUAL START · ACTUAL FINISH · PROGRESS
function MyTasksTable({ rows, latestByTask, onOpenUpdate }) {
  if (!rows.length) return <div className="masters-users__empty" style={{ padding: 20 }}>Nothing assigned.</div>;
  return (
    <table className="my-tasks-table">
      <thead>
        <tr>
          <th>Task</th>
          <th>Project</th>
          <th>Planned</th>
          <th>Status</th>
          <th>Actual Start</th>
          <th>Actual Finish</th>
          <th>Progress</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          const dLeft = daysLeft(s.end_date);
          const done = s.status === 'done';
          const overdue = dLeft != null && dLeft < 0 && !done;
          const latest = latestByTask.get(s.id);
          const proj = s.projects || {};
          const projStatus = proj.status;
          const isQty = s.progress_metric === 'quantity';
          const q = Number(s.quantity_value ?? 0);
          const av = Number(s.actual_value ?? 0);
          const pct = done ? 100 : isQty && q > 0 ? Math.min(100, Math.round((av / q) * 100)) : (s.status === 'in_progress' ? 50 : 0);
          return (
            <tr key={s.id} className={`my-tasks-table__row${done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}`}>
              <td>
                <div className="my-tasks-table__name">{s.name}</div>
                {s.parent_task_id && <div className="form-hint">{s.parent_name || 'Subtask'}</div>}
              </td>
              <td>
                <div className="my-tasks-table__project">{proj.name || '—'}</div>
                <div className="form-hint">{(proj.id || '').slice(0, 8).toUpperCase()}</div>
              </td>
              <td>
                <div>{fmtDate(s.start_date)}</div>
                <div className="form-hint">{fmtDate(s.end_date)}</div>
              </td>
              <td>
                <span className={`status-pill status-pill--${s.status ?? 'not_started'}`}>{(s.status ?? 'not_started').replace('_', ' ')}</span>
              </td>
              <td>
                <input type="date" defaultValue={s.actual_start_date ?? ''} disabled className="tpl-input" style={{ width: 130 }} />
              </td>
              <td>
                <input type="date" defaultValue={s.actual_completion_date ?? ''} disabled className="tpl-input" style={{ width: 130 }} />
              </td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number"
                    className="tpl-input tpl-input--num"
                    defaultValue={isQty ? Math.round(av) : pct}
                    style={{ width: 60 }}
                    onClick={() => onOpenUpdate(s)}
                    readOnly
                    title="Click to log an update"
                  />
                  <span className="form-hint">{isQty ? `of ${q} ${s.quantity_unit || ''}` : '%'}</span>
                </div>
                <div className="my-tasks-table__bar">
                  <div className="my-tasks-table__bar-fill" style={{ width: `${pct}%`, background: done ? '#166534' : '#14b8a6' }} />
                </div>
                {latest && (
                  <div className="form-hint" style={{ marginTop: 2 }}>
                    {fmtDate(latest.update_date)} · {fmtName(latest.author)}
                  </div>
                )}
                <button
                  type="button"
                  className="btn-primary btn-primary--sm"
                  style={{ marginTop: 4 }}
                  onClick={() => onOpenUpdate(s)}
                  disabled={projStatus !== 'active'}
                >Update</button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
