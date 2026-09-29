import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient.js';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { bumpTemplateVersion, publishTemplate } from '../../../services/projectTemplates.js';
import {
  PHASES, METRICS,
  loadStructure, saveStructure,
  sumWeights, validateStructure,
  flattenForSave, inflateFromDb,
  patchInTree, removeFromTree, findInTree,
  indentNode, outdentNode, rebalanceChildren, walkTree,
  computeSchedule,
} from '../../../services/templateStructure.js';
import GanttPanel from '../../../components/GanttPanel.jsx';
import BackButton from '../../../components/BackButton.jsx';
import { IconTrash } from '../../../components/Icons.jsx';

let tmpCounter = 1;
function newId() { return `tmp-${tmpCounter++}`; }
function makeNode({ phase }) {
  return {
    tmp_id: newId(), phase, name: '',
    is_mandatory: true, weight_pct: 0,
    progress_metric: 'done_not_done',
    quantity_value: null, quantity_unit: '',
    children: [],
  };
}

function counts(state) {
  let topLevel = 0, nested = 0;
  for (const p of PHASES) {
    for (const t of state[p].tasks) {
      topLevel += 1;
      walkTree(t.children ?? [], () => { nested += 1; });
    }
  }
  return { topLevel, nested };
}

// Compute a stable WBS label (1, 1.1, 1.1.1) and an ordinal position among LEAF work tasks
// for the "depends on" pill (leaves-only since summaries can't have deps).
function computeIndex(state) {
  const wbsByTmpId = new Map();
  const leafOrdinal = new Map();
  let ordinal = 0;
  for (const phase of PHASES) {
    function walk(nodes, prefix) {
      nodes.forEach((n, i) => {
        const wbs = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        wbsByTmpId.set(n.tmp_id, wbs);
        if (n.children?.length) walk(n.children, wbs);
        else leafOrdinal.set(n.tmp_id, ++ordinal);
      });
    }
    walk(state[phase].tasks, '');
  }
  return { wbsByTmpId, leafOrdinal };
}

function findParentAndSiblings(nodes, tmpId, parent) {
  for (const n of nodes) {
    if (n.tmp_id === tmpId) return { parent, siblings: nodes, index: nodes.indexOf(n) };
    if (n.children?.length) {
      const r = findParentAndSiblings(n.children, tmpId, n);
      if (r) return r;
    }
  }
  return null;
}

export default function BuildStructure() {
  const { templateId } = useParams();
  const [searchParams] = useSearchParams();
  const urlVersionId = searchParams.get('v') || '';
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [template, setTemplate] = useState(null);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [state, setState] = useState({
    project: { tasks: [], milestones: [] },
  });
  const [dependencies, setDependencies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [structureLoading, setStructureLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [initialHadContent, setInitialHadContent] = useState(false);

  const [selectedTmpId, setSelectedTmpId] = useState('');
  const [activePhase, setActivePhase] = useState('project');
  const [focusTmpId, setFocusTmpId] = useState('');
  const [modal, setModal] = useState(null); // null | { kind: 'deps', tmpId }
  const [collapsed, setCollapsed] = useState(() => new Set());
  function toggleCollapsed(tmpId) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(tmpId) ? next.delete(tmpId) : next.add(tmpId);
      return next;
    });
  }
  // A node is visually hidden if any of its ancestors is collapsed.
  const hiddenTmpIds = useMemo(() => {
    const hidden = new Set();
    function walk(nodes, ancestorCollapsed) {
      for (const n of nodes) {
        if (ancestorCollapsed) hidden.add(n.tmp_id);
        const nowCollapsed = ancestorCollapsed || collapsed.has(n.tmp_id);
        if (n.children?.length) walk(n.children, nowCollapsed);
      }
    }
    for (const p of PHASES) walk(state[p].tasks, false);
    return hidden;
  }, [state, collapsed]);

  const errorsRef = useRef(null);
  const rootRef = useRef(null);

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.version_no - a.version_no),
    [versions],
  );
  const latestId = sortedVersions[0]?.id ?? '';
  const version = versions.find((v) => v.id === selectedVersionId) ?? null;
  const viewingOlder = !!selectedVersionId && selectedVersionId !== latestId;
  const c = counts(state);

  const { wbsByTmpId, leafOrdinal } = useMemo(() => computeIndex(state), [state]);
  const schedule = useMemo(() => computeSchedule(state, dependencies), [state, dependencies]);
  const selectedNode = selectedTmpId ? findInTree(state.project.tasks, selectedTmpId) : null;

  function fmtName(p) {
    if (!p) return '';
    const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
    return full || p.email || '';
  }

  const loadTemplate = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setErrors([]);
    try {
      const { data: tpl, error: tErr } = await supabase
        .from('project_templates')
        .select('id, name, description, is_draft, project_types ( name ), template_versions ( id, version_no, updated_at, updated_by, updated_by_profile:profiles!template_versions_updated_by_fkey ( id, first_name, last_name, email ) )')
        .eq('id', templateId)
        .single();
      if (tErr) throw tErr;
      const vs = tpl.template_versions ?? [];
      if (vs.length === 0) throw new Error('No version found for this template.');
      const latest = [...vs].sort((a, b) => b.version_no - a.version_no)[0];
      const initial = urlVersionId && vs.some((v) => v.id === urlVersionId) ? urlVersionId : latest.id;
      setTemplate(tpl);
      setVersions(vs);
      setSelectedVersionId(initial);
    } catch (err) {
      setLoadError(err.message || 'Failed to load template.');
    } finally {
      setLoading(false);
    }
  }, [templateId, urlVersionId]);

  useEffect(() => { loadTemplate(); }, [loadTemplate]);

  const loadStructureForVersion = useCallback(async (versionId) => {
    if (!versionId) return;
    setStructureLoading(true);
    setErrors([]);
    try {
      const structure = await loadStructure(versionId);
      const inflated = inflateFromDb(structure);
      setState(inflated.state);
      setDependencies(inflated.dependencies);
      const hasContent = (structure.tasks?.length ?? 0) > 0 || (structure.milestones?.length ?? 0) > 0;
      setInitialHadContent(hasContent);
      setSelectedTmpId('');
    } catch (err) {
      toast.error(err.message || 'Failed to load version.');
    } finally {
      setStructureLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (selectedVersionId) loadStructureForVersion(selectedVersionId);
  }, [selectedVersionId, loadStructureForVersion]);

  function updatePhase(phaseKey, updater) {
    setState((prev) => ({ ...prev, [phaseKey]: updater(prev[phaseKey]) }));
  }

  function rebalAll(nodes, parentTotal) {
    const r = rebalanceChildren(parentTotal, nodes);
    return r.map((n) => (n.children?.length
      ? { ...n, children: rebalAll(n.children, Number(n.weight_pct) || 0) }
      : n));
  }

  function addRootTask(phaseKey) {
    const node = makeNode({ phase: phaseKey });
    updatePhase(phaseKey, (p) => ({ ...p, tasks: rebalAll([...p.tasks, node], 100) }));
    setSelectedTmpId(node.tmp_id);
    setActivePhase(phaseKey);
    setFocusTmpId(node.tmp_id);
  }
  function addSubtaskUnder(phaseKey, parentTmpId) {
    const node = makeNode({ phase: phaseKey });
    updatePhase(phaseKey, (p) => {
      function addUnder(nodes) {
        return nodes.map((n) => {
          if (n.tmp_id === parentTmpId) {
            const kids = [...(n.children ?? []), node];
            return { ...n, children: rebalanceChildren(Number(n.weight_pct) || 0, kids) };
          }
          if (n.children?.length) return { ...n, children: addUnder(n.children) };
          return n;
        });
      }
      return { ...p, tasks: addUnder(p.tasks) };
    });
    setSelectedTmpId(node.tmp_id);
    setFocusTmpId(node.tmp_id);
  }
  function patchInlineNode(phaseKey, tmpId, patch) {
    updatePhase(phaseKey, (p) => ({ ...p, tasks: patchInTree(p.tasks, tmpId, patch) }));
  }
  function removeRow(phaseKey, tmpId, name, hasKids) {
    if (!window.confirm(`Delete "${name || 'this row'}"${hasKids ? ' and all its children' : ''}?`)) return;
    updatePhase(phaseKey, (p) => ({ ...p, tasks: rebalAll(removeFromTree(p.tasks, tmpId), 100) }));
    setDependencies((prev) => prev.filter((d) => d.task_tmp_id !== tmpId && d.depends_on_tmp_id !== tmpId));
    if (selectedTmpId === tmpId) setSelectedTmpId('');
  }
  function removeSelected() {
    if (!selectedNode) return;
    const tmpId = selectedNode.tmp_id;
    const phaseKey = selectedNode.phase;
    if (!window.confirm(`Delete "${selectedNode.name || 'this row'}"${(selectedNode.children?.length ?? 0) > 0 ? ' and all its children' : ''}?`)) return;
    updatePhase(phaseKey, (p) => ({ ...p, tasks: rebalAll(removeFromTree(p.tasks, tmpId), 100) }));
    setDependencies((prev) => prev.filter((d) => d.task_tmp_id !== tmpId && d.depends_on_tmp_id !== tmpId));
    setSelectedTmpId('');
  }
  function indentSelected() {
    if (!selectedNode) return;
    const phaseKey = selectedNode.phase;
    updatePhase(phaseKey, (p) => {
      const res = indentNode(p.tasks, selectedNode.tmp_id);
      if (!res.changed) return p;
      return { ...p, tasks: rebalAll(res.tree, 100) };
    });
  }
  function outdentSelected() {
    if (!selectedNode) return;
    const phaseKey = selectedNode.phase;
    updatePhase(phaseKey, (p) => {
      const res = outdentNode(p.tasks, selectedNode.tmp_id);
      if (!res.changed) return p;
      return { ...p, tasks: rebalAll(res.tree, 100) };
    });
  }

  function toggleDependency(taskTmpId, dependsOnTmpId) {
    setDependencies((prev) => {
      const exists = prev.some((d) => d.task_tmp_id === taskTmpId && d.depends_on_tmp_id === dependsOnTmpId);
      if (exists) return prev.filter((d) => !(d.task_tmp_id === taskTmpId && d.depends_on_tmp_id === dependsOnTmpId));
      return [...prev, { task_tmp_id: taskTmpId, depends_on_tmp_id: dependsOnTmpId }];
    });
  }

  // mode: 'draft' → save in place, keep is_draft=true (only valid while template is a draft).
  //       'save'  → publish (flip is_draft=false) if template is a draft; else standard save
  //                 which bumps to a new version when the loaded version already has content.
  async function handleSave(mode) {
    const isDraftTemplate = !!template?.is_draft;
    const willPublish = isDraftTemplate && mode === 'save';
    const shouldBump = !isDraftTemplate && initialHadContent;

    const errs = validateStructure(state, dependencies);
    setErrors(errs);
    if (errs.length) {
      toast.error(`Please fix ${errs.length} issue${errs.length === 1 ? '' : 's'} before saving.`);
      requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (shouldBump) {
      const nextNo = (sortedVersions[0]?.version_no ?? 0) + 1;
      const proceed = window.confirm(
        `Save will create a new version — v${nextNo} — for "${template.name}".\n\n`
        + `The current v${version.version_no} will be preserved as history and remain viewable in read-only mode.\n\n`
        + `Continue?`,
      );
      if (!proceed) return;
    }
    setSaving(true);
    try {
      let targetVersionId = version.id;
      let newVersionNo = null;
      const previousVersionNo = version.version_no;
      if (shouldBump) {
        const nv = await bumpTemplateVersion(templateId, profile?.id);
        targetVersionId = nv.id;
        newVersionNo = nv.version_no;
      }
      const flat = flattenForSave(state, dependencies);
      await saveStructure(targetVersionId, templateId, flat, { updatedBy: profile?.id });
      if (willPublish) await publishTemplate(templateId);
      if (newVersionNo) toast.success(`New version v${newVersionNo} created. v${previousVersionNo} is preserved in history.`);
      else if (willPublish) toast.success(`Template "${template.name}" published.`);
      else if (mode === 'draft') toast.success('Draft saved.');
      else toast.success('Structure saved.');
      await loadTemplate();
      if (newVersionNo) setSelectedVersionId(targetVersionId);
    } catch (err) {
      toast.error(err.message || 'Failed to save structure.');
    } finally {
      setSaving(false);
    }
  }

  // Keyboard: Tab/Shift+Tab and Del operate on the selected row when focus is on the row (not inside its inline input/select).
  useEffect(() => {
    function onKey(e) {
      if (!rootRef.current || !rootRef.current.contains(document.activeElement) && document.activeElement !== document.body) return;
      if (modal || viewingOlder || !selectedNode) return;
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? outdentSelected() : indentSelected(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeSelected(); }
      else if (e.key === 'Escape') { setSelectedTmpId(''); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, viewingOlder, selectedNode]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="card">Loading template…</div>;
  if (!template) {
    return (
      <>
        <BackButton to="/masters/project-templates" label="Back to Templates" />
        <div className="card">
          {loadError ? (
            <>
              <div className="form-errors__title">Could not load this template</div>
              <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{loadError}</div>
            </>
          ) : (
            <div>Template not found.</div>
          )}
        </div>
      </>
    );
  }

  const canIndent = !!selectedNode && (() => {
    const info = findParentAndSiblings(state[selectedNode.phase].tasks, selectedNode.tmp_id, null);
    return info && info.index > 0;
  })();
  const canOutdent = !!selectedNode && (() => {
    const info = findParentAndSiblings(state[selectedNode.phase].tasks, selectedNode.tmp_id, null);
    return info && !!info.parent;
  })();
  const selIsSummary = selectedNode && (selectedNode.children?.length ?? 0) > 0;

  function renderTreeRow(node, phaseKey, depth) {
    const hasKids = (node.children?.length ?? 0) > 0;
    const isSelected = node.tmp_id === selectedTmpId;
    const isCollapsed = collapsed.has(node.tmp_id);
    const depIds = dependencies.filter((d) => d.task_tmp_id === node.tmp_id).map((d) => d.depends_on_tmp_id);
    return (
      <div key={node.tmp_id}>
        <div
          className={`ps-row${isSelected ? ' ps-row--selected' : ''}${hasKids ? ' ps-row--summary' : ''}`}
          style={{ paddingLeft: 12 + depth * 20 }}
          onClick={() => { setSelectedTmpId(node.tmp_id); setActivePhase(phaseKey); }}
        >
          <span className="ps-row__body">
            {hasKids ? (
              <button
                type="button" className="ps-row__toggle"
                onClick={(e) => { e.stopPropagation(); toggleCollapsed(node.tmp_id); }}
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                title={isCollapsed ? 'Expand children' : 'Collapse children'}
              >{isCollapsed ? '▶' : '▼'}</button>
            ) : (
              <span className="ps-row__toggle ps-row__toggle--spacer" aria-hidden="true" />
            )}
            <span className={hasKids ? 'row-marker row-marker--summary' : 'row-marker row-marker--task'} aria-hidden="true" />
            <input
              type="text"
              className="ps-row__name-input"
              value={node.name}
              placeholder="Untitled"
              disabled={viewingOlder}
              onChange={(e) => patchInlineNode(phaseKey, node.tmp_id, { name: e.target.value })}
              onClick={(e) => e.stopPropagation()}
              onFocus={() => { setSelectedTmpId(node.tmp_id); setActivePhase(phaseKey); }}
              ref={(el) => {
                if (el && focusTmpId === node.tmp_id) {
                  setFocusTmpId('');
                  requestAnimationFrame(() => { el.focus(); el.select(); });
                }
              }}
            />
            {!hasKids && (
              <select
                className="ps-row__metric-select"
                value={node.progress_metric || 'done_not_done'}
                disabled={viewingOlder}
                onChange={(e) => patchInlineNode(phaseKey, node.tmp_id, { progress_metric: e.target.value })}
                onClick={(e) => e.stopPropagation()}
                title="Progress metric"
              >
                {METRICS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            )}
            {!viewingOlder && (
              <button
                type="button"
                className="icon-btn icon-btn--danger ps-row__del"
                onClick={(e) => { e.stopPropagation(); removeRow(phaseKey, node.tmp_id, node.name, hasKids); }}
                aria-label={`Delete ${node.name || 'row'}`}
                title="Delete row"
              >
                <IconTrash />
              </button>
            )}
          </span>
          <span className="ps-row__deps">
            {depIds.length > 0 && depIds.map((did) => (
              <span key={did} className="dep-pill" title={`Depends on WBS ${wbsByTmpId.get(did) ?? '?'}`}>← {leafOrdinal.get(did) ?? '?'}</span>
            ))}
          </span>
        </div>
        {hasKids && !isCollapsed && node.children.map((c) => renderTreeRow(c, phaseKey, depth + 1))}
      </div>
    );
  }

  return (
    <div ref={rootRef}>
      <BackButton to="/masters/project-templates" label="Back to Templates" />

      <div className="tpl-hero">
        <div>
          <h2 className="tpl-hero__title">{template.name} <span className="tpl-hero__type">— {template.project_types?.name ?? 'Standard'}</span></h2>
          <div className="tpl-hero__meta">
            {c.topLevel} task{c.topLevel === 1 ? '' : 's'} · {c.nested} sub-task{c.nested === 1 ? '' : 's'} · {dependencies.length} dependenc{dependencies.length === 1 ? 'y' : 'ies'}
            {version?.updated_at && (
              <> · <span className="tpl-hero__muted">last saved {new Date(version.updated_at).toLocaleString()}{fmtName(version.updated_by_profile) && <> by {fmtName(version.updated_by_profile)}</>}</span></>
            )}
          </div>
        </div>
        <div className="tpl-hero__right">
          <label className="tpl-version">
            <span className="tpl-version__label">Version</span>
            <select
              className="tpl-version__select"
              value={selectedVersionId}
              onChange={(e) => setSelectedVersionId(e.target.value)}
              disabled={structureLoading || saving}
            >
              {sortedVersions.map((v) => (
                <option key={v.id} value={v.id}>v{v.version_no}{v.id === latestId ? ' · latest' : ''}</option>
              ))}
            </select>
          </label>
          {!viewingOlder && (
            <>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => navigate('/masters/project-templates')} disabled={saving}>Cancel</button>
              {template.is_draft && (
                <button
                  type="button" className="btn-secondary btn-secondary--sm"
                  onClick={() => handleSave('draft')} disabled={saving || structureLoading}
                  title="Save privately — template stays as a draft"
                >
                  {saving ? 'Saving…' : 'Draft'}
                </button>
              )}
              <button
                type="button" className="btn-primary btn-primary--sm"
                onClick={() => handleSave('save')} disabled={saving || structureLoading}
                title={template.is_draft ? 'Save and publish for everyone' : ''}
              >
                {saving
                  ? (template.is_draft ? 'Publishing…' : 'Saving…')
                  : template.is_draft
                    ? 'Publish'
                    : (initialHadContent ? `Publish as v${(sortedVersions[0]?.version_no ?? 0) + 1}` : 'Publish')}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="tpl-toolbar" role="toolbar" aria-label="Template actions">
        <button type="button" className="tpl-toolbar__btn" onClick={() => addRootTask(activePhase)} disabled={viewingOlder}>+ Task</button>
        <button type="button" className="tpl-toolbar__btn" onClick={() => selectedNode && addSubtaskUnder(selectedNode.phase, selectedNode.tmp_id)} disabled={viewingOlder || !selectedNode || !selectedNode.name.trim()} title={!selectedNode ? 'Select a row first' : (!selectedNode.name.trim() ? 'Name the selected row first' : '')}>+ Sub-task</button>
        <button type="button" className="tpl-toolbar__btn" onClick={outdentSelected} disabled={viewingOlder || !canOutdent}>← Outdent</button>
        <button type="button" className="tpl-toolbar__btn" onClick={indentSelected} disabled={viewingOlder || !canIndent}>→ Indent</button>
        <button type="button" className="tpl-toolbar__btn tpl-toolbar__btn--primary" onClick={() => selectedNode && setModal({ kind: 'deps', tmpId: selectedNode.tmp_id })} disabled={viewingOlder || !selectedNode || selIsSummary} title={selIsSummary ? 'Dependencies only apply to work Tasks (leaf rows)' : ''}>Link dependency</button>
      </div>

      {viewingOlder && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          You are viewing v{version.version_no} in read-only mode. Switch to v{sortedVersions[0].version_no} (latest) to edit.
        </div>
      )}

      {errors.length > 0 && (
        <div ref={errorsRef} className="form-errors" role="alert" aria-live="polite">
          <div className="form-errors__title">Please fix {errors.length} issue{errors.length === 1 ? '' : 's'} before saving:</div>
          <ul className="form-errors__list">
            {errors.map((e, i) => <li key={i}>{e.message}</li>)}
          </ul>
        </div>
      )}

      {structureLoading ? (
        <div className="card">Loading version…</div>
      ) : (
        <div className="tpl-split">
          <section className="tpl-split__pane">
            <header className="tpl-split__head">
              <span className="tpl-split__title">PROJECT STRUCTURE</span>
              <span className="tpl-split__hint">Select a row, then use the toolbar</span>
            </header>
            <div className="tpl-split__body">
              {(() => {
                const phase = state.project;
                const total = sumWeights(phase.tasks);
                const totalOk = phase.tasks.length === 0 || Math.abs(total - 100) < 0.01;
                return (
                  <div className="ps-phase">
                    <div className="ps-phase__head">
                      <span className={`ps-phase__weight${totalOk ? '' : ' is-bad'}`}>{total.toFixed(0)}%</span>
                    </div>
                    {phase.tasks.length === 0 && (
                      <div className="ps-empty">Empty — click <b>+ Task</b> to start.</div>
                    )}
                    <div className="ps-table">
                      <div className="ps-table__head">
                        <span>TASK</span>
                        <span>DEPENDS ON</span>
                      </div>
                      {phase.tasks.map((t) => renderTreeRow(t, 'project', 0))}
                    </div>
                  </div>
                );
              })()}
            </div>
          </section>

          <section className="tpl-split__pane">
            <header className="tpl-split__head">
              <span className="tpl-split__title">GANTT</span>
              <span className="tpl-split__hint">Sequence from dependencies · no dates yet</span>
            </header>
            <div className="tpl-split__body tpl-split__body--gantt">
              <GanttPanel
                state={state}
                dependencies={dependencies}
                schedule={schedule}
                selectedTmpId={selectedTmpId}
                leafOrdinal={leafOrdinal}
                hiddenTmpIds={hiddenTmpIds}
                readOnly={viewingOlder}
                onSelect={(id, phase) => { setSelectedTmpId(id); setActivePhase(phase); }}
                onCreateDep={(from, to) => {
                  // Auto-flip: the later leaf (higher ordinal) is the target that depends on the earlier one.
                  const oFrom = leafOrdinal.get(from) ?? 0;
                  const oTo = leafOrdinal.get(to) ?? 0;
                  if (oFrom === 0 || oTo === 0 || oFrom === oTo) return;
                  const [earlier, later] = oFrom < oTo ? [from, to] : [to, from];
                  setDependencies((prev) => {
                    if (prev.some((d) => d.task_tmp_id === later && d.depends_on_tmp_id === earlier)) return prev;
                    return [...prev, { task_tmp_id: later, depends_on_tmp_id: earlier }];
                  });
                }}
                onDeleteDep={(taskId, dependsOnId) => {
                  setDependencies((prev) => prev.filter((d) => !(d.task_tmp_id === taskId && d.depends_on_tmp_id === dependsOnId)));
                }}
              />
            </div>
          </section>
        </div>
      )}

      <div className="tpl-legend">
        <span><span className="legend-swatch legend-swatch--bar" /> Planned task or sub-task</span>
        <span><span className="legend-swatch legend-swatch--summary" /> Summary bar spans its children</span>
        <span><span className="legend-swatch legend-swatch--arrow" /> Dependency: finish before start</span>
        <span className="tpl-legend__muted" style={{ marginLeft: 'auto' }}>Dates, durations and resources are added when a project is created from this template.</span>
      </div>

      {modal?.kind === 'deps' && selectedNode && selectedNode.tmp_id === modal.tmpId && (
        <DepsModal
          node={selectedNode}
          state={state}
          leafOrdinal={leafOrdinal}
          wbsByTmpId={wbsByTmpId}
          selected={dependencies.filter((d) => d.task_tmp_id === selectedNode.tmp_id).map((d) => d.depends_on_tmp_id)}
          onToggle={(otherId) => toggleDependency(selectedNode.tmp_id, otherId)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}


function DepsModal({ node, state, leafOrdinal, wbsByTmpId, selected, onToggle, onClose }) {
  // Only leaf tasks in the same phase and appearing above the selected node are eligible.
  const options = useMemo(() => {
    const list = [];
    let hit = false;
    walkTree(state[node.phase].tasks, (n) => {
      if (hit) return;
      if (n.tmp_id === node.tmp_id) { hit = true; return; }
      if ((n.children?.length ?? 0) === 0) list.push(n);
    });
    return list;
  }, [state, node]);
  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3 style={{ marginTop: 0 }}>Link dependency</h3>
        <div className="form-hint" style={{ marginBottom: 8 }}>
          &ldquo;{node.name}&rdquo; will only start after the tasks you select finish.
        </div>
        {options.length === 0 ? (
          <div className="masters-users__empty" style={{ padding: 12 }}>No work tasks above this row to depend on.</div>
        ) : (
          <div className="deps-list">
            {options.map((o) => {
              const on = selected.includes(o.tmp_id);
              return (
                <label key={o.tmp_id} className={`deps-list__row${on ? ' is-on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => onToggle(o.tmp_id)} />
                  <span className="deps-list__ord">← {leafOrdinal.get(o.tmp_id)}</span>
                  <span className="deps-list__wbs">WBS {wbsByTmpId.get(o.tmp_id)}</span>
                  <span className="deps-list__name">{o.name || <em>Untitled</em>}</span>
                </label>
              );
            })}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="btn-primary btn-primary--sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

