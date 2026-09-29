import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { listProjectTemplates } from '../../services/projectTemplates.js';
import { listProjectTypes } from '../../services/projectTypes.js';
import { listCampuses } from '../../services/campuses.js';
import { listSchools } from '../../services/schools.js';
import { listLocationTagsForSchool } from '../../services/locationTags.js';
import { listRagRules } from '../../services/ragRules.js';
import { listProfiles } from '../../services/profiles.js';
import { createProject } from '../../services/projects.js';
import {
  loadStructure, inflateFromDb, PHASES, sumWeights,
  patchInTree, removeFromTree, findInTree, indentNode, outdentNode, rebalanceChildren, walkTree,
} from '../../services/templateStructure.js';
import CustomizeGantt from '../../components/CustomizeGantt.jsx';
import BackButton from '../../components/BackButton.jsx';
import RequiredMark from '../../components/RequiredMark.jsx';
import { IconPlus, IconTrash } from '../../components/Icons.jsx';
import DependencyPicker from '../../components/DependencyPicker.jsx';
import AssigneePicker from '../../components/AssigneePicker.jsx';
import MultiSelectCheckbox from '../../components/MultiSelectCheckbox.jsx';
import { getUnitNames, cachedUnitNames } from '../../services/progressUnits.js';

let __customIdCounter = 1;
function newCustomId() { return `cnew-${__customIdCounter++}`; }

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

function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

// Redistribute sibling weights so they sum to parentTotal.
// Returns { items, error } — if the requested value would leave any other sibling at 0%,
// the change is REJECTED with an error string and items are returned unchanged. No silent 1% floor.
function redistributeAfter(items, index, newValue, parentTotal) {
  const beforeCount = index;
  const afterCount = items.length - index - 1;
  const otherCount = beforeCount + afterCount;
  const requested = Math.max(0, Math.min(parentTotal, Math.round(Number(newValue) || 0)));
  const maxAllowed = parentTotal - otherCount; // must leave at least 1% for each other sibling
  if (requested < 1) {
    return { items, error: 'Weightage cannot be 0%. Every task/subtask must have at least 1%.' };
  }
  if (requested > maxAllowed) {
    return {
      items,
      error: `Cannot set ${requested}%. Max allowed is ${maxAllowed}% so the other ${otherCount} sibling${otherCount === 1 ? '' : 's'} keep at least 1% each.`,
    };
  }
  const out = items.map((it) => ({ ...it }));
  out[index] = { ...out[index], weight_pct: requested };
  const consumed = out.slice(0, index + 1).reduce((sum, it) => sum + (Number(it.weight_pct) || 0), 0);
  const remaining = Math.max(afterCount, parentTotal - consumed);
  if (afterCount > 0) {
    const base = Math.max(1, Math.floor(remaining / afterCount));
    let leftover = remaining - base * afterCount;
    for (let i = index + 1; i < out.length; i++) {
      const share = base + (leftover > 0 ? 1 : 0);
      out[i] = { ...out[i], weight_pct: share };
      if (leftover > 0) leftover -= 1;
    }
  }
  return { items: out, error: null };
}
function addDays(startIso, days) {
  if (!startIso || !Number.isFinite(Number(days))) return '';
  const d = new Date(startIso);
  d.setDate(d.getDate() + Number(days) - 1);
  return d.toISOString().slice(0, 10);
}

// Inline weight input that allows an empty value during typing (so backspace doesn't snap back to 0)
// and only pushes valid numbers back to state on input; empty defaults to 0 on blur.
function WeightInput({ value, onChange, disabled }) {
  const stateStr = String(Math.round(Number(value) || 0));
  const [focused, setFocused] = useState(false);
  const [local, setLocal] = useState(stateStr);
  const shown = focused ? local : stateStr;
  return (
    <input
      type="text"
      inputMode="numeric"
      className="tpl-input tpl-input--num cust-row__wt-input"
      value={shown}
      onFocus={() => { setLocal(stateStr); setFocused(true); }}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d]/g, '');
        setLocal(v);
        if (v === '') return;
        const n = Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 100) onChange(v);
      }}
      onBlur={() => {
        setFocused(false);
        if (local === '') onChange('0');
      }}
      disabled={disabled}
      title="Weightage % (siblings auto-adjust to keep parent total)"
      aria-label="Weightage percent"
    />
  );
}

function countStructure(state) {
  if (!state) return { tasks: 0, subs: 0, ms: 0 };
  let tasks = 0, subs = 0, ms = 0;
  for (const p of PHASES) {
    tasks += state[p].tasks.length;
    subs += state[p].tasks.reduce((n, t) => n + (t.children?.length ?? 0), 0);
    ms += state[p].milestones.length;
  }
  return { tasks, subs, ms };
}

const STEPS = [
  { key: 1, label: 'Basics' },
  { key: 2, label: 'Template' },
];

export default function ProjectNewManual() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [templates, setTemplates] = useState([]);
  const [projectTypes, setProjectTypes] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [schools, setSchools] = useState([]);
  const [ragRules, setRagRules] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [unitNames, setUnitNames] = useState(cachedUnitNames());
  const [loading, setLoading] = useState(true);
  useEffect(() => { getUnitNames().then(setUnitNames); }, []);
  const [loadError, setLoadError] = useState('');

  const [step, setStep] = useState(1);
  const [mode, setMode] = useState(''); // '' | 'template' | 'blank' — user must pick before the wizard renders
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectClass, setProjectClass] = useState('greenfield');
  const [templateId, setTemplateId] = useState('');
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [projectTypeId, setProjectTypeId] = useState('');
  const [useBlankTemplate, setUseBlankTemplate] = useState(false);
  const [campusId, setCampusId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [locationTagId, setLocationTagId] = useState('');
  const [locationTagsForSchool, setLocationTagsForSchool] = useState([]);
  const [projectManagerId, setProjectManagerId] = useState('');
  const [approverIds, setApproverIds] = useState([]);
  const [ragRuleId, setRagRuleId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [baselineDays, setBaselineDays] = useState('');
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const errorsRef = useRef(null);
  const todayIso = new Date().toISOString().slice(0, 10);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState({ state: null, dependencies: [] });
  const [previewVersionId, setPreviewVersionId] = useState('');

  const [customState, setCustomState] = useState(null);
  const [customDeps, setCustomDeps] = useState([]);
  const [customErrors, setCustomErrors] = useState([]);
  const [selectedCustTmpId, setSelectedCustTmpId] = useState('');
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [pendingReinit, setPendingReinit] = useState(false);
  const [dateMode, setDateMode] = useState('range'); // 'range' | 'duration'
  // Session-only baseline snapshots keyed by tmp_id — appended whenever a task's dates change during creation.
  // Not persisted to DB (project doesn't exist yet); once the project is created, future changes on
  // ProjectDetail/ProjectGantt write real baseline rows.
  const [sessionBaselines, setSessionBaselines] = useState(() => new Map());
  const customErrorsRef = useRef(null);
  const [splitLeftPct, setSplitLeftPct] = useState(50);
  const [splitMode, setSplitMode] = useState('both'); // 'both' | 'left' | 'right' | 'fs-left' | 'fs-right'
  const splitRef = useRef(null);
  useEffect(() => {
    if (splitMode !== 'fs-left' && splitMode !== 'fs-right') return;
    function onKey(e) { if (e.key === 'Escape') setSplitMode('both'); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [splitMode]);
  function beginSplitResize(e) {
    e.preventDefault();
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    function onMove(ev) {
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitLeftPct(Math.max(25, Math.min(75, pct)));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const [tpls, pts, cps, schs, rr, pfs] = await Promise.all([
          listProjectTemplates(),
          listProjectTypes(),
          listCampuses(),
          listSchools(),
          listRagRules(),
          listProfiles(),
        ]);
        if (cancelled) return;
        setTemplates(tpls);
        setProjectTypes(pts.filter((t) => t.is_active !== false));
        setCampuses(cps.filter((c) => c.is_active));
        setSchools(schs.filter((s) => s.is_active));
        setRagRules(rr.filter((r) => r.is_active));
        setProfiles(pfs);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load form data.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const projectManagers = useMemo(
    () => profiles.filter((p) => (p.roles ?? []).includes('project_manager') || p.role === 'project_manager'),
    [profiles],
  );

  const filteredSchools = useMemo(
    () => (campusId ? schools.filter((s) => s.campus_id === campusId) : schools),
    [schools, campusId],
  );

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === templateId) ?? null,
    [templates, templateId],
  );
  // BUG-10: empty list until a Project Type is picked — the placeholder promises "Select a Project Type first".
  const templatesForType = useMemo(
    () => (projectTypeId ? templates.filter((t) => t.project_type_id === projectTypeId) : []),
    [templates, projectTypeId],
  );
  const templateVersions = useMemo(
    () => [...(selectedTemplate?.all_versions ?? [])].sort((a, b) => a.version_no - b.version_no),
    [selectedTemplate],
  );
  const selectedVersion = useMemo(
    () => templateVersions.find((v) => v.id === templateVersionId) ?? null,
    [templateVersions, templateVersionId],
  );

  useEffect(() => {
    if (templateVersions.length > 0 && !templateVersions.some((v) => v.id === templateVersionId)) {
      const v1 = templateVersions.find((v) => v.version_no === 1) ?? templateVersions[0];
      setTemplateVersionId(v1.id);
    }
  }, [templateVersions, templateVersionId]);

  useEffect(() => {
    if (!projectManagerId && profile?.id && projectManagers.some((p) => p.id === profile.id)) {
      setProjectManagerId(profile.id);
    }
  }, [profile, projectManagers, projectManagerId]);

  // Reload location tags whenever the selected school changes.
  useEffect(() => {
    if (!schoolId) { setLocationTagsForSchool([]); return; }
    listLocationTagsForSchool(schoolId).then(setLocationTagsForSchool).catch(() => setLocationTagsForSchool([]));
  }, [schoolId]);

  useEffect(() => {
    if (!templateVersionId || previewVersionId === templateVersionId) return;
    let cancelled = false;
    setPreviewLoading(true);
    loadStructure(templateVersionId)
      .then((data) => {
        if (cancelled) return;
        setPreview(inflateFromDb(data));
        setPreviewVersionId(templateVersionId);
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err.message || 'Failed to load version content.');
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => { cancelled = true; };
  }, [templateVersionId, previewVersionId, toast]);

  // Re-initialize customize state after a confirmed version switch on step 2.
  useEffect(() => {
    if (pendingReinit && preview.state && previewVersionId === templateVersionId) {
      initializeCustomFromPreview();
      setPendingReinit(false);
    }
  }, [pendingReinit, preview.state, previewVersionId, templateVersionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewCounts = countStructure(preview.state);

  function validateBasics() {
    const errs = {};
    if (!projectClass) errs.projectClass = 'Select Greenfield or Brownfield.';
    if (!projectTypeId) errs.projectTypeId = 'Project Type is required.';
    if (mode === 'template' && !templateId) errs.templateId = 'Select a template for this Project Type.';
    if (schoolId && !campusId) errs.campusId = 'Select a campus first.';
    return errs;
  }

  function initializeCustomFromPreview() {
    if (!preview.state) return;
    const out = { pre_project: { tasks: [], milestones: [] }, project: { tasks: [], milestones: [] } };
    function shape(n) {
      return {
        ...n,
        _inherited: true,
        start_date: '',
        end_date: '',
        assigned_to_ids: [],
        quantity_value: n.quantity_value ?? null,
        quantity_unit: n.quantity_unit ?? '',
        children: (n.children ?? []).map(shape),
      };
    }
    for (const p of PHASES) {
      out[p].tasks = preview.state[p].tasks.map(shape);
      out[p].milestones = preview.state[p].milestones.map((m) => ({
        ...m,
        _inherited: true,
        target_date: '',
      }));
    }
    setCustomState(out);
    setCustomDeps([...preview.dependencies]);
    setSessionBaselines(new Map());
  }

  function rebalanceAll(nodes, parentTotal) {
    const r = rebalanceChildren(parentTotal, nodes);
    return r.map((n) => (n.children?.length
      ? { ...n, children: rebalanceAll(n.children, Number(n.weight_pct) || 0) }
      : n));
  }

  function customUpdate(phaseKey, updater) {
    setCustomState((prev) => ({ ...prev, [phaseKey]: updater(prev[phaseKey]) }));
  }
  function addCustomTask(phaseKey, task_type = 'task') {
    customUpdate(phaseKey, (p) => {
      const list = [...p.tasks, {
        tmp_id: newCustomId(), phase: phaseKey, task_type, name: '',
        is_mandatory: true, weight_pct: 0,
        progress_metric: 'done_not_done',
        quantity_value: null, quantity_unit: '',
        start_date: '', end_date: '', assigned_to_ids: [],
        children: [], _inherited: false, source_template_task_id: null,
      }];
      return { ...p, tasks: rebalanceAll(list, 100) };
    });
  }
  function addCustomChildAt(phaseKey, parentTmpId, task_type = 'task') {
    customUpdate(phaseKey, (p) => {
      function addUnder(nodes) {
        return nodes.map((n) => {
          if (n.tmp_id === parentTmpId) {
            const kid = {
              tmp_id: newCustomId(), phase: phaseKey, task_type, name: '',
              is_mandatory: true, weight_pct: 0,
              progress_metric: 'done_not_done',
              quantity_value: null, quantity_unit: '',
              start_date: '', end_date: '', assigned_to_ids: [],
              children: [], _inherited: false, source_template_task_id: null,
            };
            const kids = [...(n.children ?? []), kid];
            return { ...n, children: rebalanceChildren(Number(n.weight_pct) || 0, kids) };
          }
          if (n.children?.length) return { ...n, children: addUnder(n.children) };
          return n;
        });
      }
      return { ...p, tasks: addUnder(p.tasks) };
    });
  }
  function removeCustomAnyTask(phaseKey, tmpId) {
    customUpdate(phaseKey, (p) => ({ ...p, tasks: rebalanceAll(removeFromTree(p.tasks, tmpId), 100) }));
    setCustomDeps((prev) => prev.filter((d) => d.task_tmp_id !== tmpId && d.depends_on_tmp_id !== tmpId));
  }
  // Read-modify-write on a specific tree node via functional setState. Used by AssigneePicker
  // so the toggle always operates on the LATEST assigned_to_ids — never on a value that got
  // captured by a stale render closure (BUG-03).
  function toggleAssigneeFor(phaseKey, tmpId, userId) {
    setCustomState((prev) => {
      if (!prev) return prev;
      const phase = prev[phaseKey];
      const target = findInTree(phase.tasks, tmpId);
      if (!target) return prev;
      const cur = Array.isArray(target.assigned_to_ids) ? target.assigned_to_ids : [];
      const next = cur.includes(userId) ? cur.filter((x) => x !== userId) : [...cur, userId];
      return { ...prev, [phaseKey]: { ...phase, tasks: patchInTree(phase.tasks, tmpId, { assigned_to_ids: next }) } };
    });
  }

  function patchCustomAnyTask(phaseKey, tmpId, patch) {
    // Snapshot previous dates BEFORE mutating so the ghost bar shows the pre-change plan.
    const touchesDates = Object.prototype.hasOwnProperty.call(patch, 'start_date')
      || Object.prototype.hasOwnProperty.call(patch, 'end_date');
    if (touchesDates && customState) {
      const existing = findInTree(customState[phaseKey]?.tasks ?? [], tmpId);
      if (existing) {
        const prevStart = existing.start_date || null;
        const prevEnd = existing.end_date || null;
        const nextStart = 'start_date' in patch ? (patch.start_date || null) : prevStart;
        const nextEnd = 'end_date' in patch ? (patch.end_date || null) : prevEnd;
        const changed = (prevStart !== nextStart) || (prevEnd !== nextEnd);
        if (changed && (prevStart || prevEnd)) {
          setSessionBaselines((prev) => {
            const next = new Map(prev);
            const arr = next.get(tmpId) ? [...next.get(tmpId)] : [];
            arr.push({ snapshot_start: prevStart, snapshot_end: prevEnd, created_at: new Date().toISOString() });
            next.set(tmpId, arr);
            return next;
          });
        }
      }
    }
    customUpdate(phaseKey, (p) => ({ ...p, tasks: patchInTree(p.tasks, tmpId, patch) }));
  }
  function patchCustomAnyWeight(phaseKey, tmpId, newValue) {
    let redistErr = null;
    customUpdate(phaseKey, (p) => {
      function redistAt(nodes, parentTotal) {
        const idx = nodes.findIndex((n) => n.tmp_id === tmpId);
        if (idx >= 0) {
          const { items: redist, error } = redistributeAfter(nodes, idx, newValue, parentTotal);
          if (error) { redistErr = error; return nodes; }
          return redist.map((n, i) => (n.children?.length && Number(n.weight_pct) !== Number(nodes[i]?.weight_pct)
            ? { ...n, children: rebalanceAll(n.children, Number(n.weight_pct) || 0) }
            : n));
        }
        return nodes.map((n) => (n.children?.length
          ? { ...n, children: redistAt(n.children, Number(n.weight_pct) || 0) }
          : n));
      }
      return { ...p, tasks: redistAt(p.tasks, 100) };
    });
    if (redistErr) toast.error(redistErr);
  }
  function indentCustomTask(phaseKey, tmpId) {
    customUpdate(phaseKey, (p) => {
      const res = indentNode(p.tasks, tmpId);
      if (!res.changed) return p;
      return { ...p, tasks: rebalanceAll(res.tree, 100) };
    });
  }
  function outdentCustomTask(phaseKey, tmpId) {
    customUpdate(phaseKey, (p) => {
      const res = outdentNode(p.tasks, tmpId);
      if (!res.changed) return p;
      return { ...p, tasks: rebalanceAll(res.tree, 100) };
    });
  }
  function addCustomMilestone(phaseKey) {
    customUpdate(phaseKey, (p) => ({
      ...p,
      milestones: [...p.milestones, {
        tmp_id: newCustomId(), phase: phaseKey, name: '', target_date: '',
        _inherited: false, source_template_milestone_id: null,
      }],
    }));
  }
  function removeCustomMilestone(phaseKey, msTmpId) {
    customUpdate(phaseKey, (p) => ({ ...p, milestones: p.milestones.filter((m) => m.tmp_id !== msTmpId) }));
  }
  function patchCustomMilestone(phaseKey, msTmpId, patch) {
    customUpdate(phaseKey, (p) => ({
      ...p,
      milestones: p.milestones.map((m) => (m.tmp_id === msTmpId ? { ...m, ...patch } : m)),
    }));
  }
  function toggleCustomDep(taskTmpId, dependsOnTmpId) {
    setCustomDeps((prev) => {
      const exists = prev.some((d) => d.task_tmp_id === taskTmpId && d.depends_on_tmp_id === dependsOnTmpId);
      if (exists) return prev.filter((d) => !(d.task_tmp_id === taskTmpId && d.depends_on_tmp_id === dependsOnTmpId));
      return [...prev, { task_tmp_id: taskTmpId, depends_on_tmp_id: dependsOnTmpId }];
    });
  }

  function validateCustom() {
    const errs = [];
    // Blank flow: nothing to validate if the user hasn't started building a WBS yet.
    // If they HAVE built one, validate exactly like the template flow.
    if (!customState) return errs;
    const hasAnyContent = PHASES.some((p) =>
      (customState[p]?.tasks?.length ?? 0) > 0 || (customState[p]?.milestones?.length ?? 0) > 0);
    if (!templateId && !hasAnyContent) return errs;
    const nodeMeta = new Map(); // tmp_id -> { phase, node, ordinal (top-to-bottom leaf-position for dep-ordering) }
    let leafCounter = 0;
    for (const phaseKey of PHASES) {
      walkTree(customState[phaseKey].tasks, (n) => {
        const isSum = (n.children?.length ?? 0) > 0;
        nodeMeta.set(n.tmp_id, { phase: phaseKey, node: n, isSummary: isSum, ordinal: isSum ? -1 : leafCounter++ });
      });
    }
    for (const d of customDeps) {
      if (d.task_tmp_id === d.depends_on_tmp_id) {
        errs.push('A task cannot depend on itself.');
        continue;
      }
      const a = nodeMeta.get(d.task_tmp_id);
      const b = nodeMeta.get(d.depends_on_tmp_id);
      if (!a || !b) continue;
      if (a.phase !== b.phase) {
        errs.push(`"${a.node.name || 'Task'}" depends on "${b.node.name || 'Task'}" across phases — only same-phase deps are allowed.`);
      } else if (a.isSummary || b.isSummary) {
        errs.push(`Dependencies must link work Tasks (not Summary headings).`);
      } else if (b.ordinal >= a.ordinal) {
        errs.push(`"${a.node.name || 'Task'}" can only depend on tasks listed above it.`);
      }
    }
    for (const phaseKey of PHASES) {
      const phase = customState[phaseKey];
      const total = sumWeights(phase.tasks);
      if (phase.tasks.length > 0 && Math.abs(total - 100) > 0.01) {
        errs.push(`Tasks add up to ${total}%, must total 100%.`);
      }
      function validateNode(n, parent) {
        const isSummary = (n.children?.length ?? 0) > 0;
        const label = n.name?.trim() || (parent ? 'a subtask' : 'a task');
        if (!n.name?.trim()) errs.push(`${parent ? 'A subtask under "' + (parent.name || 'Task') + '"' : 'A task'} is missing a name.`);
        if (Number(n.weight_pct) <= 0) errs.push(`"${label}": weightage must be greater than 0%.`);
        if (n.children?.length) {
          const childTotal = sumWeights(n.children);
          if (Math.abs(childTotal - Number(n.weight_pct)) > 0.01) {
            errs.push(`Children of "${label}" add up to ${childTotal}% — must total ${n.weight_pct}%.`);
          }
        }
        if (!isSummary) {
          if (!n.start_date) errs.push(`"${label}": planned start date is required.`);
          if (!n.end_date) errs.push(`"${label}": planned end date is required.`);
          if (n.start_date && n.end_date && n.end_date < n.start_date) {
            errs.push(`"${label}": end date is before start date.`);
          }
          if (startDate && n.start_date && n.start_date < startDate) {
            errs.push(`"${label}": start date (${n.start_date}) is before the project start date (${startDate}).`);
          }
          if (endDate && n.end_date && n.end_date > endDate) {
            errs.push(`"${label}": end date (${n.end_date}) is after the project end date (${endDate}).`);
          }
          if (!Array.isArray(n.assigned_to_ids) || n.assigned_to_ids.length === 0) {
            errs.push(`"${label}": at least one assignee is required.`);
          }
          if (n.progress_metric === 'quantity' && ((n.quantity_value == null || n.quantity_value === '') || !n.quantity_unit)) {
            errs.push(`"${label}": quantity value and unit are required (metric = Quantity).`);
          }
        }
        for (const c of n.children ?? []) validateNode(c, n);
      }
      for (const t of phase.tasks) validateNode(t, null);
      for (const m of phase.milestones) {
        if (!m.name.trim()) errs.push(`A milestone is missing a name.`);
        if (startDate && m.target_date && m.target_date < startDate) {
          errs.push(`Milestone "${m.name || ''}": target date is before project start.`);
        }
        if (endDate && m.target_date && m.target_date > endDate) {
          errs.push(`Milestone "${m.name || ''}": target date is after project end.`);
        }
      }
    }
    return errs;
  }

  function flattenCustom() {
    const tasks = [];
    const milestones = [];
    function pushTree(nodes, phase, parentTmpId) {
      for (const n of nodes ?? []) {
        tasks.push({
          tmp_id: n.tmp_id, parent_tmp_id: parentTmpId, phase,
          task_type: n.task_type === 'summary' ? 'summary' : 'task',
          name: n.name, is_mandatory: n.is_mandatory ?? true, weight_pct: n.weight_pct,
          progress_metric: n.progress_metric,
          quantity_value: n.quantity_value, quantity_unit: n.quantity_unit,
          start_date: n.start_date, end_date: n.end_date,
          assigned_to_ids: Array.isArray(n.assigned_to_ids) ? n.assigned_to_ids : [],
          source_template_task_id: n._inherited ? n.id : null,
        });
        if (n.children?.length) pushTree(n.children, phase, n.tmp_id);
      }
    }
    for (const phase of PHASES) {
      pushTree(customState[phase].tasks, phase, null);
      for (const m of customState[phase].milestones) {
        milestones.push({
          tmp_id: m.tmp_id, phase, name: m.name, target_date: m.target_date,
          source_template_milestone_id: m._inherited ? m.id : null,
        });
      }
    }
    return { tasks, milestones, dependencies: customDeps };
  }


  function goNext() {
    if (step === 1) {
      const errs = validateBasics();
      setErrors(errs);
      if (Object.keys(errs).length) {
        requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
        return;
      }
      if (templateId) {
        if (!templateVersionId) { toast.error('Select a template version before continuing.'); return; }
        initializeCustomFromPreview();
      } else {
        // Blank flow — start with an empty customize state so the user can build from scratch.
        setCustomState({ pre_project: { tasks: [], milestones: [] }, project: { tasks: [], milestones: [] } });
        setCustomDeps([]);
        setSessionBaselines(new Map());
      }
    }
    const next = Math.min(step + 1, 2);
    setStep(next);
    setMaxStepReached((m) => Math.max(m, next));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Switching template versions from step 2 replaces any customize edits with the newly-loaded structure — confirm first.
  function handleVersionChange(newVersionId) {
    if (!newVersionId || newVersionId === templateVersionId) return;
    if (!window.confirm('Switching versions will replace your current edits with the selected version. Continue?')) return;
    setPendingReinit(true);
    setTemplateVersionId(newVersionId);
  }

  function goToStep(target) {
    if (target > maxStepReached) return;
    setStep(target);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function goBack() {
    setStep((s) => Math.max(s - 1, 1));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function handleSaveDraft() {
    if (!name.trim()) {
      setErrors({ ...errors, name: 'Project name is required to save a draft.' });
      setStep(2);
      requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    setSaving(true);
    try {
      // Preserve the WBS the user has built in step 2 even for drafts — otherwise saving as a draft
      // silently discards every task, date, dependency, and assignee (BUG-01).
      // Save any WBS the user built in step 2 — works for both template AND blank flows.
      const hasAny = step === 2 && customState && PHASES.some((p) =>
        (customState[p]?.tasks?.length ?? 0) > 0 || (customState[p]?.milestones?.length ?? 0) > 0);
      const custom = hasAny ? flattenCustom() : null;
      await createProject({
        name, description, projectClass,
        templateId: templateId || null, templateVersionId: templateVersionId || null,
        projectTypeId: projectTypeId || null,
        campusId: campusId || null, schoolId: schoolId || null, locationTagId: locationTagId || null,
        projectManagerId: projectManagerId || null, ragRuleId: ragRuleId || null,
        startDate: startDate || null, endDate: endDate || null,
        baselineDays: baselineDays !== '' ? Number(baselineDays) : null,
        createdBy: profile?.id,
        customStructure: custom,
        approverIds,
        isDraft: true,
      });
      toast.success(`Draft "${name.trim()}" saved with ${custom ? `${custom.tasks.length} task${custom.tasks.length === 1 ? '' : 's'}` : 'basics'}. Continue anytime from the Projects list.`);
      navigate('/projects');
    } catch (err) { toast.error(err.message || 'Failed to save draft.'); }
    finally { setSaving(false); }
  }

  function handleCancel() {
    if (name.trim() || description.trim() || templateId || useBlankTemplate) {
      if (!window.confirm('Cancel this project? Any unsaved information will be discarded.')) return;
    }
    navigate('/projects');
  }

  async function handleCreate() {
    const basicsErrs = validateBasics();
    setErrors(basicsErrs);
    if (Object.keys(basicsErrs).length) {
      setStep(1);
      requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    if (!name.trim()) {
      setErrors({ ...basicsErrs, name: 'Project name is required.' });
      setStep(2);
      requestAnimationFrame(() => errorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    const custErrs = validateCustom();
    setCustomErrors(custErrs);
    if (custErrs.length) {
      requestAnimationFrame(() => customErrorsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      return;
    }
    setSaving(true);
    try {
      // Persist WBS built in step 2, whether the user picked a template or started blank.
      // Blank flow used to discard the whole tree on Save — now it saves anything the user built.
      const hasAny = customState && PHASES.some((p) =>
        (customState[p]?.tasks?.length ?? 0) > 0 || (customState[p]?.milestones?.length ?? 0) > 0);
      const custom = hasAny ? flattenCustom() : null;
      const project = await createProject({
        name,
        description,
        projectClass,
        templateId: templateId || null,
        templateVersionId: templateVersionId || null,
        projectTypeId: projectTypeId || null,
        campusId: campusId || null,
        schoolId: schoolId || null,
        locationTagId: locationTagId || null,
        projectManagerId: projectManagerId || null,
        ragRuleId: ragRuleId || null,
        startDate: startDate || null,
        endDate: endDate || null,
        baselineDays: baselineDays !== '' ? Number(baselineDays) : null,
        createdBy: profile?.id,
        customStructure: custom,
        approverIds,
      });
      toast.success(`Project "${name.trim()}" created.`);
      navigate(`/projects/${project.id}`);
    } catch (err) {
      toast.error(err.message || 'Failed to create project.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="card">Loading…</div>;
  if (loadError) return <div className="card">{loadError}</div>;

  return (
    <>
      <BackButton to="/projects" label="Back to Projects" />
      <h2 className="page-title">Create Project</h2>

      {!mode && (
        <div className="mode-chooser">
          <div className="form-hint" style={{ marginBottom: 12 }}>
            How would you like to start? You can switch mode later by cancelling and coming back.
          </div>
          <div className="mode-chooser__grid">
            <button
              type="button"
              className="mode-chooser__card"
              onClick={() => { setMode('template'); setUseBlankTemplate(false); }}
            >
              <div className="mode-chooser__title">Use a Template</div>
              <div className="mode-chooser__desc">
                Start from a published Project Template. Pick a <b>Project Type</b>, then the <b>Template</b> that matches.
                Tasks, subtasks and milestones are inflated automatically from the template — you can then adjust before saving.
              </div>
            </button>
            <button
              type="button"
              className="mode-chooser__card"
              onClick={() => { setMode('blank'); setUseBlankTemplate(true); setTemplateId(''); setTemplateVersionId(''); }}
            >
              <div className="mode-chooser__title">Blank Template</div>
              <div className="mode-chooser__desc">
                Start with an empty structure. Pick a <b>Project Type</b>, fill in the basics, then build the tasks / subtasks / milestones
                yourself on the Project Detail page after saving.
              </div>
            </button>
          </div>
        </div>
      )}

      {mode && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '4px 0 12px' }}>
          <span className="mode-chooser__pill">{mode === 'template' ? 'Template mode' : 'Blank template mode'}</span>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => { setMode(''); setUseBlankTemplate(false); setTemplateId(''); setTemplateVersionId(''); setStep(1); }}>
            Change mode
          </button>
        </div>
      )}

      {mode && (
      <>
      <ol className="wizard-steps" aria-label="Wizard steps">
        {STEPS.map((s) => {
          const clickable = s.key <= maxStepReached;
          const classes = [
            'wizard-steps__item',
            step === s.key ? 'is-current' : '',
            step > s.key ? 'is-done' : '',
            clickable ? 'is-clickable' : 'is-locked',
          ].filter(Boolean).join(' ');
          return (
            <li
              key={s.key}
              className={classes}
              onClick={() => clickable && goToStep(s.key)}
              role={clickable ? 'button' : undefined}
              tabIndex={clickable ? 0 : -1}
              onKeyDown={(e) => { if (clickable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); goToStep(s.key); } }}
              title={clickable ? `Go to ${s.label}` : `Complete previous steps first`}
              aria-disabled={!clickable}
            >
              <span className="wizard-steps__num">{s.key}</span>
              <span className="wizard-steps__label">{s.label}</span>
            </li>
          );
        })}
      </ol>

      {step === 1 && Object.values(errors).some(Boolean) && (
        <div ref={errorsRef} className="form-errors" role="alert" aria-live="polite">
          <div className="form-errors__title">Please fix the highlighted fields:</div>
          <ul className="form-errors__list">
            {Object.entries(errors).filter(([, v]) => v).map(([k, v]) => (<li key={k}>{v}</li>))}
          </ul>
        </div>
      )}

      {step === 1 && (
        <div className="card project-new-form">
          <div className="project-new-form__grid">
            <label className={`login-field${errors.projectTypeId ? ' login-field--invalid' : ''}`}>
              <span>Project Type<RequiredMark /></span>
              <select
                value={projectTypeId}
                onChange={(e) => {
                  const v = e.target.value;
                  setProjectTypeId(v);
                  if (templateId && !templates.find((t) => t.id === templateId && t.project_type_id === v)) {
                    setTemplateId('');
                    setTemplateVersionId('');
                  }
                  if (errors.projectTypeId) setErrors({ ...errors, projectTypeId: undefined });
                }}
                autoFocus
              >
                <option value="">Select project type…</option>
                {projectTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {errors.projectTypeId && <span className="form-error-inline">{errors.projectTypeId}</span>}
            </label>

            {mode === 'template' && (
              <label className={`login-field${errors.templateId ? ' login-field--invalid' : ''}`}>
                <span>Project Template<RequiredMark /></span>
                <select
                  value={templateId}
                  onChange={(e) => {
                    setTemplateId(e.target.value);
                    setTemplateVersionId('');
                    if (errors.templateId) setErrors({ ...errors, templateId: undefined });
                  }}
                  disabled={!projectTypeId}
                >
                  <option value="">
                    {!projectTypeId
                      ? 'Select a Project Type first…'
                      : templatesForType.length === 0
                        ? 'No templates for this Project Type'
                        : 'Select template…'}
                  </option>
                  {templatesForType.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                {errors.templateId && <span className="form-error-inline">{errors.templateId}</span>}
              </label>
            )}

            <label className={`login-field${errors.campusId ? ' login-field--invalid' : ''}`}>
              <span>Campus</span>
              <select
                value={campusId}
                onChange={(e) => {
                  setCampusId(e.target.value);
                  setSchoolId('');
                  if (errors.campusId) setErrors({ ...errors, campusId: undefined });
                }}
              >
                <option value="">—</option>
                {campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {errors.campusId && <span className="form-error-inline">{errors.campusId}</span>}
            </label>

            <label className="login-field">
              <span>School</span>
              <select
                value={schoolId}
                onChange={(e) => { setSchoolId(e.target.value); setLocationTagId(''); }}
                disabled={!campusId}
              >
                <option value="">—</option>
                {filteredSchools.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>

            <label className="login-field">
              <span>Location Tag (optional)</span>
              <select
                value={locationTagId}
                onChange={(e) => setLocationTagId(e.target.value)}
                disabled={!schoolId || locationTagsForSchool.length === 0}
              >
                <option value="">{!schoolId ? 'Pick a school first' : locationTagsForSchool.length === 0 ? 'No tags for this school' : '—'}</option>
                {locationTagsForSchool.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>

            <label className="login-field" style={{ gridColumn: '1 / -1' }}>
              <span>Approval Authority (multi-select)</span>
              <MultiSelectCheckbox
                options={profiles.map((p) => ({
                  id: p.id,
                  label: `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email,
                  hint: p.email,
                }))}
                selected={approverIds}
                onChange={setApproverIds}
                placeholder="Select approval authority…"
                emptyText="No users available."
              />
              <span className="form-hint" style={{ marginTop: 4 }}>
                Any one of the selected users can approve hold / cancel / baseline change requests for this project. All selected users get In-app + Email notifications when a request is raised.
              </span>
            </label>
          </div>

          <fieldset className="project-new-form__group">
            <legend>Project Class<RequiredMark /></legend>
            <div className="radio-row">
              <label className="radio-tile">
                <input
                  type="radio"
                  name="projectClass"
                  value="greenfield"
                  checked={projectClass === 'greenfield'}
                  onChange={(e) => setProjectClass(e.target.value)}
                />
                <div>
                  <div className="radio-tile__title">Greenfield</div>
                  <div className="radio-tile__desc">A brand-new build with no existing site or structure to work around.</div>
                </div>
              </label>
              <label className="radio-tile">
                <input
                  type="radio"
                  name="projectClass"
                  value="brownfield"
                  checked={projectClass === 'brownfield'}
                  onChange={(e) => setProjectClass(e.target.value)}
                />
                <div>
                  <div className="radio-tile__title">Brownfield</div>
                  <div className="radio-tile__desc">Renovation, upgrade or modification of an existing structure.</div>
                </div>
              </label>
            </div>
            {errors.projectClass && <span className="form-error-inline">{errors.projectClass}</span>}
          </fieldset>

          <label className="login-field">
            <span>Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Optional short description of the project."
            />
          </label>

          <div className="project-new-form__actions" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn-secondary" onClick={handleCancel}>Cancel</button>
            <button type="button" className="btn-primary btn-primary--sm" onClick={goNext}>Next</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <>
          <datalist id="cust-units">
            {unitNames.map((u) => <option key={u} value={u} />)}
          </datalist>

          <div className="card wizard-top-actions">
            <div className="project-new-form__actions" style={{ borderTop: 'none', paddingTop: 0, gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button type="button" className="btn-secondary" onClick={goBack}>Back</button>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleCancel} disabled={saving}>Cancel</button>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
              <button type="button" className="btn-primary btn-primary--sm" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating…' : 'Save & Create Project'}
              </button>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <label className={`login-field${errors.name ? ' login-field--invalid' : ''}`}>
                  <span>Project Name<RequiredMark /></span>
                  <input
                    type="text"
                    value={name}
                    placeholder={selectedTemplate ? `e.g. ${selectedTemplate.name} — Wing A` : 'Enter project name'}
                    onChange={(e) => { setName(e.target.value); if (errors.name) setErrors({ ...errors, name: undefined }); }}
                    maxLength={140}
                    autoFocus
                  />
                  {errors.name && <span className="form-error-inline">{errors.name}</span>}
                </label>
                <div className="form-hint" style={{ marginTop: 6 }}>
                  {previewLoading
                    ? 'Loading version content…'
                    : templateId ? (
                      <>
                        Based on template <b>{selectedTemplate?.name ?? '—'}</b> · {previewCounts.tasks} task{previewCounts.tasks === 1 ? '' : 's'} · {previewCounts.subs} sub-task{previewCounts.subs === 1 ? '' : 's'} · {previewCounts.ms} milestone{previewCounts.ms === 1 ? '' : 's'} · {preview.dependencies?.length ?? 0} dependenc{(preview.dependencies?.length ?? 0) === 1 ? 'y' : 'ies'}
                        {previewCounts.tasks === 0 && previewCounts.subs === 0 && previewCounts.ms === 0 && (
                          <div style={{ marginTop: 6, padding: 6, background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4, color: '#422006' }}>
                            ⚠ This template is empty — nothing was inflated. You&apos;ll need to add tasks/milestones yourself, or pick a different template.
                          </div>
                        )}
                      </>
                    ) : 'Blank template — build the structure from scratch below.'}
                </div>
              </div>
              {templateId && templateVersions.length > 1 && (
                <label className="tpl-version">
                  <span className="tpl-version__label">Compare version</span>
                  <select
                    className="tpl-version__select"
                    value={templateVersionId}
                    onChange={(e) => handleVersionChange(e.target.value)}
                    disabled={previewLoading || pendingReinit}
                    title="Switch versions to compare — replaces your current edits"
                  >
                    {templateVersions.map((v) => (
                      <option key={v.id} value={v.id}>
                        v{v.version_no}{v.version_no === 1 ? ' · default' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>

          {customErrors.length > 0 && (
            <div ref={customErrorsRef} className="form-errors" role="alert" aria-live="polite">
              <div className="form-errors__title">Please fix {customErrors.length} issue{customErrors.length === 1 ? '' : 's'} before creating:</div>
              <ul className="form-errors__list">
                {customErrors.map((msg, i) => <li key={i}>{msg}</li>)}
              </ul>
            </div>
          )}

          {(previewLoading || pendingReinit || !customState) ? (
            <div className="card">Loading template content…</div>
          ) : (
          <>
          <div className="card">
            <div className="form-hint">
              Customize the template for this project. You can add or remove tasks, subtasks and milestones, set dates and assignees, and enter quantities. Names of items brought in from the template are locked.
            </div>
          </div>

          <div className="card" style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="form-hint" style={{ margin: 0 }}><b>Date input mode:</b></span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" name="dateMode" value="range" checked={dateMode === 'range'} onChange={() => setDateMode('range')} />
              Start + End
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="radio" name="dateMode" value="duration" checked={dateMode === 'duration'} onChange={() => setDateMode('duration')} />
              Start + Duration (End auto-calculated)
            </label>
          </div>

          {(() => {
            let sel = null;
            let selPhase = 'project';
            for (const ph of PHASES) {
              const found = findInTree(customState[ph]?.tasks ?? [], selectedCustTmpId);
              if (found) { sel = found; selPhase = ph; break; }
            }
            const info = sel ? findParentAndSiblings(customState[selPhase].tasks, sel.tmp_id, null) : null;
            const canIndent = !!info && info.index > 0;
            const canOutdent = !!info && !!info.parent;
            const isSummary = sel ? (sel.children?.length ?? 0) > 0 : false;
            return (
              <div className="tpl-toolbar" role="toolbar" aria-label="Structure actions" style={{ marginTop: 12 }}>
                <button type="button" className="tpl-toolbar__btn" onClick={() => addCustomTask(selPhase, 'task')}>+ Task</button>
                <button type="button" className="tpl-toolbar__btn"
                  onClick={() => sel && addCustomChildAt(selPhase, sel.tmp_id, 'task')}
                  disabled={!sel || !sel.name?.trim()}
                  title={!sel ? 'Select a row first' : (!sel.name?.trim() ? 'Name the selected row first' : '')}>
                  + Sub-task
                </button>
                <button type="button" className="tpl-toolbar__btn"
                  onClick={() => sel && outdentCustomTask(selPhase, sel.tmp_id)}
                  disabled={!sel || !canOutdent}>← Outdent</button>
                <button type="button" className="tpl-toolbar__btn"
                  onClick={() => sel && indentCustomTask(selPhase, sel.tmp_id)}
                  disabled={!sel || !canIndent}>→ Indent</button>
                <button type="button" className="tpl-toolbar__btn"
                  onClick={() => sel && addCustomMilestone(selPhase)}>+ Milestone</button>
                <button type="button" className="tpl-toolbar__btn tpl-toolbar__btn--danger"
                  onClick={() => sel && removeCustomAnyTask(selPhase, sel.tmp_id)}
                  disabled={!sel}>Delete</button>
                <span className="form-hint" style={{ marginLeft: 'auto', margin: 0 }}>
                  {sel ? <>Selected: <b>{sel.name || 'Untitled'}</b>{isSummary ? ' (summary — deps disabled)' : ''}</> : 'Click a row to select it — then use the toolbar. Same actions available inline per row.'}
                </span>
              </div>
            );
          })()}

          <div className="split-toolbar" role="toolbar" aria-label="Structure and Gantt view controls">
            <span className="split-toolbar__label">View:</span>
            <button type="button" className={`split-btn${splitMode === 'left' ? ' is-active' : ''}`} title="Show only Project Structure" onClick={() => setSplitMode('left')}>◧ Structure</button>
            <button type="button" className={`split-btn${splitMode === 'both' ? ' is-active' : ''}`} title="Show both panes (50/50)" onClick={() => { setSplitMode('both'); setSplitLeftPct(50); }}>▣ Both</button>
            <button type="button" className={`split-btn${splitMode === 'right' ? ' is-active' : ''}`} title="Show only Gantt Chart" onClick={() => setSplitMode('right')}>◨ Gantt</button>
            <span className="split-toolbar__sep" aria-hidden="true">|</span>
            <button type="button" className={`split-btn${splitMode === 'fs-left' ? ' is-active' : ''}`} title={splitMode === 'fs-left' ? 'Exit full screen' : 'Full screen Project Structure'} onClick={() => setSplitMode(splitMode === 'fs-left' ? 'both' : 'fs-left')}>{splitMode === 'fs-left' ? '↙ Exit FS' : '⤢ FS Structure'}</button>
            <button type="button" className={`split-btn${splitMode === 'fs-right' ? ' is-active' : ''}`} title={splitMode === 'fs-right' ? 'Exit full screen' : 'Full screen Gantt'} onClick={() => setSplitMode(splitMode === 'fs-right' ? 'both' : 'fs-right')}>{splitMode === 'fs-right' ? '↙ Exit FS' : '⤢ FS Gantt'}</button>
            {splitMode === 'both' && <span className="split-toolbar__hint" title="Drag the divider between the panes to resize">↔ Drag divider to resize</span>}
          </div>
          <div
            ref={splitRef}
            className={`customize-split customize-split--resizable customize-split--${splitMode}`}
            style={{ gridTemplateColumns:
              splitMode === 'left' || splitMode === 'fs-left' ? '1fr 8px 0'
              : splitMode === 'right' || splitMode === 'fs-right' ? '0 8px 1fr'
              : `${splitLeftPct}% 8px 1fr` }}
          >
            {(splitMode === 'fs-left' || splitMode === 'fs-right') && (
              <button
                type="button"
                className="split-fs-exit"
                title="Exit full screen (Esc)"
                onClick={() => setSplitMode('both')}
              >↙ Exit full screen</button>
            )}
            <div
              className="customize-split__left"
              style={(splitMode === 'right' || splitMode === 'fs-right') ? { display: 'none' } : {}}
            >
          {PHASES.map((phaseKey) => {
            const phase = customState[phaseKey];
            const total = sumWeights(phase.tasks);
            const totalOk = phase.tasks.length === 0 || Math.abs(total - 100) < 0.01;
            // Ordered list of leaf-Tasks for DependencyPicker "above" scoping (skips summaries).
            const leafOrder = [];
            walkTree(phase.tasks, (n) => { if (n.task_type !== 'summary') leafOrder.push(n); });
            function leavesAbove(tmpId) {
              const idx = leafOrder.findIndex((n) => n.tmp_id === tmpId);
              return idx > 0 ? leafOrder.slice(0, idx) : [];
            }
            function renderCustomRow(node, wbs, depth, siblingIndex) {
              const isSummary = (node.children?.length ?? 0) > 0;
              const canIndent = siblingIndex > 0;
              const canOutdent = depth > 0;
              const dur = daysBetween(node.start_date, node.end_date);
              const selectedDeps = customDeps.filter((d) => d.task_tmp_id === node.tmp_id).map((d) => d.depends_on_tmp_id);
              const above = leavesAbove(node.tmp_id);
              return (
                <React.Fragment key={node.tmp_id}>
                  <div
                    className={`cust-row${depth === 0 ? ' cust-row--bold' : ' cust-row--sub'}${isSummary ? ' cust-row--summary' : ''}${selectedCustTmpId === node.tmp_id ? ' is-selected' : ''}`}
                    onClick={() => setSelectedCustTmpId(node.tmp_id)}>
                    <span className="cust-row__no"><span className="cust-row__no-pill" />{wbs}</span>
                    <div className="cust-row__name-wrap" style={{ paddingLeft: depth * 16 }}>
                      <span className={isSummary ? 'row-marker row-marker--summary' : 'row-marker row-marker--task'} aria-hidden="true" />
                      <input
                        type="text"
                        className="tpl-input"
                        value={node.name}
                        readOnly={node._inherited}
                        onChange={(e) => patchCustomAnyTask(phaseKey, node.tmp_id, { name: e.target.value })}
                        placeholder={node._inherited ? 'Template row (locked)' : (isSummary ? 'Summary heading' : 'Task name')}
                        title={node._inherited ? 'Names of template rows cannot be edited.' : ''}
                      />
                    </div>
                    <div className="cust-row__wt-cell">
                      <WeightInput
                        value={node.weight_pct}
                        disabled={false}
                        onChange={(v) => patchCustomAnyWeight(phaseKey, node.tmp_id, v)}
                      />
                      <span className="tpl-input__suffix">%</span>
                    </div>
                    {isSummary ? (
                      <>
                        <div /><div /><div /><div /><div /><div />
                      </>
                    ) : (
                      <>
                        <input
                          type="date" className="tpl-input"
                          value={node.start_date || ''}
                          onChange={(e) => patchCustomAnyTask(phaseKey, node.tmp_id, { start_date: e.target.value })}
                          min={startDate || undefined} max={endDate || undefined}
                        />
                        <input
                          type="date" className="tpl-input"
                          value={node.end_date || ''}
                          onChange={(e) => patchCustomAnyTask(phaseKey, node.tmp_id, { end_date: e.target.value })}
                          min={node.start_date || startDate || undefined} max={endDate || undefined}
                          disabled={dateMode === 'duration'}
                          title={dateMode === 'duration' ? 'Auto-calculated from Start + Duration' : 'End date'}
                          style={dateMode === 'duration' ? { background: '#f5f7fa', color: '#6b7d8f' } : undefined}
                        />
                        <input
                          type="number" className="tpl-input tpl-input--num"
                          value={dur ?? ''}
                          onChange={(e) => {
                            const d = Number(e.target.value);
                            if (node.start_date && Number.isFinite(d) && d > 0) {
                              patchCustomAnyTask(phaseKey, node.tmp_id, { end_date: addDays(node.start_date, d) });
                            }
                          }}
                          min={1}
                          disabled={dateMode === 'range'}
                          title={dateMode === 'range' ? 'Auto-calculated from Start → End' : 'Duration in days'}
                          style={dateMode === 'range' ? { background: '#f5f7fa', color: '#6b7d8f' } : undefined}
                        />
                        <div>
                          {above.length > 0
                            ? <DependencyPicker aboveTasks={above} selected={selectedDeps} onToggle={(otherId) => toggleCustomDep(node.tmp_id, otherId)} />
                            : <span className="tpl-deps-empty">—</span>}
                        </div>
                        <div>
                          <AssigneePicker
                            profiles={profiles}
                            selected={Array.isArray(node.assigned_to_ids) ? node.assigned_to_ids : []}
                            onToggle={(id) => toggleAssigneeFor(phaseKey, node.tmp_id, id)}
                          />
                        </div>
                        <div className="cust-row__metric-cell">
                          <select
                            className="tpl-select"
                            value={node.progress_metric}
                            onChange={(e) => patchCustomAnyTask(phaseKey, node.tmp_id, { progress_metric: e.target.value })}
                            title="Progress Metric"
                          >
                            <option value="done_not_done">Done / Not-done</option>
                            <option value="percent">% Based</option>
                            <option value="quantity">Quantity</option>
                          </select>
                          {node.progress_metric === 'quantity' && (
                            <>
                              <input
                                type="number" className="tpl-input cust-row__qty-inline"
                                value={node.quantity_value ?? ''}
                                onChange={(e) => patchCustomAnyTask(phaseKey, node.tmp_id, { quantity_value: e.target.value === '' ? null : Number(e.target.value) })}
                                placeholder="Qty" min={0}
                              />
                              <input
                                type="text" className="tpl-input cust-row__unit-inline" list="cust-units"
                                value={node.quantity_unit ?? ''}
                                onChange={(e) => patchCustomAnyTask(phaseKey, node.tmp_id, { quantity_unit: e.target.value })}
                                placeholder="unit" maxLength={20}
                              />
                            </>
                          )}
                        </div>
                      </>
                    )}
                    <div className="cust-row__act">
                      <button type="button" className="icon-btn" onClick={() => outdentCustomTask(phaseKey, node.tmp_id)} disabled={!canOutdent} title="Outdent" aria-label="Outdent">◀</button>
                      <button type="button" className="icon-btn" onClick={() => indentCustomTask(phaseKey, node.tmp_id)} disabled={!canIndent} title="Indent" aria-label="Indent">▶</button>
                      <button type="button" className="icon-btn" onClick={() => addCustomChildAt(phaseKey, node.tmp_id, 'task')} disabled={!node.name.trim()} title="Add child" aria-label="Add child">
                        <IconPlus />
                      </button>
                      <button type="button" className="icon-btn icon-btn--danger" onClick={() => removeCustomAnyTask(phaseKey, node.tmp_id)} title="Remove" aria-label="Remove">
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                  {node.children?.length > 0 && node.children.map((c, ci) => renderCustomRow(c, `${wbs}.${ci + 1}`, depth + 1, ci))}
                </React.Fragment>
              );
            }
            return (
              <section key={phaseKey} className="tpl-section">
                <header className="tpl-section__head">
                  <div>
                    <div className={`tpl-section__weight${totalOk ? '' : ' is-bad'}`}>
                      {total.toFixed(2)}% of 100 {totalOk ? '' : '(off)'}
                    </div>
                  </div>
                  <div className="tpl-section__actions">
                    <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => addCustomTask(phaseKey, 'task')}>
                      <IconPlus /> Task
                    </button>
                    <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => addCustomMilestone(phaseKey)}>
                      <IconPlus /> Milestone
                    </button>
                  </div>
                </header>

                {phase.tasks.length === 0 && phase.milestones.length === 0 && (
                  <div className="tpl-section__empty">Nothing here yet. Add a task or milestone above.</div>
                )}

                {phase.tasks.length > 0 && (
                  <div className="cust-table">
                    <div className="cust-row cust-row--head">
                      <div>WBS</div>
                      <div>Task</div>
                      <div>Weightage</div>
                      <div>Start</div>
                      <div>End</div>
                      <div>Days</div>
                      <div>Depends On</div>
                      <div>Assignee</div>
                      <div>Progress Metric</div>
                      <div />
                    </div>
                    {phase.tasks.map((t, i) => renderCustomRow(t, `${i + 1}`, 0, i))}
                  </div>
                )}

                {phase.milestones.length > 0 && (
                  <div className="tpl-milestones">
                    <div className="tpl-milestones__label">Milestones</div>
                    {phase.milestones.map((m, i) => (
                      <div key={m.tmp_id} className="tpl-milestones__row">
                        <span className="tpl-milestones__no">M{i + 1}</span>
                        <input
                          type="text"
                          className="tpl-input"
                          value={m.name}
                          readOnly={m._inherited}
                          onChange={(e) => patchCustomMilestone(phaseKey, m.tmp_id, { name: e.target.value })}
                          placeholder={m._inherited ? 'Template milestone (locked)' : 'New milestone name'}
                        />
                        <input
                          type="date"
                          className="tpl-input"
                          value={m.target_date || ''}
                          onChange={(e) => patchCustomMilestone(phaseKey, m.tmp_id, { target_date: e.target.value })}
                          min={startDate || undefined}
                          max={endDate || undefined}
                          style={{ width: 160 }}
                          title="Target date"
                        />
                        <button type="button" className="icon-btn icon-btn--danger" onClick={() => removeCustomMilestone(phaseKey, m.tmp_id)} aria-label="Remove milestone">
                          <IconTrash />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
            </div>
            <div
              className="customize-split__divider"
              role="separator"
              aria-orientation="vertical"
              aria-label="Drag to resize task list and Gantt panels"
              onMouseDown={beginSplitResize}
              title="Drag to resize"
            />
            <div
              className="customize-split__right"
              style={(splitMode === 'left' || splitMode === 'fs-left') ? { display: 'none' } : {}}
            >
              <CustomizeGantt
                state={customState}
                dependencies={customDeps}
                baselines={sessionBaselines}
                projectStart={startDate}
                projectEnd={endDate}
                selectedTmpId={''}
                onDatesChange={(tmpId, patch) => patchCustomAnyTask('project', tmpId, patch)}
                onCreateDep={(fromTmpId, toTmpId) => {
                  // Wire drag creates a dep where 'toTmpId' depends on 'fromTmpId'. Reuse the same
                  // "above-only" rule the list uses: caller ensures target is below source.
                  if (fromTmpId === toTmpId) return;
                  setCustomDeps((prev) => {
                    if (prev.some((d) => d.task_tmp_id === toTmpId && d.depends_on_tmp_id === fromTmpId)) return prev;
                    return [...prev, { task_tmp_id: toTmpId, depends_on_tmp_id: fromTmpId }];
                  });
                }}
                onDeleteDep={(taskTmpId, dependsOnTmpId) => {
                  setCustomDeps((prev) => prev.filter((d) => !(d.task_tmp_id === taskTmpId && d.depends_on_tmp_id === dependsOnTmpId)));
                }}
              />
            </div>
          </div>

          <div className="card">
            <div className="project-new-form__actions" style={{ borderTop: 'none', paddingTop: 0, gap: 8, flexWrap: 'wrap' }}>
              <button type="button" className="btn-secondary" onClick={goBack}>Back</button>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleCancel} disabled={saving}>Cancel</button>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleSaveDraft} disabled={saving}>{saving ? 'Saving…' : 'Save Draft'}</button>
              <button type="button" className="btn-primary btn-primary--sm" onClick={handleCreate} disabled={saving}>
                {saving ? 'Creating…' : 'Save & Create Project'}
              </button>
            </div>
          </div>
        </>
      )}
      </>
      )}
      </>
      )}
    </>
  );
}
