import { useEffect, useMemo, useRef, useState } from 'react';
import { PHASES, walkTree } from '../services/templateStructure.js';

const DEFAULT_COL_W = 32;
const ROW_H = 34;
const HEAD_H = 30;
const BAR_H = 14;

// Shared read/write Gantt renderer.
// - Read-only: pass readOnly and omit onCreateDep / onDeleteDep.
// - Interactive (Template Builder): supply onCreateDep + onDeleteDep and the
//   right-edge drag handle + arrow click-to-delete become active.
// depthByTmp: optional Map(tmp_id -> depth) so bars can be color-coded by tree level (0=root task, 1+=subtask).
// baselines: optional Map(tmp_id -> Array<{start, end, label}>) — each entry renders as a frozen ghost bar above the current bar.
export default function GanttPanel({
  state, dependencies, schedule, selectedTmpId, hiddenTmpIds, depthByTmp, baselines,
  colWidth = DEFAULT_COL_W,
  readOnly = false, onSelect, onCreateDep, onDeleteDep,
}) {
  const COL_W = colWidth;
  const { bars, rowOrder, maxStep } = schedule;
  const nodeByTmp = useMemo(() => {
    const m = new Map();
    for (const p of PHASES) walkTree(state[p].tasks, (n) => m.set(n.tmp_id, { node: n, phase: p }));
    return m;
  }, [state]);

  const visibleOrder = useMemo(
    () => rowOrder.filter((id) => !hiddenTmpIds || !hiddenTmpIds.has(id)),
    [rowOrder, hiddenTmpIds],
  );
  const visibleRowByTmp = useMemo(() => {
    const m = new Map();
    visibleOrder.forEach((id, i) => m.set(id, i));
    return m;
  }, [visibleOrder]);

  const totalCols = Math.max(maxStep + 1, 12);
  const gridWidth = totalCols * COL_W;
  const gridHeight = visibleOrder.length * ROW_H;

  const gridRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const [hoverTarget, setHoverTarget] = useState('');

  useEffect(() => {
    if (!drag) return;
    function onMove(e) {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrag((d) => d && ({ ...d, x: e.clientX - rect.left, y: e.clientY - rect.top }));
    }
    function onUp(e) {
      const rect = gridRef.current?.getBoundingClientRect();
      const x = rect ? e.clientX - rect.left : 0;
      const y = rect ? e.clientY - rect.top : 0;
      const hit = findBarAt(bars, visibleOrder, x, y, COL_W);
      if (hit && hit !== drag.fromTmpId) onCreateDep?.(drag.fromTmpId, hit);
      setDrag(null); setHoverTarget('');
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
  }, [drag, bars, visibleOrder, onCreateDep]);

  useEffect(() => {
    if (!drag) return;
    const hit = findBarAt(bars, visibleOrder, drag.x, drag.y, COL_W);
    setHoverTarget(hit && hit !== drag.fromTmpId ? hit : '');
  }, [drag, bars, visibleOrder, COL_W]);

  const arrows = useMemo(() => {
    const out = [];
    for (const d of dependencies) {
      const src = bars.get(d.depends_on_tmp_id);
      const tgt = bars.get(d.task_tmp_id);
      if (!src || !tgt) continue;
      const srcRow = visibleRowByTmp.get(d.depends_on_tmp_id);
      const tgtRow = visibleRowByTmp.get(d.task_tmp_id);
      if (srcRow == null || tgtRow == null) continue;
      const x1 = src.end * COL_W;
      const y1 = srcRow * ROW_H + ROW_H / 2;
      const x2 = (tgt.start - 1) * COL_W;
      const y2 = tgtRow * ROW_H + ROW_H / 2;
      const midX = Math.max(x1 + 6, x2 - 6);
      out.push({ taskId: d.task_tmp_id, dependsOnId: d.depends_on_tmp_id, x1, y1, midX, y2, x2 });
    }
    return out;
  }, [dependencies, bars, visibleRowByTmp]);

  function beginWireDrag(e, fromTmpId) {
    if (readOnly) return;
    e.preventDefault(); e.stopPropagation();
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return;
    setDrag({ fromTmpId, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleArrowClick(a) {
    if (readOnly) return;
    const srcName = nodeByTmp.get(a.dependsOnId)?.node?.name || '?';
    const tgtName = nodeByTmp.get(a.taskId)?.node?.name || '?';
    if (window.confirm(`Remove dependency: "${tgtName}" depends on "${srcName}"?`)) {
      onDeleteDep?.(a.taskId, a.dependsOnId);
    }
  }

  if (rowOrder.length === 0) {
    return (
      <div className="tpl-gantt-placeholder">
        <div className="tpl-gantt-placeholder__title">No tasks yet</div>
        <div className="tpl-gantt-placeholder__body">Add a task in the left pane — its bar will appear here.</div>
      </div>
    );
  }

  return (
    <div className="gantt">
      <div className="gantt__scroll">
        <div className="gantt__header" style={{ width: gridWidth, height: HEAD_H }}>
          {Array.from({ length: totalCols }, (_, i) => (
            <div key={i} className="gantt__col-label" style={{ left: i * COL_W, width: COL_W }}>
              {i + 1}
            </div>
          ))}
        </div>
        <div ref={gridRef} className={`gantt__grid${drag ? ' gantt__grid--dragging' : ''}`} style={{ width: gridWidth, height: gridHeight }}>
          {visibleOrder.map((tmpId, r) => {
            const isSel = tmpId === selectedTmpId;
            const meta = nodeByTmp.get(tmpId);
            return (
              <div
                key={tmpId}
                className={`gantt__row${isSel ? ' gantt__row--selected' : ''}`}
                style={{ top: r * ROW_H, height: ROW_H, width: gridWidth }}
                onClick={() => meta && onSelect?.(tmpId, meta.phase)}
                title={meta?.node?.name || ''}
              />
            );
          })}
          {Array.from({ length: totalCols + 1 }, (_, i) => (
            <div key={`v${i}`} className="gantt__gridline" style={{ left: i * COL_W, height: gridHeight }} />
          ))}
          {visibleOrder.map((tmpId, r) => {
            const b = bars.get(tmpId);
            if (!b) return null;
            const left = (b.start - 1) * COL_W + 3;
            const width = (b.end - b.start + 1) * COL_W - 6;
            const top = r * ROW_H + (ROW_H - BAR_H) / 2;
            const isSel = tmpId === selectedTmpId;
            const isHoverTarget = hoverTarget === tmpId;
            const canDragFrom = !b.isSummary && !readOnly && !!onCreateDep;
            const nodeMeta = nodeByTmp.get(tmpId);
            const node = nodeMeta?.node;
            const depth = depthByTmp?.get(tmpId) ?? 0;
            const isMilestone = node?.task_type === 'milestone';
            const typeClass = b.isSummary
              ? 'gantt__bar--summary'
              : isMilestone
                ? 'gantt__bar--milestone'
                : depth > 0
                  ? 'gantt__bar--subtask'
                  : 'gantt__bar--task';
            const depNames = dependencies
              .filter((d) => d.task_tmp_id === tmpId)
              .map((d) => nodeByTmp.get(d.depends_on_tmp_id)?.node?.name)
              .filter(Boolean);
            const dateLine = (node?.start_date || node?.end_date)
              ? `${node.start_date || '—'} → ${node.end_date || '—'}`
              : `Row ${b.start}–${b.end}`;
            const tooltip = `${node?.name || 'Untitled'}\n${dateLine}${depNames.length ? `\nDepends on: ${depNames.join(', ')}` : ''}`;
            const rowBaselines = baselines?.get?.(tmpId) ?? [];
            return (
              <div key={`bar-wrap-${tmpId}`}>
                {rowBaselines.map((bl, k) => {
                  const blLeft = (bl.start - 1) * COL_W + 3;
                  const blWidth = (bl.end - bl.start + 1) * COL_W - 6;
                  return (
                    <div
                      key={`bl-${tmpId}-${k}`}
                      className="gantt__baseline"
                      style={{ left: blLeft, width: blWidth, top: top - 5, height: 3 }}
                      title={`Baseline${bl.label ? ` · ${bl.label}` : ''}: ${bl.startDate || bl.start} → ${bl.endDate || bl.end}`}
                    />
                  );
                })}
                <div
                  key={`bar-${tmpId}`}
                  className={
                    `gantt__bar ${typeClass}` +
                    `${isSel ? ' gantt__bar--selected' : ''}` +
                    `${isHoverTarget ? ' gantt__bar--drop' : ''}`
                  }
                  style={{ left, width, top, height: BAR_H }}
                  title={tooltip}
                  onClick={() => onSelect?.(tmpId, nodeMeta?.phase)}
                >
                  {canDragFrom && (
                    <span
                      className="gantt__handle"
                      title="Drag to another task to link a dependency"
                      onMouseDown={(e) => beginWireDrag(e, tmpId)}
                    />
                  )}
                </div>
              </div>
            );
          })}
          <svg className="gantt__arrows" width={gridWidth} height={gridHeight}>
            <defs>
              <marker id="ga-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#6b7d8f" />
              </marker>
            </defs>
            {arrows.map((a) => (
              <path
                key={`${a.taskId}::${a.dependsOnId}`}
                className="gantt__arrow"
                d={`M ${a.x1} ${a.y1} L ${a.midX} ${a.y1} L ${a.midX} ${a.y2} L ${a.x2} ${a.y2}`}
                stroke="#6b7d8f" strokeWidth="1.5" fill="none"
                markerEnd="url(#ga-arrow)"
                onClick={() => handleArrowClick(a)}
              >
                {!readOnly && <title>Click to delete this dependency</title>}
              </path>
            ))}
            {drag && (() => {
              const b = bars.get(drag.fromTmpId);
              if (!b) return null;
              const x1 = b.end * COL_W;
              const y1 = b.row * ROW_H + ROW_H / 2;
              return (
                <path
                  d={`M ${x1} ${y1} L ${drag.x} ${drag.y}`}
                  stroke="#155685" strokeWidth="2" fill="none"
                  strokeDasharray="4 4"
                />
              );
            })()}
          </svg>
        </div>
      </div>
    </div>
  );
}

function findBarAt(bars, visibleOrder, x, y, COL_W) {
  const rowIdx = Math.floor(y / ROW_H);
  if (rowIdx < 0 || rowIdx >= visibleOrder.length) return null;
  const tmpId = visibleOrder[rowIdx];
  const b = bars.get(tmpId);
  if (!b) return null;
  if (b.isSummary) return null;
  const left = (b.start - 1) * COL_W;
  const right = b.end * COL_W;
  if (x < left || x > right) return null;
  return tmpId;
}
