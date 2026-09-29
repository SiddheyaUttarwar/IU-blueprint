import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { listProjectTemplates } from '../../../services/projectTemplates.js';
import { listMilestones, createMilestone, removeMilestone } from '../../../services/milestones.js';
import { PHASES, phaseLabel } from '../../../services/tasks.js';
import ExportButton from '../../../components/ExportButton.jsx';
import RequiredMark from '../../../components/RequiredMark.jsx';
import { IconPlus, IconTrash } from '../../../components/Icons.jsx';
import BackButton from '../../../components/BackButton.jsx';

function groupMilestones(all) {
  const groups = new Map();
  for (const m of all) {
    const key = `${m.project_template_id}::${m.phase}`;
    if (!groups.has(key)) {
      groups.set(key, {
        templateId: m.project_template_id,
        templateName: m.project_templates?.name ?? '—',
        phase: m.phase,
        items: [],
      });
    }
    groups.get(key).items.push(m);
  }
  return [...groups.values()].sort((a, b) => {
    const t = a.templateName.localeCompare(b.templateName);
    if (t !== 0) return t;
    return a.phase.localeCompare(b.phase);
  });
}

export default function Milestone() {
  const { profile } = useAuth();
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [templateId, setTemplateId] = useState('');
  const [phase, setPhase] = useState('pre_project');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [errors, setErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [tpls, ms] = await Promise.all([listProjectTemplates(), listMilestones()]);
        if (cancelled) return;
        setTemplates(tpls);
        setRows(ms);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load milestones.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const groups = useMemo(() => groupMilestones(rows), [rows]);

  const exportRows = useMemo(
    () => rows.map((r) => ({
      template: r.project_templates?.name ?? '',
      phase: phaseLabel(r.phase),
      milestone: r.name,
    })),
    [rows],
  );
  const exportColumns = [
    { key: 'template', label: 'Project Template' },
    { key: 'phase', label: 'Phase' },
    { key: 'milestone', label: 'Milestone' },
  ];

  function validate() {
    const next = {};
    if (!templateId) next.templateId = 'Project template is required.';
    if (!phase) next.phase = 'Project phase is required.';
    if (!name.trim()) next.name = 'Milestone name is required.';
    if (!next.name && !next.templateId && !next.phase) {
      const dup = rows.some((r) =>
        r.project_template_id === templateId
        && r.phase === phase
        && r.name.toLowerCase() === name.trim().toLowerCase()
      );
      if (dup) next.name = 'A milestone with this name already exists in this template & phase.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleAdd(e) {
    e.preventDefault();
    if (!validate()) return;
    setAdding(true);
    try {
      const created = await createMilestone({ templateId, phase, name, createdBy: profile?.id });
      setRows((prev) => [...prev, created]);
      toast.success(`Added milestone: ${created.name}`);
      setName('');
      setErrors({});
    } catch (err) {
      toast.error(err.message || 'Failed to add milestone.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(m) {
    if (!window.confirm(`Delete milestone "${m.name}"?`)) return;
    setBusyId(m.id);
    try {
      await removeMilestone(m.id);
      setRows((prev) => prev.filter((r) => r.id !== m.id));
      toast.success(`Deleted ${m.name}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Milestone</h2>

      <div className="card">
        <form onSubmit={handleAdd} className="inline-form" noValidate>
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
            <span>Milestone Name<RequiredMark /></span>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (errors.name) setErrors((p) => ({ ...p, name: undefined })); }}
              placeholder="e.g. Foundation completed"
              maxLength={140}
              aria-invalid={!!errors.name}
            />
            {errors.name && <span className="form-error-inline">{errors.name}</span>}
          </label>
          <button
            type="submit"
            className="btn-primary btn-primary--sm inline-form__submit"
            disabled={adding}
          >
            <IconPlus /> {adding ? 'Adding…' : 'Add Milestone'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="masters-users__toolbar">
          <div className="masters-users__empty" style={{ padding: 0, textAlign: 'left', flex: 1 }}>
            {loading ? 'Loading…' : `${rows.length} milestone${rows.length === 1 ? '' : 's'} across ${groups.length} template/phase group${groups.length === 1 ? '' : 's'}.`}
          </div>
          <ExportButton filename="milestones" columns={exportColumns} rows={exportRows} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {!loading && groups.length === 0 && (
          <div className="masters-users__empty">No milestones yet. Add one above.</div>
        )}

        {groups.map((g) => (
          <div key={`${g.templateId}::${g.phase}`} className="task-group">
            <div className="task-group__head">
              <span className="task-group__template">{g.templateName}</span>
              <span className="task-group__phase">{phaseLabel(g.phase)}</span>
            </div>
            <ul className="task-list">
              {g.items.map((m) => (
                <li key={m.id} className="task-item">
                  <div className="task-item__row">
                    <span className="task-item__name">{m.name}</span>
                    <button
                      type="button"
                      className="icon-btn icon-btn--danger"
                      onClick={() => handleDelete(m)}
                      disabled={busyId === m.id}
                      aria-label={`Delete milestone ${m.name}`}
                    >
                      <IconTrash />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </>
  );
}
