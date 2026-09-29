import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getProject, getProjectStructure, updateProjectStatus, setProjectTaskDone, setProjectTaskPercent, setMilestoneReached, patchTask, createProjectTask, createProjectMilestone, removeProjectTask, removeProjectMilestone, addTaskDependency, removeTaskDependency } from '../../services/projects.js';
import { listProfiles } from '../../services/profiles.js';
import { listIndentItemsForProject } from '../../services/indents.js';
import { computeTaskCosts, fmtRupee } from '../../lib/taskCosts.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import BackButton from '../../components/BackButton.jsx';
import IndentSection from '../../components/IndentSection.jsx';
import TaskEditModal from '../../components/TaskEditModal.jsx';
import AssigneePicker from '../../components/AssigneePicker.jsx';
import DependencyPicker from '../../components/DependencyPicker.jsx';
import MessagesSection from '../../components/MessagesSection.jsx';
import DocumentsSection from '../../components/DocumentsSection.jsx';
import CustomizeGantt from '../../components/CustomizeGantt.jsx';
import ChangeBaselineModal from '../../components/ChangeBaselineModal.jsx';
import BaselineApprovalModal from '../../components/BaselineApprovalModal.jsx';
import StatusRequestSection from '../../components/StatusRequestSection.jsx';
import {
  createBaselineChangeRequest,
  listPendingForProject,
  approveBaselineChangeRequest,
  rejectBaselineChangeRequest,
} from '../../services/baselineChangeRequests.js';
import { listBaselinesForProject } from '../../services/projectBaselines.js';
import { listUpdatesForProject } from '../../services/subtaskUpdates.js';

const PHASES = ['project'];
const STATUS_LABEL = {
  planning: 'Planning',
  active: 'Ongoing',
  on_hold: 'Hold',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

// Completed projects lock every task/subtask/milestone/dependency/assignee edit.
// Only Budget lines remain writable (handled in BudgetSection) for final accounting.
function isLocked(project) { return project?.status === 'completed'; }

function fmtName(p) {
  if (!p) return '';
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return full || p.email || '';
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString();
}
function daysBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
}

// Compact click-to-reveal list — used to collapse Assignees / Depends On / Daily Updates
// down to a single eye icon so wide-table rows stay readable.
function EyePopover({ count, items, label, emptyText = 'None' }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="eye-popover">
      <button
        type="button"
        className="eye-popover__btn"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={label || `${count} item${count === 1 ? '' : 's'}`}
        aria-expanded={open}
        aria-label={label || 'Show details'}
      >
        <span className="eye-popover__icon" aria-hidden="true">👁</span>
        <span className="eye-popover__count">{count}</span>
      </button>
      {open && (
        <div className="eye-popover__panel" onClick={(e) => e.stopPropagation()}>
          {items.length === 0 ? (
            <div className="eye-popover__empty">{emptyText}</div>
          ) : (
            items.map((it, i) => <div key={i} className="eye-popover__item">{it}</div>)
          )}
        </div>
      )}
    </span>
  );
}

export default function ProjectDetail() {
  const { projectId } = useParams();
  const { isProjectManager, isAdmin, isLeadership, isMember, profile } = useAuth();
  const toast = useToast();

  // Only users acting AS a member can post progress updates — even a PM assigned to a task
  // must switch their active role to "member" to check-off or update the task.
  function canMark(task) {
    if (!profile?.id) return false;
    if (!isMember) return false;
    const ids = Array.isArray(task.assigned_to_ids) ? task.assigned_to_ids : [];
    if (ids.includes(profile.id)) return true;
    if (task.assigned_to === profile.id) return true;
    return false;
  }
  const [project, setProject] = useState(null);
  const [structure, setStructure] = useState({ tasks: [], milestones: [], dependencies: [] });
  const [profileMap, setProfileMap] = useState(new Map());
  const [profilesList, setProfilesList] = useState([]);
  const [indentItems, setIndentItems] = useState([]);
  const [editingTask, setEditingTask] = useState(null);
  const [inlineMilestone, setInlineMilestone] = useState(null); // { phase, name, target_date }
  const [baselines, setBaselines] = useState([]);
  const [updatesByTask, setUpdatesByTask] = useState(new Map());
  const [editingProject, setEditingProject] = useState(false);
  const [pendingBaselineRequests, setPendingBaselineRequests] = useState([]);
  const [reviewingBaseline, setReviewingBaseline] = useState(null);
  // Split-view left-pane width in %. Draggable divider adjusts it live.
  const [splitLeftPct, setSplitLeftPct] = useState(50);
  // 'both' | 'left' | 'right' | 'fs-left' | 'fs-right'
  // 'left' / 'right' = only that pane in normal layout; 'fs-*' = that pane pinned fixed to viewport.
  const [splitMode, setSplitMode] = useState('both');
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(() => new Set());
  function toggleCollapsed(id) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Weighted-average progress: leaf progress from status/metric; summary rolls up from children.
  function leafProgress(t) {
    if (t.status === 'done') return 100;
    const m = t.progress_metric;
    const actual = Number(t.actual_value);
    if (m === 'percent') return Number.isFinite(actual) ? Math.min(100, Math.max(0, actual)) : 0;
    if (m === 'quantity') {
      const q = Number(t.quantity_value);
      if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(actual)) return 0;
      return Math.min(100, Math.max(0, (actual / q) * 100));
    }
    return t.status === 'in_progress' ? 50 : 0; // done_not_done fallback while WIP
  }
  function computeProgress(node) {
    if (!node.children?.length) return leafProgress(node);
    const total = node.children.reduce((s, c) => s + (Number(c.weight_pct) || 0), 0);
    if (total <= 0) return 0;
    const weighted = node.children.reduce((s, c) => s + computeProgress(c) * (Number(c.weight_pct) || 0), 0);
    return weighted / total;
  }
  function summaryDateRange(node) {
    let earliest = null, latest = null;
    function walk(n) {
      if (n.children?.length) n.children.forEach(walk);
      else {
        if (n.start_date && (!earliest || n.start_date < earliest)) earliest = n.start_date;
        if (n.end_date && (!latest || n.end_date > latest)) latest = n.end_date;
      }
    }
    walk(node);
    return { start: earliest, end: latest };
  }

  // Deep-link jump target from a #[Task] chip: uncollapse every ancestor summary, scroll into view, flash a highlight.
  function handleJumpToTask({ id }) {
    if (!id) return;
    const ancestorIds = new Set();
    const byId = new Map(structure.tasks.map((t) => [t.id, t]));
    let cur = byId.get(id);
    while (cur?.parent_task_id) {
      ancestorIds.add(cur.parent_task_id);
      cur = byId.get(cur.parent_task_id);
    }
    if (ancestorIds.size) {
      setCollapsed((prev) => {
        const next = new Set(prev);
        for (const a of ancestorIds) next.delete(a);
        return next;
      });
    }
    // Wait a tick so React expands the ancestor rows before scrolling.
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-task-id="${id}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('task-highlight');
      setTimeout(() => el.classList.remove('task-highlight'), 2400);
    });
  }

  async function changeStatus(status, confirmMsg) {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusy(true);
    try {
      await updateProjectStatus(projectId, status, { actorId: profile?.id });
      setProject((p) => p ? { ...p, status } : p);
      toast.success(`Project marked ${status.replace('_', ' ')}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to change status.');
    } finally { setBusy(false); }
  }

  // Build a full project snapshot from the current live state — used for baseline change requests.
  function buildSnapshot(overrides = {}) {
    return {
      project: {
        name: project?.name ?? '',
        description: project?.description ?? '',
        start_date: project?.start_date ?? '',
        end_date: project?.end_date ?? '',
      },
      tasks: (structure.tasks ?? []).map((t) => ({
        id: t.id,
        parent_task_id: t.parent_task_id ?? null,
        name: t.name,
        task_type: t.task_type,
        start_date: (overrides.tasks?.[t.id]?.start_date !== undefined ? overrides.tasks[t.id].start_date : t.start_date) ?? '',
        end_date: (overrides.tasks?.[t.id]?.end_date !== undefined ? overrides.tasks[t.id].end_date : t.end_date) ?? '',
      })),
      milestones: (structure.milestones ?? []).map((m) => ({
        id: m.id, name: m.name,
        target_date: m.target_date ?? '',
      })),
    };
  }

  // Submit a single-task date change as a baseline_change_request. Nothing changes locally
  // until leadership approves. Returns true if submitted, false if the user cancelled.
  async function submitSingleTaskDateChange(taskId, patch, promptLabel) {
    const existing = structure.tasks.find((t) => t.id === taskId);
    if (!existing) return false;
    const reason = window.prompt(
      `Reason for changing dates on "${existing.name || 'this task'}"?\n(Required — min 20 characters. This will be sent to leadership for approval.)`,
      '',
    );
    if (reason === null) return false;
    if (reason.trim().length < 20) { toast.error('Reason must be at least 20 characters.'); return false; }
    const before = buildSnapshot();
    const after = buildSnapshot({ tasks: { [taskId]: patch } });
    try {
      const req = await createBaselineChangeRequest({
        projectId, requestedBy: profile?.id,
        reason: reason.trim(), beforeSnapshot: before, afterSnapshot: after,
      });
      setPendingBaselineRequests((prev) => [req, ...prev]);
      toast.success(`Baseline change for ${promptLabel} submitted for leadership approval.`);
      return true;
    } catch (err) {
      toast.error(err.message || 'Failed to submit baseline change request.');
      return false;
    }
  }

  async function handleSaveTaskEdit(patch) {
    if (!editingTask) return;
    // Any date change on a task now goes through the approval flow — never applied directly.
    // Non-date edits (name, assignees, metric, quantity) still apply immediately as before.
    if (patch._baselineReason !== undefined) delete patch._baselineReason;
    const dateOnlyPatch = {};
    const otherPatch = { ...patch };
    if (patch.start_date !== undefined && patch.start_date !== editingTask.start_date) {
      dateOnlyPatch.start_date = patch.start_date;
      delete otherPatch.start_date;
    }
    if (patch.end_date !== undefined && patch.end_date !== editingTask.end_date) {
      dateOnlyPatch.end_date = patch.end_date;
      delete otherPatch.end_date;
    }
    try {
      if (Object.keys(otherPatch).length) {
        const updated = await patchTask(editingTask.id, otherPatch, { actorId: profile?.id });
        setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === updated.id ? { ...t, ...updated } : t) }));
        toast.success('Task updated.');
      }
      if (Object.keys(dateOnlyPatch).length) {
        await submitSingleTaskDateChange(editingTask.id, dateOnlyPatch, `"${editingTask.name}"`);
      }
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  // Gantt drag → open approval request. Revert local UI state (via re-render from unchanged structure)
  // so the bar snaps back until leadership approves.
  async function handleGanttDatesChange(taskId, patch) {
    const submitted = await submitSingleTaskDateChange(taskId, patch, 'the dragged task');
    if (!submitted) {
      // Force a shallow reset so the Gantt bar snaps back to the current (unchanged) dates.
      setStructure((s) => ({ ...s }));
    } else {
      // Same — the change isn't applied until approval.
      setStructure((s) => ({ ...s }));
    }
  }

  async function handleGanttCreateDep(fromTaskId, toTaskId) {
    if (fromTaskId === toTaskId) return;
    const exists = (structure.dependencies ?? []).some((d) => d.task_id === toTaskId && d.depends_on_task_id === fromTaskId);
    if (exists) return;
    try {
      await addTaskDependency(projectId, toTaskId, fromTaskId, { actorId: profile?.id });
      setStructure((s) => ({ ...s, dependencies: [...(s.dependencies ?? []), { task_id: toTaskId, depends_on_task_id: fromTaskId }] }));
      const to = structure.tasks.find((t) => t.id === toTaskId);
      toast.success(`Dependency added — "${to?.name ?? 'task'}" now depends on the linked task.`);
    } catch (err) { toast.error(err.message || 'Failed to add dependency.'); }
  }

  async function handleGanttDeleteDep(taskId, dependsOnTaskId) {
    try {
      await removeTaskDependency(projectId, taskId, dependsOnTaskId, { actorId: profile?.id });
      setStructure((s) => ({ ...s, dependencies: (s.dependencies ?? []).filter((d) => !(d.task_id === taskId && d.depends_on_task_id === dependsOnTaskId)) }));
      toast.success('Dependency removed.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function handleAddInlineTask(phaseKey, parentTaskId) {
    try {
      const created = await createProjectTask(projectId, {
        phase: phaseKey,
        parentTaskId: parentTaskId ?? null,
        name: 'New task',
        weightPct: 0,
        startDate: null, endDate: null,
        assignedToIds: [], actorId: profile?.id,
      });
      setStructure((s) => ({ ...s, tasks: [...s.tasks, created] }));
      if (parentTaskId) setCollapsed((prev) => { const next = new Set(prev); next.delete(parentTaskId); return next; });
    } catch (err) { toast.error(err.message || 'Failed to add task.'); }
  }
  async function handleAddInlineMilestone(phaseKey) {
    setInlineMilestone({ phase: phaseKey, name: '', target_date: '' });
  }
  async function saveInlineMilestone() {
    if (!inlineMilestone) return;
    const trimmed = inlineMilestone.name.trim();
    if (!trimmed) { toast.error('Milestone name is required.'); return; }
    if (!inlineMilestone.target_date) { toast.error('Target date is required.'); return; }
    try {
      const created = await createProjectMilestone(projectId, {
        phase: inlineMilestone.phase, name: trimmed, targetDate: inlineMilestone.target_date, actorId: profile?.id,
      });
      setStructure((s) => ({ ...s, milestones: [...s.milestones, created] }));
      setInlineMilestone(null);
    } catch (err) { toast.error(err.message || 'Failed to add milestone.'); }
  }

  async function handleInlineNameSave(task, name) {
    const trimmed = (name ?? '').trim();
    if (!trimmed || trimmed === task.name) return;
    try {
      const updated = await patchTask(task.id, { name: trimmed }, { actorId: profile?.id });
      setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === updated.id ? { ...t, ...updated } : t) }));
    } catch (err) { toast.error(err.message || 'Failed to rename.'); }
  }
  async function handleInlineWeightSave(task, weight) {
    const w = Math.max(0, Math.min(100, Math.round(Number(weight) || 0)));
    if (w === Number(task.weight_pct)) return;
    try {
      const updated = await patchTask(task.id, { weight_pct: w }, { actorId: profile?.id });
      setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === updated.id ? { ...t, ...updated } : t) }));
    } catch (err) { toast.error(err.message || 'Failed to update weight.'); }
  }
  async function handleToggleAssignee(task, pid) {
    const cur = Array.isArray(task.assigned_to_ids) ? task.assigned_to_ids : [];
    const next = cur.includes(pid) ? cur.filter((x) => x !== pid) : [...cur, pid];
    try {
      const updated = await patchTask(task.id, { assigned_to_ids: next }, { actorId: profile?.id });
      setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === updated.id ? { ...t, ...updated } : t) }));
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }
  async function handleToggleDep(task, otherTaskId) {
    const exists = (structure.dependencies ?? []).some((d) => d.task_id === task.id && d.depends_on_task_id === otherTaskId);
    try {
      if (exists) {
        await removeTaskDependency(projectId, task.id, otherTaskId, { actorId: profile?.id });
        setStructure((s) => ({ ...s, dependencies: (s.dependencies ?? []).filter((d) => !(d.task_id === task.id && d.depends_on_task_id === otherTaskId)) }));
      } else {
        await addTaskDependency(projectId, task.id, otherTaskId, { actorId: profile?.id });
        setStructure((s) => ({ ...s, dependencies: [...(s.dependencies ?? []), { task_id: task.id, depends_on_task_id: otherTaskId }] }));
      }
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  // Indent = make this task a child of the previous sibling. Outdent = move up to grandparent.
  function findParentAndPrevSibling(taskId) {
    const t = structure.tasks.find((x) => x.id === taskId);
    if (!t) return null;
    const siblings = structure.tasks.filter((x) => (x.parent_task_id ?? null) === (t.parent_task_id ?? null))
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = siblings.findIndex((x) => x.id === taskId);
    return { task: t, siblings, index: idx, prev: idx > 0 ? siblings[idx - 1] : null, parentId: t.parent_task_id ?? null };
  }
  async function handleIndent(task) {
    const info = findParentAndPrevSibling(task.id);
    if (!info || !info.prev) { toast.error('No previous sibling to nest under.'); return; }
    try {
      const updated = await patchTask(task.id, { parent_task_id: info.prev.id }, { actorId: profile?.id });
      setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === updated.id ? { ...t, ...updated } : t) }));
    } catch (err) { toast.error(err.message || 'Failed to indent.'); }
  }
  async function handleOutdent(task) {
    const info = findParentAndPrevSibling(task.id);
    if (!info || !info.parentId) { toast.error('Already at the top level.'); return; }
    const parent = structure.tasks.find((x) => x.id === info.parentId);
    const grand = parent?.parent_task_id ?? null;
    try {
      const updated = await patchTask(task.id, { parent_task_id: grand }, { actorId: profile?.id });
      setStructure((s) => ({ ...s, tasks: s.tasks.map((t) => t.id === updated.id ? { ...t, ...updated } : t) }));
    } catch (err) { toast.error(err.message || 'Failed to outdent.'); }
  }

  async function handleRemoveTask(t) {
    const kidCount = structure.tasks.filter((x) => x.parent_task_id === t.id).length;
    if (!window.confirm(`Delete "${t.name}"${kidCount > 0 ? ' and every child under it' : ''}?`)) return;
    try {
      await removeProjectTask(t.id, { actorId: profile?.id });
      setStructure((s) => {
        const toRemove = new Set([t.id]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const x of s.tasks) {
            if (x.parent_task_id && toRemove.has(x.parent_task_id) && !toRemove.has(x.id)) {
              toRemove.add(x.id); grew = true;
            }
          }
        }
        return { ...s, tasks: s.tasks.filter((x) => !toRemove.has(x.id)) };
      });
      toast.success('Deleted.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function handleRemoveMilestone(m) {
    if (!window.confirm(`Delete milestone "${m.name}"?`)) return;
    try {
      await removeProjectMilestone(m.id, { actorId: profile?.id });
      setStructure((s) => ({ ...s, milestones: s.milestones.filter((x) => x.id !== m.id) }));
      toast.success('Milestone deleted.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  async function toggleTaskDone(task, done) {
    setBusy(true);
    try {
      await setProjectTaskDone(task.id, done);
      const today = new Date().toISOString().slice(0, 10);
      setStructure((s) => ({
        ...s,
        tasks: s.tasks.map((t) => t.id === task.id
          ? { ...t, status: done ? 'done' : 'not_started', actual_completion_date: done ? today : null }
          : t),
      }));
      toast.success(done ? 'Task marked done.' : 'Task reopened.');
    } catch (err) {
      toast.error(err.message || 'Failed to update task.');
    } finally { setBusy(false); }
  }
  async function updateTaskPercent(task, pct) {
    setBusy(true);
    try {
      await setProjectTaskPercent(task.id, pct);
      const clean = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
      const today = new Date().toISOString().slice(0, 10);
      setStructure((s) => ({
        ...s,
        tasks: s.tasks.map((t) => {
          if (t.id !== task.id) return t;
          const next = { ...t, actual_value: clean };
          if (clean > 0 && !t.actual_start_date) next.actual_start_date = today;
          if (clean >= 100) { next.status = 'done'; next.actual_completion_date = today; }
          else if (clean > 0) next.status = 'in_progress';
          return next;
        }),
      }));
    } catch (err) {
      toast.error(err.message || 'Failed to update progress.');
    } finally { setBusy(false); }
  }

  async function updateMilestoneDate(m, date) {
    setBusy(true);
    try {
      await setMilestoneReached(m.id, date || null);
      setStructure((s) => ({
        ...s,
        milestones: s.milestones.map((x) => x.id === m.id ? { ...x, reached_date: date || null } : x),
      }));
    } catch (err) {
      toast.error(err.message || 'Failed to update milestone.');
    } finally { setBusy(false); }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [proj, struct, profs, items, bls, updates, pending] = await Promise.all([
          getProject(projectId),
          getProjectStructure(projectId),
          listProfiles().catch(() => []),
          listIndentItemsForProject(projectId).catch(() => []),
          listBaselinesForProject(projectId).catch(() => []),
          listUpdatesForProject(projectId).catch(() => new Map()),
          listPendingForProject(projectId).catch(() => []),
        ]);
        if (!cancelled) {
          setProject(proj);
          setStructure(struct);
          setProfilesList(profs);
          setProfileMap(new Map(profs.map((p) => [p.id, p])));
          setIndentItems(items);
          setBaselines(bls);
          setUpdatesByTask(updates);
          setPendingBaselineRequests(pending);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load project.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [projectId]);

  function assigneesFor(t) {
    const ids = Array.isArray(t.assigned_to_ids) && t.assigned_to_ids.length ? t.assigned_to_ids : (t.assigned_to ? [t.assigned_to] : []);
    return ids.map((id) => fmtName(profileMap.get(id))).filter(Boolean);
  }

  const grouped = useMemo(() => {
    const out = { project: { roots: [], milestones: [] } };
    const byId = new Map();
    for (const t of structure.tasks) byId.set(t.id, { ...t, children: [] });
    for (const t of structure.tasks) {
      const node = byId.get(t.id);
      if (t.parent_task_id && byId.has(t.parent_task_id)) {
        byId.get(t.parent_task_id).children.push(node);
      } else {
        out.project.roots.push(node);
      }
    }
    for (const m of structure.milestones) out.project.milestones.push(m);
    return out;
  }, [structure]);

  const depsByTaskId = useMemo(() => {
    const m = new Map();
    for (const d of structure.dependencies) {
      if (!m.has(d.task_id)) m.set(d.task_id, []);
      m.get(d.task_id).push(d.depends_on_task_id);
    }
    return m;
  }, [structure]);

  // Overall project progress: weighted average of root tasks (per-root weight_pct sum should be ~100 within the phase).
  const overallProgress = useMemo(() => {
    const roots = grouped.project.roots;
    if (!roots.length) return 0;
    const totalW = roots.reduce((s, r) => s + (Number(r.weight_pct) || 0), 0);
    if (totalW <= 0) return 0;
    const weighted = roots.reduce((s, r) => s + computeProgress(r) * (Number(r.weight_pct) || 0), 0);
    return weighted / totalW;
  }, [grouped]); // eslint-disable-line react-hooks/exhaustive-deps

  // Project planned range = min leaf start, max leaf end from CURRENT task dates.
  const plannedRange = useMemo(() => {
    const parentIds = new Set(structure.tasks.filter((t) => t.parent_task_id).map((t) => t.parent_task_id));
    const leaves = structure.tasks.filter((t) => !parentIds.has(t.id));
    const starts = leaves.map((t) => t.start_date).filter(Boolean).sort();
    const ends = leaves.map((t) => t.end_date).filter(Boolean).sort();
    if (!starts.length && !ends.length) return null;
    return { start: starts[0] ?? null, end: ends[ends.length - 1] ?? null };
  }, [structure]);

  // "Original" planned range = min/max derived from the EARLIEST date-baseline snapshot per task.
  // If a task never had its dates changed, its "original" is its current — so we exclude those.
  // Amount baselines are excluded here (kind !== 'task_date').
  const originalPlannedRange = useMemo(() => {
    const dateBls = baselines.filter((b) => (b.kind ?? 'task_date') === 'task_date');
    if (!dateBls.length) return null;
    const firstBl = new Map();
    for (const b of dateBls) {
      const cur = firstBl.get(b.task_id);
      if (!cur || cur.created_at > b.created_at) firstBl.set(b.task_id, b);
    }
    const starts = [...firstBl.values()].map((b) => b.snapshot_start).filter(Boolean).sort();
    const ends = [...firstBl.values()].map((b) => b.snapshot_end).filter(Boolean).sort();
    if (!starts.length && !ends.length) return null;
    return { start: starts[0] ?? null, end: ends[ends.length - 1] ?? null };
  }, [baselines]);

  const actualRange = useMemo(() => {
    const starts = structure.tasks.map((t) => t.actual_start_date).filter(Boolean).sort();
    const ends = structure.tasks.map((t) => t.actual_completion_date).filter(Boolean).sort();
    return { start: starts[0] ?? null, end: ends[ends.length - 1] ?? null };
  }, [structure]);

  // Baselines grouped by task id — date-kind only, for Gantt ghost-bar rendering.
  const baselinesByTaskId = useMemo(() => {
    const m = new Map();
    for (const b of baselines) {
      if ((b.kind ?? 'task_date') !== 'task_date') continue;
      const arr = m.get(b.task_id) ?? [];
      arr.push(b);
      m.set(b.task_id, arr);
    }
    return m;
  }, [baselines]);

  // Wrap grouped.project.roots into the shape CustomizeGantt expects: {project: {tasks, milestones}} using id as tmp_id.
  const ganttState = useMemo(() => {
    function shape(n) {
      return {
        tmp_id: n.id, name: n.name, task_type: n.task_type,
        start_date: n.start_date, end_date: n.end_date, weight_pct: n.weight_pct,
        children: (n.children ?? []).map(shape),
      };
    }
    const milestones = (structure.milestones ?? []).map((m) => ({
      tmp_id: m.id, name: m.name, target_date: m.target_date, reached_date: m.reached_date,
    }));
    return { project: { tasks: grouped.project.roots.map(shape), milestones } };
  }, [grouped, structure.milestones]);
  const ganttDeps = useMemo(() => (structure.dependencies ?? []).map((d) => ({ task_tmp_id: d.task_id, depends_on_tmp_id: d.depends_on_task_id })), [structure]);

  const taskById = useMemo(() => {
    const m = new Map();
    for (const t of structure.tasks) m.set(t.id, t);
    return m;
  }, [structure]);

  const costsByTaskId = useMemo(() => computeTaskCosts(indentItems), [indentItems]);

  const counts = useMemo(() => {
    const kids = new Set();
    for (const t of structure.tasks) if (t.parent_task_id) kids.add(t.parent_task_id);
    let summaries = 0, tasks = 0;
    for (const t of structure.tasks) {
      if (kids.has(t.id)) summaries += 1; else tasks += 1;
    }
    return { summaries, tasks, ms: structure.milestones.length, deps: structure.dependencies.length };
  }, [structure]);

  if (loading) return <div className="card">Loading…</div>;
  if (error) return (
    <>
      <BackButton to="/projects" label="Back to Projects" />
      <div className="card">{error}</div>
    </>
  );
  if (!project) return (
    <>
      <BackButton to="/projects" label="Back to Projects" />
      <div className="card">Project not found.</div>
    </>
  );

  // Per role-access spec: only the PM of THIS specific project can edit tasks / milestones.
  // Everyone else (Project Admin, Leadership, other PMs, Members) is view-only for tasks
  // but can still edit Documents, Budget, and Indent Items (governed inside those sections).
  const isMyProject = isProjectManager && project.project_manager?.id === profile?.id;
  const canEditTasks = isMyProject && !isLocked(project);
  const hasPendingBaseline = pendingBaselineRequests.length > 0;
  const latestPending = pendingBaselineRequests[0];

  return (
    <>
      <BackButton to="/projects" label="Back to Projects" />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h2 className="page-title" style={{ marginBottom: 0 }}>{project.name}</h2>
        {canEditTasks && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {project.status !== 'active' && project.status !== 'completed' && project.status !== 'cancelled' && (
              <button type="button" className="btn-primary btn-primary--sm" disabled={busy} onClick={() => changeStatus('active')}>
                Start Project
              </button>
            )}
            <button
              type="button"
              className="btn-secondary btn-secondary--sm"
              onClick={() => setEditingProject(true)}
              disabled={hasPendingBaseline}
              title={hasPendingBaseline ? 'A baseline change is awaiting approval — wait for a decision before submitting another.' : 'Change project baseline (name, description, planned dates, task dates)'}
            >Change Baseline</button>
          </div>
        )}
      </div>
      <div className="tpl-header__meta" style={{ marginBottom: 8, marginTop: 4 }}>
        <span>{project.project_class === 'greenfield' ? 'Greenfield' : 'Brownfield'}</span>
        <span className="tpl-header__dot">·</span>
        <span>{project.project_templates?.name} <span className="version-pill">v{project.template_versions?.version_no}</span></span>
        {project.rag_rules?.name && (
          <>
            <span className="tpl-header__dot">·</span>
            <span title={`RAG thresholds — Green ≥ ${project.rag_rules.green_min_pct}%, Amber ≥ ${project.rag_rules.amber_min_pct}% (latest as of ${fmtDate(project.rag_rules.updated_at)})`}>
              RAG: <b>{project.rag_rules.name}</b> <span className="version-pill">latest {fmtDate(project.rag_rules.updated_at)}</span>
            </span>
          </>
        )}
        <span className="tpl-header__dot">·</span>
        <span className={`status-pill status-pill--${project.is_draft ? 'planning' : project.status}`}>{project.is_draft ? 'Draft' : (STATUS_LABEL[project.status] ?? project.status)}</span>
      </div>
      <div className="tpl-header__meta tpl-header__meta--muted" style={{ marginBottom: 12 }}>
        {counts.tasks} task{counts.tasks === 1 ? '' : 's'} · {counts.summaries} summary heading{counts.summaries === 1 ? '' : 's'} · {counts.ms} milestone{counts.ms === 1 ? '' : 's'} · {counts.deps} dependenc{counts.deps === 1 ? 'y' : 'ies'}
      </div>
      <div className="view-switcher" role="tablist" aria-label="Project views">
        <span className="view-switcher__label">View:</span>
        <span className="view-switcher__btn view-switcher__btn--active" aria-current="page">List</span>
        <Link to={`/projects/${projectId}/kanban`} className="view-switcher__btn">Kanban Board</Link>
        <Link to={`/projects/${projectId}/gantt`} className="view-switcher__btn">Gantt Chart</Link>
      </div>
      {isLocked(project) && (
        <div className="completion-lock-banner">
          <b>Project Completed.</b> Tasks, subtasks, milestones, indents, funding, documents and messages are read-only. Only Budget rows remain editable for final accounting.
        </div>
      )}
      {!isMyProject && !isLocked(project) && (isAdmin || isLeadership || isProjectManager) && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          <b>View-only role.</b> {isAdmin ? 'As Project Admin' : isLeadership ? 'As Leadership' : 'You do not manage this project'} — Tasks, milestones and dates are read-only. Documents, Budget and Indent Items remain editable below.
        </div>
      )}

      <div className="card">
        <div className="project-progress">
          <div className="project-progress__row">
            <span className="project-progress__label">Overall Progress</span>
            <div className="project-progress__bar" title={`${Math.round(overallProgress)}% complete`}>
              <div className="project-progress__fill" style={{ width: `${Math.max(0, Math.min(100, overallProgress))}%` }} />
              <span className="project-progress__pct">{Math.round(overallProgress)}%</span>
            </div>
          </div>
          {plannedRange && (
            <div className="project-progress__timeline" title="1st leaf-task start → last leaf-task end">
              <span className="project-progress__label">Planned</span>
              <span>{fmtDate(plannedRange.start)} → {fmtDate(plannedRange.end)}</span>
              {originalPlannedRange && (originalPlannedRange.start !== plannedRange.start || originalPlannedRange.end !== plannedRange.end) && (
                <span className="project-progress__baseline" title="Original planned dates (from the earliest task baseline)">
                  baseline: {fmtDate(originalPlannedRange.start)} → {fmtDate(originalPlannedRange.end)}
                </span>
              )}
            </div>
          )}
          <div className="project-progress__timeline">
            <span className="project-progress__label">Actual</span>
            {actualRange.start || actualRange.end
              ? <span>{fmtDate(actualRange.start)} → {actualRange.end ? fmtDate(actualRange.end) : 'in progress'}</span>
              : <span style={{ color: 'var(--color-text-muted)' }}>— not started</span>}
          </div>
        </div>
        <dl className="detail-grid" style={{ marginTop: 12 }}>
          <div><dt>Campus</dt><dd>{project.campuses?.name ?? '—'}</dd></div>
          <div><dt>School</dt><dd>{project.schools?.name ?? '—'}</dd></div>
          <div><dt>Project Manager</dt><dd>{fmtName(project.project_manager) || '—'}</dd></div>
          <div><dt>Created By</dt><dd>{fmtName(project.created_by_profile) || '—'}</dd></div>
          <div style={{ gridColumn: '1 / -1' }}><dt>Description</dt><dd>{project.description || '—'}</dd></div>
        </dl>
      </div>

      {hasPendingBaseline && (
        <div className="bcr-banner" role="status">
          <div className="bcr-banner__msg">
            ⏳ Baseline change request pending approval — requested by <b>{fmtName(latestPending.requester)}</b> on {fmtDate(latestPending.requested_at)}.
          </div>
          {isLeadership || isAdmin ? (
            <button type="button" className="btn-primary btn-primary--sm" onClick={() => setReviewingBaseline(latestPending)}>Review &amp; Decide</button>
          ) : (
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setReviewingBaseline(latestPending)}>View Details</button>
          )}
        </div>
      )}
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
          splitMode === 'left' || splitMode === 'fs-left'  ? '1fr 8px 0'
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
        const phase = grouped[phaseKey];
        const hasContent = phase.roots.length > 0 || phase.milestones.length > 0;
        function renderTaskNode(t, wbs, depth) {
          const depIds = depsByTaskId.get(t.id) ?? [];
          const depNames = depIds.map((id) => taskById.get(id)?.name).filter(Boolean);
          const days = daysBetween(t.start_date, t.end_date);
          const isDone = t.status === 'done';
          const hasKids = (t.children?.length ?? 0) > 0;
          const isSummary = hasKids;
          const isCollapsed = collapsed.has(t.id);
          const rolledProgress = isSummary ? computeProgress(t) : null;
          const rolledRange = isSummary ? summaryDateRange(t) : null;
          const rowClass = isSummary
            ? 'project-detail-table__row project-detail-table__row--bold project-detail-table__row--summary'
            : depth === 0
              ? 'project-detail-table__row project-detail-table__row--bold'
              : 'project-detail-table__row project-detail-table__row--sub';
          const nameClass = isSummary || depth === 0
            ? 'project-detail-table__name project-detail-table__name--bold'
            : 'project-detail-table__name';
          return (
            <React.Fragment key={t.id}>
              <div className={rowClass} data-task-id={t.id}>
                <div className="project-detail-table__num">{wbs}</div>
                <div className={nameClass} style={{ paddingLeft: depth * 16 }}>
                  {hasKids ? (
                    <button
                      type="button" className="ps-row__toggle"
                      onClick={() => toggleCollapsed(t.id)}
                      aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                      title={isCollapsed ? 'Expand children' : 'Collapse children'}
                    >{isCollapsed ? '▶' : '▼'}</button>
                  ) : (
                    <span className="ps-row__toggle ps-row__toggle--spacer" aria-hidden="true" />
                  )}
                  {isSummary && <span className="summary-tag" title="Summary heading">Σ</span>}
                  {canEditTasks ? (
                    <input
                      type="text"
                      className="tpl-input"
                      defaultValue={t.name}
                      onBlur={(e) => handleInlineNameSave(t, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      style={{ maxWidth: 260 }}
                      title="Rename this task"
                    />
                  ) : t.name}
                  {(() => {
                    const pct = isSummary ? rolledProgress : leafProgress(t);
                    return (
                      <span className="row-progress" title={`${Math.round(pct)}% complete`}>
                        <span className="row-progress__bar">
                          <span className="row-progress__fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
                        </span>
                        <span className="row-progress__pct">{Math.round(pct)}%</span>
                      </span>
                    );
                  })()}
                  {canEditTasks && (
                    <>
                      <button type="button" className="icon-btn task-edit-btn" onClick={() => handleOutdent(t)} title="Outdent">←</button>
                      <button type="button" className="icon-btn task-edit-btn" onClick={() => handleIndent(t)} title="Indent">→</button>
                      <button type="button" className="icon-btn task-edit-btn" onClick={() => handleAddInlineTask(phaseKey, t.id)} title="Add sub-task">+Sub</button>
                      <button type="button" className="icon-btn task-edit-btn" onClick={() => setEditingTask(t)} title="Edit details">Edit</button>
                      <button type="button" className="icon-btn task-edit-btn icon-btn--danger" onClick={() => handleRemoveTask(t)} title="Delete">Del</button>
                    </>
                  )}
                  {costsByTaskId.has(t.id) && (
                    <div className="task-cost-chip" title="Materials cost from mapped indent items">
                      Materials: <b>{fmtRupee(costsByTaskId.get(t.id).estimated)}</b> est · <b>{fmtRupee(costsByTaskId.get(t.id).received)}</b> recvd · {costsByTaskId.get(t.id).itemCount} item{costsByTaskId.get(t.id).itemCount === 1 ? '' : 's'}
                    </div>
                  )}
                </div>
                <div title={isSummary ? 'Summary rows do not carry a weight — the % column applies to leaf tasks.' : 'Weight of this task'}>
                  {isSummary ? '—' : `${Math.round(Number(t.weight_pct) || 0)}%`}
                </div>
                <div>{isSummary
                  ? (rolledRange.start || rolledRange.end
                    ? <>{fmtDate(rolledRange.start)} → {fmtDate(rolledRange.end)}</>
                    : '—')
                  : <>{fmtDate(t.start_date)} → {fmtDate(t.end_date)}</>}</div>
                <div>{isSummary
                  ? '—'
                  : (t.actual_start_date || t.actual_completion_date
                    ? <>{fmtDate(t.actual_start_date)} → {fmtDate(t.actual_completion_date)}</>
                    : '—')}</div>
                <div>{isSummary
                  ? (rolledRange.start && rolledRange.end ? daysBetween(rolledRange.start, rolledRange.end) : '—')
                  : (days ?? '—')}</div>
                <div>{isSummary ? '—' : canEditTasks ? (
                  <AssigneePicker
                    profiles={profilesList}
                    selected={Array.isArray(t.assigned_to_ids) ? t.assigned_to_ids : (t.assigned_to ? [t.assigned_to] : [])}
                    onToggle={(pid) => handleToggleAssignee(t, pid)}
                  />
                ) : (() => {
                  const names = assigneesFor(t);
                  if (!names.length) return '';
                  return <EyePopover count={names.length} items={names} label={`${names.length} assignee${names.length === 1 ? '' : 's'}`} />;
                })()}</div>
                <div>
                  {isSummary ? '—'
                    : t.progress_metric === 'quantity'
                      ? (t.quantity_value != null ? `${t.quantity_value} ${t.quantity_unit ?? ''}` : 'Quantity')
                      : (t.progress_metric === 'percent' ? '% Based' : 'Done / Not-done')}
                </div>
                <div>
                  {isSummary ? '—' : canEditTasks ? (() => {
                    // Leaf tasks that appear ABOVE this one in the phase are eligible dependency targets.
                    const parentIds = new Set(structure.tasks.filter((x) => x.parent_task_id).map((x) => x.parent_task_id));
                    const leaves = structure.tasks
                      .filter((x) => !parentIds.has(x.id) && x.id !== t.id)
                      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
                    const above = leaves.slice(0, leaves.findIndex((x) => (x.sort_order ?? 0) >= (t.sort_order ?? 0)))
                      .map((x) => ({ tmp_id: x.id, name: x.name }));
                    const selected = (structure.dependencies ?? [])
                      .filter((d) => d.task_id === t.id).map((d) => d.depends_on_task_id);
                    return <DependencyPicker aboveTasks={above.length ? above : leaves.map((x) => ({ tmp_id: x.id, name: x.name }))}
                              selected={selected} onToggle={(otherId) => handleToggleDep(t, otherId)} />;
                  })() : (depNames.length === 0 ? ''
                    : <EyePopover count={depNames.length} items={depNames} label={`Depends on ${depNames.length}`} />)}
                </div>
                <div className="project-detail-table__updates">
                  {!isSummary && (() => {
                    const list = updatesByTask.get(t.id) ?? [];
                    const items = list.map((u) => {
                      const who = u.author ? (`${u.author.first_name ?? ''} ${u.author.last_name ?? ''}`.trim() || u.author.email) : 'Someone';
                      const when = new Date(u.update_date || u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
                      return `${when} · ${who}: ${u.notes || ''}`;
                    });
                    return (
                      <EyePopover
                        count={list.length}
                        items={items}
                        label={`${list.length} daily update${list.length === 1 ? '' : 's'}`}
                        emptyText="No updates yet — daily updates from assignees will appear here."
                      />
                    );
                  })()}
                  {isSummary ? (
                    <span className="status-pill" style={{ background: '#eef4fb', color: '#155685' }}>
                      {Math.round(rolledProgress)}%
                    </span>
                  ) : t.progress_metric === 'percent' && canMark(t) && !isMyProject ? (
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="number" min={Number(t.actual_value) || 0} max={100} step={1}
                        defaultValue={Math.round(Number(t.actual_value) || 0)}
                        onBlur={(e) => {
                          const v = Number(e.target.value);
                          if (Number.isFinite(v) && v !== Number(t.actual_value)) updateTaskPercent(t, v);
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        disabled={busy || t.status === 'done'}
                        style={{ width: 56, padding: '2px 4px' }}
                        title={t.status === 'done' ? 'Task is complete' : 'Progress can only go up'}
                      />
                      <span className="status-pill status-pill--in_progress">%</span>
                    </label>
                  ) : canMark(t) ? (
                    // Only a Member assigned to this task can toggle Done. Everyone else
                    // (PA, Leadership, IT Admin, other PMs, non-assigned Members, and the current
                    // project's PM) sees the read-only status pill — no inert checkbox clutter.
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <input
                        type="checkbox"
                        checked={isDone}
                        onChange={(e) => toggleTaskDone(t, e.target.checked)}
                        disabled={busy || (t.status === 'done')}
                        title={t.status === 'done' ? 'Progress can only go up — cannot reopen' : ''}
                      />
                      <span className={`status-pill status-pill--${t.status ?? 'not_started'}`}>{(t.status ?? 'not_started').replace('_', ' ')}</span>
                    </label>
                  ) : (
                    <span className={`status-pill status-pill--${t.status ?? 'not_started'}`}>
                      {t.progress_metric === 'percent' && t.actual_value != null
                        ? `${Math.round(Number(t.actual_value))}%`
                        : (t.status ?? 'not_started').replace('_', ' ')}
                    </span>
                  )}
                </div>
              </div>
              {hasKids && !isCollapsed && t.children.map((c, ci) => renderTaskNode(c, `${wbs}.${ci + 1}`, depth + 1))}
            </React.Fragment>
          );
        }
        return (
          <section key={phaseKey} className="tpl-section" style={{ marginTop: 16 }}>
            <header className="tpl-section__head">
              <div>
                <div className="tpl-section__weight">
                  {phase.roots.length} root task{phase.roots.length === 1 ? '' : 's'} · {phase.milestones.length} milestone{phase.milestones.length === 1 ? '' : 's'}
                </div>
              </div>
              {canEditTasks && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => handleAddInlineTask(phaseKey, null)}>+ Task</button>
                  <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => handleAddInlineMilestone(phaseKey)}>+ Milestone</button>
                </div>
              )}
            </header>
            {!hasContent && (
              <div className="masters-users__empty" style={{ padding: 12 }}>No tasks or milestones yet.{isMyProject ? ' Add above.' : ''}</div>
            )}

            {phase.roots.length > 0 && (
              <div className="project-detail-table">
                <div className="project-detail-table__row project-detail-table__row--head">
                  <div>WBS</div>
                  <div>Task</div>
                  <div>%</div>
                  <div>Planned</div>
                  <div>Actual</div>
                  <div>Days</div>
                  <div>Assignee</div>
                  <div>Metric</div>
                  <div>Depends on</div>
                  <div>Updates</div>
                </div>
                {phase.roots.map((t, i) => renderTaskNode(t, `${i + 1}`, 0))}
              </div>
            )}

            {(phase.milestones.length > 0 || inlineMilestone?.phase === phaseKey) && (
              <div className="tpl-milestones">
                <div className="tpl-milestones__label">Milestones</div>
                {inlineMilestone?.phase === phaseKey && (
                  <div className="tpl-milestones__row" style={{ justifyContent: 'flex-start', gap: 8, background: '#f8fafc', border: '1px dashed #cbd5e1', padding: 6, borderRadius: 4 }}>
                    <span className="tpl-milestones__no">new</span>
                    <input
                      type="text"
                      className="tpl-input"
                      autoFocus
                      value={inlineMilestone.name}
                      onChange={(e) => setInlineMilestone((m) => ({ ...m, name: e.target.value }))}
                      placeholder="Milestone name"
                      style={{ flex: 1 }}
                    />
                    <input
                      type="date"
                      className="tpl-input"
                      value={inlineMilestone.target_date}
                      onChange={(e) => setInlineMilestone((m) => ({ ...m, target_date: e.target.value }))}
                      style={{ width: 150 }}
                    />
                    <button type="button" className="btn-primary btn-primary--sm" onClick={saveInlineMilestone}>Add</button>
                    <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setInlineMilestone(null)}>Cancel</button>
                  </div>
                )}
                {phase.milestones.map((m, i) => (
                  <div key={m.id} className="tpl-milestones__row" style={{ justifyContent: 'flex-start', gap: 12 }}>
                    <span className="tpl-milestones__no">M{i + 1}</span>
                    <span style={{ flex: 1, fontWeight: 600 }}>{m.name}</span>
                    <span className="form-hint">Target: {fmtDate(m.target_date)}</span>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                      <span className="form-hint">Reached:</span>
                      <input
                        type="date"
                        className="tpl-input"
                        value={m.reached_date || ''}
                        onChange={(e) => updateMilestoneDate(m, e.target.value)}
                        disabled={busy}
                        style={{ width: 150 }}
                      />
                    </label>
                    {canEditTasks && (
                      <button type="button" className="icon-btn task-edit-btn icon-btn--danger" onClick={() => handleRemoveMilestone(m)} title="Delete milestone">Del</button>
                    )}
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
            state={ganttState}
            dependencies={ganttDeps}
            baselines={baselinesByTaskId}
            projectStart={plannedRange?.start}
            projectEnd={plannedRange?.end}
            readOnly={!canEditTasks || isLocked(project)}
            onDatesChange={handleGanttDatesChange}
            onCreateDep={handleGanttCreateDep}
            onDeleteDep={handleGanttDeleteDep}
          />
        </div>
      </div>

      <StatusRequestSection
        project={project}
        onStatusChanged={(nextStatus) => setProject((p) => p ? { ...p, status: nextStatus } : p)}
      />

      <IndentSection project={project} tasks={structure.tasks} profiles={profilesList} />
      {editingTask && (
        <TaskEditModal
          task={editingTask}
          profiles={profilesList}
          onClose={() => setEditingTask(null)}
          onSave={handleSaveTaskEdit}
        />
      )}
      {editingProject && (
        <ChangeBaselineModal
          project={project}
          structure={structure}
          onClose={() => setEditingProject(false)}
          onSubmit={async ({ beforeSnapshot, afterSnapshot, reason }) => {
            const req = await createBaselineChangeRequest({
              projectId,
              requestedBy: profile?.id,
              reason,
              beforeSnapshot,
              afterSnapshot,
            });
            setPendingBaselineRequests((prev) => [req, ...prev]);
            toast.success('Baseline change request submitted for leadership approval.');
          }}
        />
      )}
      {reviewingBaseline && (
        <BaselineApprovalModal
          request={reviewingBaseline}
          readOnly={!isLeadership && !isAdmin}
          onClose={() => setReviewingBaseline(null)}
          onApprove={async ({ requestId, decisionReason }) => {
            await approveBaselineChangeRequest({ requestId, deciderId: profile?.id, decisionReason });
            setPendingBaselineRequests((prev) => prev.filter((r) => r.id !== requestId));
            // Reload structure + baselines so ghost bars + new dates render.
            const [struct, bls] = await Promise.all([
              getProjectStructure(projectId),
              listBaselinesForProject(projectId).catch(() => []),
            ]);
            setStructure(struct);
            setBaselines(bls);
            const proj = await getProject(projectId);
            setProject(proj);
            toast.success('Baseline change approved and applied.');
          }}
          onReject={async ({ requestId, decisionReason }) => {
            await rejectBaselineChangeRequest({ requestId, deciderId: profile?.id, decisionReason });
            setPendingBaselineRequests((prev) => prev.filter((r) => r.id !== requestId));
            toast.success('Baseline change rejected.');
          }}
        />
      )}
      <DocumentsSection project={project} />
      <MessagesSection project={project} onJumpToTask={handleJumpToTask} />
    </>
  );
}
