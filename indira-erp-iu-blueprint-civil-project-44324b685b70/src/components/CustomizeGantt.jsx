import { useEffect, useMemo, useRef, useState } from 'react';

const DAY = 24 * 60 * 60 * 1000;
const VIEWS = {
  day:   { label: 'Day',   px: 32, headerEvery: 1  },
  week:  { label: 'Week',  px: 16, headerEvery: 7  },
  month: { label: 'Month', px: 5,  headerEvery: 30 },
  year:  { label: 'Year',  px: 2,  headerEvery: 90 },
};

const ROW_H = 34;
const HEADER_H = 36;
const BAR_H = 14;

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function dayIndex(d, start) { return Math.round((d.getTime() - start.getTime()) / DAY); }
function fmt(d) { return d.toISOString().slice(0, 10); }
function fmtShort(d, view) {
  if (view === 'year') return d.getFullYear().toString();
  const mm = d.toLocaleString('en-US', { month: 'short' });
  if (view === 'month' || view === 'quarter') return `${mm} '${String(d.getFullYear()).slice(2)}`;
  return `${mm} ${String(d.getDate()).padStart(2, '0')}`;
}

// Flatten customState (nested project tree) to a linear list preserving depth + parent info.
// Milestones (state.project.milestones) get appended at the bottom as fake single-day rows so
// they appear on the same date axis as bars with a diamond marker on their target_date.
function flatten(state) {
  const out = [];
  function walk(nodes, depth, parentTmpId) {
    for (const n of nodes ?? []) {
      const isSummary = (n.children?.length ?? 0) > 0;
      out.push({ node: n, depth, parentTmpId, isSummary, isMilestone: false });
      if (n.children?.length) walk(n.children, depth + 1, n.tmp_id);
    }
  }
  walk(state?.project?.tasks ?? [], 0, null);
  for (const m of state?.project?.milestones ?? []) {
    // Milestones render as diamonds on their target_date. We fake start=end=target so range calc
    // and drag logic reuse the same code path.
    const md = m.target_date || m.reached_date || null;
    out.push({
      node: {
        tmp_id: m.tmp_id ?? m.id,
        name: m.name,
        task_type: 'milestone',
        start_date: md,
        end_date: md,
        weight_pct: 0,
        children: [],
      },
      depth: 0,
      parentTmpId: null,
      isSummary: false,
      isMilestone: true,
    });
  }
  return out;
}

// Summary bars span their descendants' [min start, max end] once children have dates.
function computeSummaryRange(node) {
  if (!node.children?.length) {
    const s = parseDate(node.start_date);
    const e = parseDate(node.end_date);
    if (s && e) return { start: s, end: e };
    return null;
  }
  let min = null, max = null;
  for (const c of node.children) {
    const r = computeSummaryRange(c);
    if (!r) continue;
    if (!min || r.start < min) min = r.start;
    if (!max || r.end > max) max = r.end;
  }
  return min && max ? { start: min, end: max } : null;
}

// Editable split-view Gantt for the project-creation Customize step.
// - state: customState from ProjectNewManual.
// - dependencies: customDeps.
// - baselines: Map(tmp_id -> Array<{ snapshot_start, snapshot_end, created_at }>) — session-only during creation.
// - onDatesChange(tmpId, { start_date, end_date }): called when user drags a bar or its handles.
// - onCreateDep(fromTmpId, toTmpId), onDeleteDep(taskTmpId, dependsOnTmpId): dependency edit callbacks.
// - onSelect(tmpId): sync selection back to the list.
// - selectedTmpId: highlight the corresponding row.
// - projectStart / projectEnd: fallback date range when no tasks have dates yet.
// - readOnly: disables all drag/edit interactions.
export default function CustomizeGantt({
  state, dependencies = [], baselines,
  onDatesChange, onCreateDep, onDeleteDep, onSelect,
  selectedTmpId, projectStart, projectEnd, readOnly = false,
}) {
  const [view, setView] = useState('week');
  const [drag, setDrag] = useState(null);          // { taskTmpId, mode: 'move'|'resize-l'|'resize-r', startX, deltaDays }
  const [linkDrag, setLinkDrag] = useState(null);  // { fromTmpId, x, y, curX, curY }
  const svgRef = useRef(null);
  const cfg = VIEWS[view];

  const rows = useMemo(() => flatten(state), [state]);

  // Date axis window — from earliest task start (or project start) to latest end + padding.
  const dateWindow = useMemo(() => {
    const withDates = rows
      .map((r) => ({
        s: parseDate(r.node.start_date),
        e: parseDate(r.node.end_date),
        summary: r.isSummary ? computeSummaryRange(r.node) : null,
      }))
      .flatMap((x) => {
        const items = [];
        if (x.s && x.e) items.push({ s: x.s, e: x.e });
        if (x.summary) items.push({ s: x.summary.start, e: x.summary.end });
        return items;
      });
    if (!withDates.length) {
      const min = parseDate(projectStart) ?? new Date();
      const max = parseDate(projectEnd) ?? new Date(min.getTime() + 30 * DAY);
      return { min: new Date(min.getTime() - 3 * DAY), max: new Date(Math.max(max.getTime(), min.getTime() + 30 * DAY) + 7 * DAY) };
    }
    const starts = withDates.map((x) => x.s.getTime());
    const ends = withDates.map((x) => x.e.getTime());
    return {
      min: new Date(Math.min(...starts) - 3 * DAY),
      max: new Date(Math.max(...ends) + 7 * DAY),
    };
  }, [rows, projectStart, projectEnd]);

  const totalDays = Math.max(30, dayIndex(dateWindow.max, dateWindow.min) + 1);
  const width = totalDays * cfg.px;
  const height = HEADER_H + rows.length * ROW_H + 8;

  function xForDate(d) { return dayIndex(d, dateWindow.min) * cfg.px; }

  // Bar drag (move / resize)
  useEffect(() => {
    if (!drag || readOnly) return;
    function onMove(e) {
      const dx = e.clientX - drag.startX;
      const delta = Math.round(dx / cfg.px);
      setDrag((d) => (d ? { ...d, deltaDays: delta } : d));
    }
    function onUp() {
      const d = drag; setDrag(null);
      if (!d || !d.deltaDays) return;
      const row = rows.find((r) => r.node.tmp_id === d.taskTmpId);
      if (!row) return;
      const s = parseDate(row.node.start_date);
      const e = parseDate(row.node.end_date);
      if (!s || !e) return;
      let ns = s, ne = e;
      if (d.mode === 'move') { ns = new Date(s.getTime() + d.deltaDays * DAY); ne = new Date(e.getTime() + d.deltaDays * DAY); }
      if (d.mode === 'resize-l') { ns = new Date(s.getTime() + d.deltaDays * DAY); }
      if (d.mode === 'resize-r') { ne = new Date(e.getTime() + d.deltaDays * DAY); }
      if (ns > ne) return;
      onDatesChange?.(d.taskTmpId, { start_date: fmt(ns), end_date: fmt(ne) });
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [drag, cfg.px, rows, onDatesChange, readOnly]);

  function startDrag(tmpId, mode, e) {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    setDrag({ taskTmpId: tmpId, mode, startX: e.clientX, deltaDays: 0 });
  }

  // Dependency link drag
  useEffect(() => {
    if (!linkDrag || readOnly) return;
    function svgPoint(e) {
      const svg = svgRef.current;
      if (!svg) return { x: e.clientX, y: e.clientY };
      const rect = svg.getBoundingClientRect();
      return { x: e.clientX - rect.left + svg.parentElement.scrollLeft, y: e.clientY - rect.top };
    }
    function onMove(e) {
      const p = svgPoint(e);
      setLinkDrag((d) => (d ? { ...d, curX: p.x, curY: p.y } : d));
    }
    function onUp(e) {
      const p = svgPoint(e);
      const d = linkDrag; setLinkDrag(null);
      if (!d) return;
      const rowIdx = Math.floor((p.y - HEADER_H) / ROW_H);
      if (rowIdx < 0 || rowIdx >= rows.length) return;
      const target = rows[rowIdx];
      if (!target || target.node.tmp_id === d.fromTmpId) return;
      onCreateDep?.(d.fromTmpId, target.node.tmp_id);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [linkDrag, rows, onCreateDep, readOnly]);

  function startLinkDrag(fromTmpId, sx, sy, e) {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    setLinkDrag({ fromTmpId, x: sx, y: sy, curX: sx, curY: sy });
  }

  if (rows.length === 0) {
    return (
      <div className="cust-gantt cust-gantt--empty">
        <div className="cust-gantt__toolbar">
          {Object.entries(VIEWS).map(([k, v]) => (
            <button key={k} type="button"
              className={`gantt-view-toggle__btn${view === k ? ' is-active' : ''}`}
              onClick={() => setView(k)}>{v.label}</button>
          ))}
        </div>
        <div className="cust-gantt__empty">Add tasks on the left — their bars appear here.</div>
      </div>
    );
  }

  return (
    <div className="cust-gantt">
      <div className="cust-gantt__toolbar">
        <span className="form-hint" style={{ margin: 0, marginRight: 6 }}>Zoom:</span>
        {Object.entries(VIEWS).map(([k, v]) => (
          <button key={k} type="button"
            className={`gantt-view-toggle__btn${view === k ? ' is-active' : ''}`}
            onClick={() => setView(k)}>{v.label}</button>
        ))}
        <span className="form-hint" style={{ margin: 0, marginLeft: 'auto' }}>Drag bars to reschedule · drag right-edge handle to link a dependency</span>
      </div>
      {/* Mobile M4: below 900px the SVG is unreadable — render the same rows as a stacked
          list with a mini timeline bar per row. CSS toggles which one is visible. */}
      <div className="cust-gantt__compact">
        {rows.map((r, i) => {
          const range = r.isSummary ? computeSummaryRange(r.node) : { start: parseDate(r.node.start_date), end: parseDate(r.node.end_date) };
          const start = range?.start, end = range?.end;
          const windowMs = dateWindow.max.getTime() - dateWindow.min.getTime();
          const leftPct  = start ? Math.max(0, Math.min(100, ((start.getTime() - dateWindow.min.getTime()) / windowMs) * 100)) : null;
          const widthPct = (start && end) ? Math.max(1, Math.min(100 - (leftPct ?? 0), ((end.getTime() - start.getTime()) / windowMs) * 100)) : null;
          const days = (start && end) ? Math.round((end.getTime() - start.getTime()) / DAY) + 1 : null;
          return (
            <div key={r.node.tmp_id ?? i} className={`cust-gantt__compact-row${r.isSummary ? ' is-summary' : ''}${r.isMilestone ? ' is-milestone' : ''}`}>
              <div className="cust-gantt__compact-name" style={{ paddingLeft: r.depth * 10 }}>
                {r.isMilestone ? '◆ ' : r.isSummary ? 'Σ ' : '• '}{r.node.name || '(unnamed)'}
              </div>
              <div className="cust-gantt__compact-dates">
                {start ? fmt(start) : '—'} → {end ? fmt(end) : '—'}{days != null ? ` · ${days} d` : ''}
              </div>
              <div className="cust-gantt__compact-bar">
                {leftPct != null && widthPct != null && (
                  <span className={`cust-gantt__compact-bar-fill${r.isSummary ? ' is-summary' : ''}${r.isMilestone ? ' is-milestone' : ''}`}
                        style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="cust-gantt__scroll">
        <svg ref={svgRef} width={width} height={height} className="gantt-svg">
          <defs>
            <marker id="cust-gantt-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
            </marker>
          </defs>

          {/* Vertical grid + date header labels */}
          {Array.from({ length: Math.floor(totalDays / cfg.headerEvery) + 1 }).map((_, i) => {
            const x = i * cfg.headerEvery * cfg.px;
            const d = new Date(dateWindow.min.getTime() + i * cfg.headerEvery * DAY);
            return (
              <g key={`hdr-${i}`}>
                <line x1={x} y1={HEADER_H - 8} x2={x} y2={height} stroke="#e2e8f0" strokeWidth={0.8} />
                <text x={x + 4} y={HEADER_H - 14} fontSize="10" fill="#64748b" fontWeight="600">{fmtShort(d, view)}</text>
              </g>
            );
          })}
          <line x1={0} y1={HEADER_H - 6} x2={width} y2={HEADER_H - 6} stroke="#cbd5e1" />

          {/* Rows — hit target + row separators. Selection highlight. */}
          {rows.map((r, i) => {
            const y = HEADER_H + i * ROW_H;
            const sel = r.node.tmp_id === selectedTmpId;
            return (
              <g key={`row-${r.node.tmp_id}`} onClick={() => onSelect?.(r.node.tmp_id)}>
                {sel && <rect x={0} y={y} width={width} height={ROW_H} fill="#eef4fb" opacity="0.6" />}
                <line x1={0} y1={y + ROW_H} x2={width} y2={y + ROW_H} stroke="#eef2f5" />
              </g>
            );
          })}

          {/* Today marker */}
          {(() => {
            const now = new Date();
            const nx = xForDate(new Date(now.toISOString().slice(0, 10)));
            if (nx < 0 || nx > width) return null;
            return (
              <g>
                <line x1={nx} y1={HEADER_H - 6} x2={nx} y2={height} stroke="#f59e0b" strokeDasharray="3 3" strokeWidth={1} />
                <text x={nx + 3} y={HEADER_H - 2} fontSize="9" fill="#a56a00" fontWeight="600">Today</text>
              </g>
            );
          })()}

          {/* Bars + baselines per row */}
          {rows.map((r, i) => {
            const y = HEADER_H + i * ROW_H;
            const { node, depth, isSummary } = r;
            const summaryRange = isSummary ? computeSummaryRange(node) : null;
            const s = isSummary ? summaryRange?.start : parseDate(node.start_date);
            const e = isSummary ? summaryRange?.end   : parseDate(node.end_date);
            const isMilestone = node.task_type === 'milestone';

            // Baselines (session-only) for this task — thin grey stripes above the current bar.
            const rowBaselines = baselines?.get?.(node.tmp_id) ?? [];

            if (!s || !e) {
              // No dates yet — show a hint on the row.
              return (
                <g key={`bar-${node.tmp_id}`}>
                  {rowBaselines.map((bl, k) => renderBaseline(bl, y + 4 + k * 3, xForDate, cfg.px, dateWindow, k))}
                  <text x={4} y={y + ROW_H / 2 + 4} fontSize="10" fill="#94a3b8" fontStyle="italic">
                    (no dates)
                  </text>
                </g>
              );
            }

            const x = xForDate(s) + (drag?.taskTmpId === node.tmp_id && (drag.mode === 'move' || drag.mode === 'resize-l') ? drag.deltaDays * cfg.px : 0);
            const w = Math.max(2, (dayIndex(e, dateWindow.min) - dayIndex(s, dateWindow.min) + 1) * cfg.px
              + (drag?.taskTmpId === node.tmp_id && drag.mode === 'resize-r' ? drag.deltaDays * cfg.px : 0)
              + (drag?.taskTmpId === node.tmp_id && drag.mode === 'resize-l' ? -drag.deltaDays * cfg.px : 0));

            const typeFill = isSummary ? '#155685' : isMilestone ? 'transparent' : (depth > 0 ? '#7dd3c0' : 'var(--color-primary-teal, #14b8a6)');
            const typeStroke = isMilestone ? '#f59e0b' : typeFill;
            const barH = isSummary ? 6 : isMilestone ? 12 : BAR_H;
            const barY = y + (ROW_H - barH) / 2;

            const depNames = dependencies
              .filter((d) => d.task_tmp_id === node.tmp_id)
              .map((d) => rows.find((rr) => rr.node.tmp_id === d.depends_on_tmp_id)?.node?.name)
              .filter(Boolean);
            const tooltip = `${node.name || 'Untitled'}\n${fmt(s)} → ${fmt(e)}${depNames.length ? `\nDepends on: ${depNames.join(', ')}` : ''}`;

            return (
              <g key={`bar-${node.tmp_id}`}>
                {rowBaselines.map((bl, k) => renderBaseline(bl, y + 4 + k * 3, xForDate, cfg.px, dateWindow, k))}
                {isMilestone ? (
                  <g transform={`translate(${x + w / 2 - 6}, ${barY}) rotate(45 6 6)`}>
                    <rect x={0} y={0} width={12} height={12} fill="transparent" stroke={typeStroke} strokeWidth={2}
                      style={{ cursor: readOnly ? 'default' : 'grab' }}
                      onMouseDown={(e) => startDrag(node.tmp_id, 'move', e)}>
                      <title>{tooltip}</title>
                    </rect>
                  </g>
                ) : (
                  <rect
                    x={x} y={barY} width={w} height={barH} rx={isSummary ? 0 : 3}
                    fill={typeFill} stroke={typeStroke} strokeWidth={isSummary ? 0 : 1}
                    style={{ cursor: readOnly ? 'default' : 'grab' }}
                    onMouseDown={(e) => startDrag(node.tmp_id, 'move', e)}
                  >
                    <title>{tooltip}</title>
                  </rect>
                )}
                {!readOnly && !isSummary && !isMilestone && (
                  <>
                    <rect x={x - 3} y={barY} width={6} height={barH} fill="transparent"
                      style={{ cursor: 'ew-resize' }} onMouseDown={(e) => startDrag(node.tmp_id, 'resize-l', e)} />
                    <rect x={x + w - 3} y={barY} width={6} height={barH} fill="transparent"
                      style={{ cursor: 'ew-resize' }} onMouseDown={(e) => startDrag(node.tmp_id, 'resize-r', e)} />
                    <circle
                      cx={x + w + 6} cy={y + ROW_H / 2}
                      r={4} fill="#fff" stroke="#155685" strokeWidth={1.2}
                      style={{ cursor: 'crosshair' }}
                      onMouseDown={(evt) => startLinkDrag(node.tmp_id, x + w + 6, y + ROW_H / 2, evt)}
                    >
                      <title>Drag to another task to link (that task will depend on this one)</title>
                    </circle>
                  </>
                )}
              </g>
            );
          })}

          {/* Dependency arrows — clickable to delete when interactive. */}
          {dependencies.map((dep, i) => {
            const fromIdx = rows.findIndex((r) => r.node.tmp_id === dep.depends_on_tmp_id);
            const toIdx = rows.findIndex((r) => r.node.tmp_id === dep.task_tmp_id);
            if (fromIdx === -1 || toIdx === -1) return null;
            const from = rows[fromIdx].node;
            const to = rows[toIdx].node;
            const fs = parseDate(from.end_date);
            const ts = parseDate(to.start_date);
            if (!fs || !ts) return null;
            const x1 = xForDate(fs) + cfg.px;
            const y1 = HEADER_H + fromIdx * ROW_H + ROW_H / 2;
            const x2 = xForDate(ts);
            const y2 = HEADER_H + toIdx * ROW_H + ROW_H / 2;
            const midX = Math.max(x1 + 8, x2 - 8);
            const d = `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2 - 2} ${y2}`;
            return (
              <g key={`dep-${i}`} onClick={() => {
                if (readOnly) return;
                if (window.confirm(`Remove dependency: "${to.name}" depends on "${from.name}"?`)) {
                  onDeleteDep?.(dep.task_tmp_id, dep.depends_on_tmp_id);
                }
              }}>
                <path d={d} fill="none" stroke="transparent" strokeWidth="10" style={{ cursor: readOnly ? 'default' : 'pointer' }} />
                <path d={d} fill="none" stroke="#94a3b8" strokeWidth="1.5" markerEnd="url(#cust-gantt-arrow)" />
                <title>{readOnly ? `${from.name} → ${to.name}` : 'Click to delete this dependency'}</title>
              </g>
            );
          })}

          {/* In-flight link drag line */}
          {linkDrag && (
            <path d={`M ${linkDrag.x} ${linkDrag.y} L ${linkDrag.curX} ${linkDrag.curY}`}
              stroke="#155685" strokeWidth={1.5} strokeDasharray="4 4" fill="none" />
          )}
        </svg>
      </div>
    </div>
  );
}

function renderBaseline(bl, yTop, xForDate, px, dateWindow, k) {
  const bs = parseDate(bl.snapshot_start);
  const be = parseDate(bl.snapshot_end);
  if (!bs || !be) return null;
  const bx = xForDate(bs);
  const bw = Math.max(2, (dayIndex(be, dateWindow.min) - dayIndex(bs, dateWindow.min) + 1) * px);
  const when = bl.created_at ? new Date(bl.created_at).toLocaleTimeString() : '';
  return (
    <rect key={`bl-${k}`} x={bx} y={yTop} width={bw} height={2} fill="#94a3b8" opacity="0.7">
      <title>{`Baseline${when ? ` @ ${when}` : ''}: ${bl.snapshot_start} → ${bl.snapshot_end}`}</title>
    </rect>
  );
}
