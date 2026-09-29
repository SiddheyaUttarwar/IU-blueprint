import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { listProjectTemplates } from '../../../services/projectTemplates.js';
import { listTasks, createTaskWithSubtasks, removeTask, addSubtask, PHASES, phaseLabel } from '../../../services/tasks.js';
import ExportButton from '../../../components/ExportButton.jsx';
import { IconPlus, IconTrash } from '../../../components/Icons.jsx';
import RequiredMark from '../../../components/RequiredMark.jsx';
import BackButton from '../../../components/BackButton.jsx';

function groupTasks(all) {
  const parents = all.filter((t) => !t.parent_task_id);
  const childrenByParent = new Map();
  for (const t of all) {
    if (!t.parent_task_id) continue;
    const list = childrenByParent.get(t.parent_task_id) ?? [];
    list.push(t);
    childrenByParent.set(t.parent_task_id, list);
  }
  const groups = new Map();
  for (const p of parents) {
    const templateId = p.project_template_id;
    const templateName = p.project_templates?.name ?? '—';
    const key = `${templateId}::${p.phase}`;
    if (!groups.has(key)) {
      groups.set(key, { templateId, templateName, phase: p.phase, tasks: [] });
    }
    groups.get(key).tasks.push({ ...p, subtasks: childrenByParent.get(p.id) ?? [] });
  }
  return [...groups.values()].sort((a, b) => {
    const t = a.templateName.localeCompare(b.templateName);
    if (t !== 0) return t;
    return a.phase.localeCompare(b.phase);
  });
}

export default function TaskPage() {
  const { profile } = useAuth();
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [templateId, setTemplateId] = useState('');
  const [phase, setPhase] = useState('pre_project');
  const [name, setName] = useState('');
  const [subtaskInputs, setSubtaskInputs] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [subFor, setSubFor] = useState('');
  const [subName, setSubName] = useState('');
  const [errors, setErrors] = useState({});
  const [subInlineError, setSubInlineError] = useState('');
  const parentReady = !!templateId && !!phase && name.trim().length > 0;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [tpls, ts] = await Promise.all([listProjectTemplates(), listTasks()]);
        if (cancelled) return;
        setTemplates(tpls);
        setTasks(ts);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load tasks.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => groupTasks(tasks), [tasks]);

  const exportRows = useMemo(() => {
    const rows = [];
    for (const g of groups) {
      for (const t of g.tasks) {
        rows.push({ template: g.templateName, phase: g.phase, task: t.name, subtask: '' });
        for (const s of t.subtasks) {
          rows.push({ template: g.templateName, phase: g.phase, task: t.name, subtask: s.name });
        }
      }
    }
    return rows;
  }, [groups]);

  const exportColumns = [
    { key: 'template', label: 'Project Template' },
    { key: 'phase', label: 'Phase', value: (r) => phaseLabel(r.phase) },
    { key: 'task', label: 'Task' },
    { key: 'subtask', label: 'Subtask' },
  ];

  function addSubtaskInput() {
    if (!parentReady) {
      const next = {};
      if (!templateId) next.templateId = 'Select a project template first.';
      if (!phase) next.phase = 'Select a project phase first.';
      if (!name.trim()) next.name = 'Enter the task name before adding subtasks.';
      setErrors(next);
      return;
    }
    setSubtaskInputs((prev) => [...prev, '']);
  }
  function updateSubtaskInput(i, v) { setSubtaskInputs((prev) => prev.map((s, idx) => (idx === i ? v : s))); }
  function removeSubtaskInput(i) { setSubtaskInputs((prev) => prev.filter((_, idx) => idx !== i)); }

  function validateParent() {
    const next = {};
    if (!templateId) next.templateId = 'Project template is required.';
    if (!phase) next.phase = 'Project phase is required.';
    if (!name.trim()) next.name = 'Task name is required.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!validateParent()) return;
    setAdding(true);
    try {
      const { task, subtasks } = await createTaskWithSubtasks({
        templateId, phase, name, subtasks: subtaskInputs, createdBy: profile?.id,
      });
      setTasks((prev) => [...prev, task, ...subtasks]);
      toast.success(`Added task: ${task.name}${subtasks.length ? ` (+${subtasks.length} subtasks)` : ''}`);
      setName('');
      setSubtaskInputs([]);
      setErrors({});
    } catch (err) {
      toast.error(err.message || 'Failed to add task.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(t) {
    const confirmMsg = t.parent_task_id
      ? `Delete subtask "${t.name}"?`
      : `Delete task "${t.name}" and all its subtasks?`;
    if (!window.confirm(confirmMsg)) return;
    setBusyId(t.id);
    try {
      await removeTask(t.id);
      setTasks((prev) => prev.filter((r) => r.id !== t.id && r.parent_task_id !== t.id));
      toast.success(`Deleted ${t.name}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete.');
    } finally {
      setBusyId('');
    }
  }

  async function handleAddSubtaskToExisting(parent) {
    if (!subName.trim()) {
      setSubInlineError('Subtask name is required.');
      return;
    }
    setSubInlineError('');
    setBusyId(parent.id);
    try {
      const created = await addSubtask({
        parentTaskId: parent.id,
        templateId: parent.project_template_id,
        phase: parent.phase,
        name: subName,
        createdBy: profile?.id,
      });
      setTasks((prev) => [...prev, created]);
      toast.success(`Added subtask under ${parent.name}.`);
      setSubName('');
      setSubFor('');
    } catch (err) {
      toast.error(err.message || 'Failed to add subtask.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Task</h2>

      <div className="card">
        <form onSubmit={handleAdd} className="inline-form">
          <label className={`inline-form__field${errors.templateId ? ' inline-form__field--invalid' : ''}`}>
            <span>Project Template<RequiredMark /></span>
            <select
              value={templateId}
              onChange={(e) => { setTemplateId(e.target.value); if (errors.templateId) setErrors((p) => ({ ...p, templateId: undefined })); }}
              aria-invalid={!!errors.templateId}
            >
              <option value="">Select template…</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {errors.templateId && <span className="form-error-inline">{errors.templateId}</span>}
          </label>
          <label className={`inline-form__field${errors.phase ? ' inline-form__field--invalid' : ''}`}>
            <span>Project Phase<RequiredMark /></span>
            <select
              value={phase}
              onChange={(e) => { setPhase(e.target.value); if (errors.phase) setErrors((p) => ({ ...p, phase: undefined })); }}
              aria-invalid={!!errors.phase}
            >
              {PHASES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            {errors.phase && <span className="form-error-inline">{errors.phase}</span>}
          </label>
          <label className={`inline-form__field${errors.name ? ' inline-form__field--invalid' : ''}`}>
            <span>Task Name<RequiredMark /></span>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
              placeholder="e.g. Site survey"
              maxLength={140}
              aria-invalid={!!errors.name}
            />
            {errors.name && <span className="form-error-inline">{errors.name}</span>}
          </label>
        </form>

        {subtaskInputs.length > 0 && (
          <div className="subtask-inputs">
            <div className="subtask-inputs__label">Subtasks (under this task)</div>
            {subtaskInputs.map((s, i) => (
              <div key={i} className="subtask-inputs__row">
                <input
                  type="text"
                  value={s}
                  onChange={(e) => updateSubtaskInput(i, e.target.value)}
                  placeholder={`Subtask ${i + 1}`}
                  maxLength={140}
                />
                <button
                  type="button"
                  className="icon-btn icon-btn--danger"
                  onClick={() => removeSubtaskInput(i)}
                  aria-label={`Remove subtask ${i + 1}`}
                >
                  <IconTrash />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="inline-form__actions">
          <button
            type="button"
            className="btn-secondary btn-secondary--sm"
            onClick={addSubtaskInput}
            disabled={!parentReady}
            title={!parentReady ? 'Fill Template, Phase, and Task Name first.' : 'Add a subtask under this task'}
          >
            <IconPlus /> Add Subtask
          </button>
          <button
            type="submit"
            className="btn-primary btn-primary--sm inline-form__submit"
            onClick={handleAdd}
            disabled={adding || !parentReady}
          >
            <IconPlus /> {adding ? 'Adding…' : 'Add Task'}
          </button>
        </div>

      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="masters-users__toolbar">
          <div className="masters-users__empty" style={{ padding: 0, textAlign: 'left', flex: 1 }}>
            {loading ? 'Loading…' : `${tasks.length} task${tasks.length === 1 ? '' : 's'} across ${groups.length} template/phase group${groups.length === 1 ? '' : 's'}.`}
          </div>
          <ExportButton filename="tasks" columns={exportColumns} rows={exportRows} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {!loading && groups.length === 0 && (
          <div className="masters-users__empty">No tasks yet. Add one above.</div>
        )}

        {groups.map((g) => (
          <div key={`${g.templateId}::${g.phase}`} className="task-group">
            <div className="task-group__head">
              <span className="task-group__template">{g.templateName}</span>
              <span className="task-group__phase">{phaseLabel(g.phase)}</span>
            </div>
            <ul className="task-list">
              {g.tasks.map((t) => (
                <li key={t.id} className="task-item">
                  <div className="task-item__row">
                    <span className="task-item__name">{t.name}</span>
                    <div className="task-item__actions">
                      <button
                        type="button"
                        className="btn-secondary btn-secondary--sm"
                        onClick={() => { setSubFor(subFor === t.id ? '' : t.id); setSubName(''); }}
                      >
                        <IconPlus /> Subtask
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => handleDelete(t)}
                        disabled={busyId === t.id}
                        aria-label={`Delete ${t.name}`}
                      >
                        <IconTrash />
                      </button>
                    </div>
                  </div>
                  {subFor === t.id && (
                    <>
                      <div className="subtask-inline">
                        <input
                          type="text"
                          value={subName}
                          onChange={(e) => { setSubName(e.target.value); if (subInlineError) setSubInlineError(''); }}
                          placeholder="Subtask name *"
                          autoFocus
                          aria-invalid={!!subInlineError}
                        />
                        <button
                          type="button"
                          className="btn-primary btn-primary--sm"
                          onClick={() => handleAddSubtaskToExisting(t)}
                          disabled={busyId === t.id}
                        >Add</button>
                        <button
                          type="button"
                          className="btn-secondary btn-secondary--sm"
                          onClick={() => { setSubFor(''); setSubName(''); setSubInlineError(''); }}
                        >Cancel</button>
                      </div>
                      {subInlineError && <div className="form-error-inline" style={{ paddingLeft: 8 }}>{subInlineError}</div>}
                    </>
                  )}
                  {t.subtasks.length > 0 && (
                    <ul className="task-list task-list--nested">
                      {t.subtasks.map((s) => (
                        <li key={s.id} className="task-item task-item--sub">
                          <div className="task-item__row">
                            <span className="task-item__name">{s.name}</span>
                            <button
                              type="button"
                              className="icon-btn icon-btn--danger"
                              onClick={() => handleDelete(s)}
                              disabled={busyId === s.id}
                              aria-label={`Delete subtask ${s.name}`}
                            >
                              <IconTrash />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
