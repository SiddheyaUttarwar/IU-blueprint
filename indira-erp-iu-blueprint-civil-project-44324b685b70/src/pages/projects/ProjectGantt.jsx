import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject, getProjectStructure, patchTask, addTaskDependency, removeTaskDependency } from '../../services/projects.js';
import { writeBaseline, listBaselinesForProject } from '../../services/projectBaselines.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import BackButton from '../../components/BackButton.jsx';

const DAY = 24 * 60 * 60 * 1000;

const VIEWS = {
  day:     { label: 'Day',     px: 40, unit: 1,   headerEvery: 1  },
  week:    { label: 'Week',    px: 22, unit: 7,   headerEvery: 7  },
  month:   { label: 'Month',   px: 8,  unit: 30,  headerEvery: 30 },
  quarter: { label: 'Quarter', px: 3,  unit: 90,  headerEvery: 90 },
};

const ROW_H = 34;
const HEADER_H = 44;
const NAME_W = 260;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dayIndex(d, start) { return Math.round((d.getTime() - start.getTime()) / DAY); }
function fmt(d) { return d.toISOString().slice(0, 10); }
function fmtShort(d) {
  const mm = d.toLocaleString('en-US', { month: 'short' });
  return `${mm} ${String(d.getDate()).padStart(2, '0')}`;
}
function pctFor(task) {
  if (task.status === 'done') return 100;
  if (task.status === 'in_progress') return 50;
  return 0;
}

export default function ProjectGantt() {
  const { projectId } = useParams();
  const { profile, isProjectManager } = useAuth();
  const toast = useToast();
  const [project, setProject] = useState(null);
  const [structure, setStructure] = useState({ tasks: [], milestones: [], dependencies: [] });
  const [baselines, setBaselines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('month');
  const [offsetDays, setOffsetDays] = useState(0);
  const [drag, setDrag] = useState(null); // { taskId, mode:'move'|'resize-l'|'resize-r', startX, deltaDays }
  const [linkDrag, setLinkDrag] = useState(null); // { fromTaskId, x, y, curX, curY }
  const chartRef = useRef(null);
  const svgRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [proj, struct, bls] = await Promise.all([
          getProject(projectId),
          getProjectStructure(projectId),
          listBaselinesForProject(projectId).catch(() => []),
        ]);
        if (!cancelled) { setProject(proj); setStructure(struct); setBaselines(bls); }
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [projectId, toast]);

  const cfg = VIEWS[view];

  const view$ = useMemo(() => {
    const tasks = (structure.tasks ?? []).filter((t) => t.start_date && t.end_date);
    if (!tasks.length) return null;
    const starts = tasks.map((t) => parseDate(t.start_date).getTime());
    const ends = tasks.map((t) => parseDate(t.end_date).getTime());
    const rawMin = new Date(Math.min(...starts) - 3 * DAY);
    const rawMax = new Date(Math.max(...ends) + 7 * DAY);
    const min = new Date(rawMin.getTime() + offsetDays * DAY);
    const totalDays = Math.max(30, dayIndex(rawMax, rawMin) + 10);
    const width = NAME_W + totalDays * cfg.px;
    const height = HEADER_H + tasks.length * ROW_H + 12;
    return { tasks, min, totalDays, width, height };
  }, [structure, cfg.px, offsetDays]);

  function xForDate(d) {
    if (!view$) return 0;
    return NAME_W + dayIndex(d, view$.min) * cfg.px;
  }

  function shift(days) { setOffsetDays((v) => v + days); }
  function zoomIn() {
    const order = ['quarter', 'month', 'week', 'day'];
    const i = order.indexOf(view);
    if (i < order.length - 1) setView(order[i + 1]);
  }
  function zoomOut() {
    const order = ['quarter', 'month', 'week', 'day'];
    const i = order.indexOf(view);
    if (i > 0) setView(order[i - 1]);
  }

  // Drag handling
  useEffect(() => {
    if (!drag) return;
    function onMove(e) {
      const dx = e.clientX - drag.startX;
      const delta = Math.round(dx / cfg.px);
      setDrag((d) => d ? { ...d, deltaDays: delta } : d);
    }
    async function onUp() {
      const d = drag;
      setDrag(null);
      if (!d || !d.deltaDays) return;
      const task = structure.tasks.find((t) => t.id === d.taskId);
      if (!task) return;
      const start = parseDate(task.start_date);
      const end = parseDate(task.end_date);
      let newStart = start, newEnd = end;
      if (d.mode === 'move') { newStart = new Date(start.getTime() + d.deltaDays * DAY); newEnd = new Date(end.getTime() + d.deltaDays * DAY); }
      if (d.mode === 'resize-l') { newStart = new Date(start.getTime() + d.deltaDays * DAY); }
      if (d.mode === 'resize-r') { newEnd = new Date(end.getTime() + d.deltaDays * DAY); }
      if (newStart > newEnd) { toast.error('Start cannot be after end.'); return; }
      const patch = { start_date: fmt(newStart), end_date: fmt(newEnd) };
      const prev = { start: task.start_date, end: task.end_date };
      const reasonInput = window.prompt(
        `Reason for changing dates on "${task.name || 'this task'}"?\n(Required — stored on the baseline.)`,
        '',
      );
      if (reasonInput === null) return;
      const reason = reasonInput.trim();
      if (!reason) { toast.error('A reason is required to change dates.'); return; }
      setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === d.taskId ? { ...t, ...patch } : t) }));
      try {
        try {
          const bl = await writeBaseline({
            projectId, taskId: d.taskId, kind: 'task_date',
            previousStart: prev.start, previousEnd: prev.end,
            reason, actorId: profile?.id,
          });
          if (bl) setBaselines((prevBls) => [...prevBls, bl]);
        } catch (blErr) { console.warn('Baseline snapshot failed (non-blocking):', blErr); }
        await patchTask(d.taskId, patch, { actorId: profile?.id });
        toast.success('Dates updated. Previous dates baselined.');
      } catch (err) { toast.error(err.message || 'Failed to update.'); }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, cfg.px, structure.tasks, profile?.id, toast]);

  function startDrag(taskId, mode, e) {
    if (!isProjectManager) return;
    e.preventDefault();
    setDrag({ taskId, mode, startX: e.clientX, deltaDays: 0 });
  }

  function startLinkDrag(fromTaskId, startX, startY, e) {
    if (!isProjectManager) return;
    e.preventDefault();
    e.stopPropagation();
    setLinkDrag({ fromTaskId, x: startX, y: startY, curX: startX, curY: startY });
  }

  // Track link drag movement (SVG coordinates)
  useEffect(() => {
    if (!linkDrag) return;
    function svgPoint(e) {
      const svg = svgRef.current;
      if (!svg) return { x: e.clientX, y: e.clientY };
      const rect = svg.getBoundingClientRect();
      return { x: e.clientX - rect.left + svg.parentElement.scrollLeft, y: e.clientY - rect.top };
    }
    function onMove(e) {
      const p = svgPoint(e);
      setLinkDrag((d) => d ? { ...d, curX: p.x, curY: p.y } : d);
    }
    async function onUp(e) {
      const p = svgPoint(e);
      const d = linkDrag;
      setLinkDrag(null);
      if (!d || !view$) return;
      // Determine target task by y coordinate
      const rowIndex = Math.floor((p.y - HEADER_H) / ROW_H);
      if (rowIndex < 0 || rowIndex >= view$.tasks.length) return;
      const target = view$.tasks[rowIndex];
      if (!target || target.id === d.fromTaskId) return;
      try {
        await addTaskDependency(projectId, target.id, d.fromTaskId, { actorId: profile?.id });
        setStructure((s) => ({ ...s, dependencies: [...(s.dependencies ?? []), { task_id: target.id, depends_on_task_id: d.fromTaskId }] }));
        toast.success(`Dependency: "${target.name}" now depends on the previous task.`);
      } catch (err) { toast.error(err.message || 'Failed to add dependency.'); }
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [linkDrag, view$, projectId, profile?.id, toast]);

  async function deleteDep(taskId, dependsOnTaskId) {
    if (!isProjectManager) return;
    if (!window.confirm('Delete this dependency?')) return;
    try {
      await removeTaskDependency(projectId, taskId, dependsOnTaskId, { actorId: profile?.id });
      setStructure((s) => ({ ...s, dependencies: (s.dependencies ?? []).filter((d) => !(d.task_id === taskId && d.depends_on_task_id === dependsOnTaskId)) }));
      toast.success('Dependency removed.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (!project) return <div className="card">Project not found.</div>;

  const isLocked = project.status === 'completed';
  const canDrag = isProjectManager && !isLocked;

  return (
    <>
      <BackButton to={`/projects/${projectId}`} label="Back to Project" />
      <div className="gantt-topbar">
        <h2 className="page-title" style={{ marginBottom: 0 }}>{project.name} — Gantt Chart</h2>
        <Link to={`/projects/${projectId}/kanban`} className="btn-secondary btn-secondary--sm">Kanban view</Link>
      </div>

      <div className="card gantt-card">
        <div className="gantt-toolbar">
          <div className="gantt-toolbar__group">
            <button type="button" className="gantt-btn" onClick={zoomOut} title="Zoom out" aria-label="Zoom out">−</button>
            <button type="button" className="gantt-btn" onClick={zoomIn} title="Zoom in" aria-label="Zoom in">+</button>
            <button type="button" className="gantt-btn" onClick={() => shift(-cfg.unit)} title="Previous" aria-label="Previous">‹</button>
            <button type="button" className="gantt-btn" onClick={() => shift(cfg.unit)} title="Next" aria-label="Next">›</button>
            <button type="button" className="gantt-btn" onClick={() => setOffsetDays(0)} title="Reset" aria-label="Reset">⤺</button>
          </div>
          <div className="gantt-view-toggle">
            {Object.entries(VIEWS).map(([k, v]) => (
              <button
                key={k}
                type="button"
                className={`gantt-view-toggle__btn${view === k ? ' is-active' : ''}`}
                onClick={() => setView(k)}
              >{v.label}</button>
            ))}
          </div>
          <div className="gantt-legend">
            <span className="gantt-legend__item"><span className="gantt-legend__dot gantt-legend__dot--planned" />Planned</span>
            <span className="gantt-legend__item"><span className="gantt-legend__dot gantt-legend__dot--actual" />Actual</span>
            <span className="gantt-legend__item"><span className="gantt-legend__dot gantt-legend__dot--wip" />In Progress</span>
            <span className="gantt-legend__item"><span className="gantt-legend__dot gantt-legend__dot--today" />Today</span>
            <span className="gantt-legend__item"><span className="gantt-legend__dot gantt-legend__dot--milestone" />Milestone</span>
            <span className="gantt-legend__item"><span className="gantt-legend__dot" style={{ background: '#94a3b8' }} />Baseline (previous plan)</span>
          </div>
        </div>

        {!view$ ? (
          <div className="masters-users__empty">No tasks with start + end dates yet.</div>
        ) : (
          <div className="gantt-scroll" ref={chartRef}>
            <svg ref={svgRef} width={view$.width} height={view$.height} className="gantt-svg">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                </marker>
              </defs>
              {/* Grid */}
              {Array.from({ length: view$.totalDays + 1 }).map((_, i) => {
                if (i % cfg.headerEvery !== 0) return null;
                const x = NAME_W + i * cfg.px;
                return <line key={`g${i}`} x1={x} y1={HEADER_H - 8} x2={x} y2={view$.height} stroke="#e2e8f0" strokeWidth={0.8} />;
              })}
              {/* Header dates */}
              {Array.from({ length: Math.floor(view$.totalDays / cfg.headerEvery) + 1 }).map((_, i) => {
                const d = new Date(view$.min.getTime() + i * cfg.headerEvery * DAY);
                return <text key={`h${i}`} x={NAME_W + i * cfg.headerEvery * cfg.px + 4} y={HEADER_H - 14} fontSize="11" fill="#64748b" fontWeight="600">{fmtShort(d)}</text>;
              })}
              {/* Header divider */}
              <line x1={0} y1={HEADER_H - 6} x2={view$.width} y2={HEADER_H - 6} stroke="#cbd5e1" />
              {/* Name column background */}
              <rect x={0} y={0} width={NAME_W} height={view$.height} fill="#fafbfc" />
              <line x1={NAME_W} y1={0} x2={NAME_W} y2={view$.height} stroke="#cbd5e1" />

              {/* Task rows */}
              {view$.tasks.map((t, i) => {
                const y = HEADER_H + i * ROW_H;
                const isSub = !!t.parent_task_id;
                const start = parseDate(t.start_date);
                const end = parseDate(t.end_date);
                const actualStart = parseDate(t.actual_start_date);
                const actualEnd = parseDate(t.actual_completion_date);
                const dDelta = (drag && drag.taskId === t.id) ? drag.deltaDays : 0;

                const moveOffset = (drag && drag.taskId === t.id && drag.mode === 'move') ? dDelta * cfg.px : 0;
                const resizeLOffset = (drag && drag.taskId === t.id && drag.mode === 'resize-l') ? dDelta * cfg.px : 0;
                const resizeROffset = (drag && drag.taskId === t.id && drag.mode === 'resize-r') ? dDelta * cfg.px : 0;

                const plannedX = xForDate(start) + moveOffset + resizeLOffset;
                const plannedW = Math.max(2, (dayIndex(end, view$.min) - dayIndex(start, view$.min) + 1) * cfg.px + moveOffset * 0 + resizeROffset - resizeLOffset);

                const inProgress = t.status === 'in_progress';
                const done = t.status === 'done';

                const taskBaselines = baselines.filter((b) => b.task_id === t.id && b.snapshot_start && b.snapshot_end);
                return (
                  <g key={t.id}>
                    {/* Row separator */}
                    <line x1={0} y1={y + ROW_H} x2={view$.width} y2={y + ROW_H} stroke="#eef2f5" />
                    {/* Baselines — frozen ghost lines above the current planned bar (one per snapshot). */}
                    {taskBaselines.map((bl, k) => {
                      const bs = parseDate(bl.snapshot_start);
                      const be = parseDate(bl.snapshot_end);
                      if (!bs || !be) return null;
                      const bx = xForDate(bs);
                      const bw = Math.max(2, (dayIndex(be, view$.min) - dayIndex(bs, view$.min) + 1) * cfg.px);
                      const by = y + 4 + k * 3; // stack multiple baselines top-to-bottom
                      return (
                        <g key={`bl-${bl.id}`}>
                          <rect x={bx} y={by} width={bw} height={2} fill="#94a3b8" opacity="0.7">
                            <title>{`Baseline ${new Date(bl.created_at).toLocaleString()}: ${bl.snapshot_start} → ${bl.snapshot_end}`}</title>
                          </rect>
                        </g>
                      );
                    })}
                    {/* Left panel — name + percent */}
                    <text x={isSub ? 32 : 12} y={y + ROW_H / 2 + 4} fontSize="12" fill="#1f2937" fontWeight={isSub ? 400 : 600}>
                      {(isSub ? '↳ ' : '') + (t.name.length > 28 ? t.name.slice(0, 28) + '…' : t.name)}
                    </text>
                    <text x={NAME_W - 44} y={y + ROW_H / 2 + 4} fontSize="10" fill="#94a3b8">{pctFor(t)}%</text>

                    {/* Planned bar */}
                    <rect
                      x={plannedX} y={y + 8}
                      width={plannedW} height={ROW_H - 16} rx={4}
                      fill={done ? '#dcf5e5' : inProgress ? '#fff2d9' : '#dfe9f4'}
                      stroke={done ? '#166534' : inProgress ? '#a56a00' : '#155685'}
                      strokeWidth={1.2}
                      opacity="0.9"
                      style={{ cursor: canDrag ? 'grab' : 'default' }}
                      onMouseDown={(e) => startDrag(t.id, 'move', e)}
                    />
                    {/* Resize handles */}
                    {canDrag && (
                      <>
                        <rect x={plannedX - 3} y={y + 8} width={6} height={ROW_H - 16} fill="transparent" style={{ cursor: 'ew-resize' }} onMouseDown={(e) => startDrag(t.id, 'resize-l', e)} />
                        <rect x={plannedX + plannedW - 3} y={y + 8} width={6} height={ROW_H - 16} fill="transparent" style={{ cursor: 'ew-resize' }} onMouseDown={(e) => startDrag(t.id, 'resize-r', e)} />
                        {/* Link handle — small circle on right edge */}
                        <circle
                          cx={plannedX + plannedW + 6} cy={y + ROW_H / 2}
                          r={4} fill="#fff" stroke="#155685" strokeWidth={1.2}
                          className="gantt-link-handle"
                          style={{ cursor: 'crosshair' }}
                          onMouseDown={(e) => startLinkDrag(t.id, plannedX + plannedW + 6, y + ROW_H / 2, e)}
                        >
                          <title>Drag to another task to link (that task will depend on this one)</title>
                        </circle>
                      </>
                    )}
                    {/* Actual overlay */}
                    {actualStart && (() => {
                      const actEnd = actualEnd ?? new Date();
                      const ax = xForDate(actualStart);
                      const aw = Math.max(2, (dayIndex(actEnd, view$.min) - dayIndex(actualStart, view$.min) + 1) * cfg.px);
                      return <rect x={ax} y={y + ROW_H - 10} width={aw} height={4} rx={2} fill="#22a06b" />;
                    })()}
                  </g>
                );
              })}

              {/* Dependency arrows (existing) — clickable to delete */}
              {(structure.dependencies ?? []).map((dep, i) => {
                const fromIdx = view$.tasks.findIndex((t) => t.id === dep.depends_on_task_id);
                const toIdx = view$.tasks.findIndex((t) => t.id === dep.task_id);
                if (fromIdx === -1 || toIdx === -1) return null;
                const from = view$.tasks[fromIdx];
                const to = view$.tasks[toIdx];
                const fromEnd = parseDate(from.end_date);
                const toStart = parseDate(to.start_date);
                if (!fromEnd || !toStart) return null;
                const x1 = xForDate(fromEnd) + cfg.px;
                const y1 = HEADER_H + fromIdx * ROW_H + ROW_H / 2;
                const x2 = xForDate(toStart);
                const y2 = HEADER_H + toIdx * ROW_H + ROW_H / 2;
                const midX = Math.max(x1 + 8, x2 - 8);
                const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 2} ${y2}`;
                return (
                  <g key={`dep-${i}`} className="gantt-dep-arrow" onClick={() => deleteDep(to.id, from.id)}>
                    <path d={d} fill="none" stroke="transparent" strokeWidth="10" style={{ cursor: canDrag ? 'pointer' : 'default' }} />
                    <path d={d} fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#arrow)" />
                    <title>{canDrag ? 'Click to delete this dependency' : `${from.name} → ${to.name}`}</title>
                  </g>
                );
              })}

              {/* In-flight link drag preview */}
              {linkDrag && (
                <line x1={linkDrag.x} y1={linkDrag.y} x2={linkDrag.curX} y2={linkDrag.curY}
                  stroke="#155685" strokeWidth="1.5" strokeDasharray="4 4" pointerEvents="none" />
              )}

              {/* Milestones — red diamond markers on the top strip and a light dashed line down */}
              {(structure.milestones ?? []).map((m) => {
                const target = parseDate(m.target_date);
                if (!target) return null;
                const x = xForDate(target);
                return (
                  <g key={m.id}>
                    <line x1={x} y1={HEADER_H} x2={x} y2={view$.height} stroke="#b3261e" strokeDasharray="3 3" strokeWidth={1} />
                    <polygon points={`${x - 6},${HEADER_H - 4} ${x},${HEADER_H - 14} ${x + 6},${HEADER_H - 4} ${x},${HEADER_H + 6}`} fill="#b3261e" />
                    <title>{`Milestone: ${m.name} (${m.target_date})`}</title>
                  </g>
                );
              })}

              {/* Today red vertical line */}
              {(() => {
                const t = new Date();
                if (t < view$.min) return null;
                const x = xForDate(t);
                if (x > view$.width) return null;
                return (
                  <>
                    <line x1={x} y1={HEADER_H - 6} x2={x} y2={view$.height} stroke="#ef4444" strokeWidth={1.4} />
                    <rect x={x - 22} y={HEADER_H - 26} width={44} height={16} rx={3} fill="#ef4444" />
                    <text x={x} y={HEADER_H - 14} textAnchor="middle" fontSize="10" fill="#fff" fontWeight="600">TODAY</text>
                  </>
                );
              })()}
            </svg>
          </div>
        )}

        {canDrag ? (
          <div className="form-hint" style={{ marginTop: 8 }}>
            Tip: drag a bar to shift both dates · drag the left/right edge to change start or end · drag the small circle on the right edge onto another bar to link (dependency) · click an existing arrow to delete it. Changes save automatically.
          </div>
        ) : isLocked ? (
          <div className="form-hint" style={{ marginTop: 8, color: '#a56a00' }}>Project is completed — Gantt is read-only.</div>
        ) : null}
      </div>
    </>
  );
}
