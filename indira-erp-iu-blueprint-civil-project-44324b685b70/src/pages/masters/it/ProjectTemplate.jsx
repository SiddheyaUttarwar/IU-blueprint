import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../../context/AuthContext.jsx';
import { useToast } from '../../../context/ToastContext.jsx';
import { listProjectTypes } from '../../../services/projectTypes.js';
import { listProjectTemplates, createProjectTemplate, removeProjectTemplate } from '../../../services/projectTemplates.js';
import ExportButton from '../../../components/ExportButton.jsx';
import { IconPlus, IconTrash } from '../../../components/Icons.jsx';
import RequiredMark from '../../../components/RequiredMark.jsx';
import BackButton from '../../../components/BackButton.jsx';

export default function ProjectTemplate() {
  const { profile } = useAuth();
  const toast = useToast();
  const [templates, setTemplates] = useState([]);
  const [types, setTypes] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [typeId, setTypeId] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [nameError, setNameError] = useState('');
  const [typeError, setTypeError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [t, ty] = await Promise.all([listProjectTemplates(), listProjectTypes()]);
        if (cancelled) return;
        setTemplates(t);
        setTypes(ty);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load templates.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const activeTypes = useMemo(() => types.filter((t) => t.is_active), [types]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const typeName = t.project_types?.name ?? '';
      return t.name.toLowerCase().includes(q) || typeName.toLowerCase().includes(q);
    });
  }, [templates, query]);

  const exportColumns = [
    { key: 'srno', label: 'Sr.No', value: (_r, i) => i + 1 },
    { key: 'name', label: 'Project Template Name' },
    { key: 'type', label: 'Project Type', value: (r) => r.project_types?.name ?? '' },
    { key: 'usage', label: 'Projects using it', value: () => 0 },
  ];
  const exportRows = filtered.map((r, i) => ({ ...r, __i: i }));
  const exportColumnsIndexed = exportColumns.map((c) => ({
    ...c,
    value: c.value ? (r) => c.value(r, r.__i ?? 0) : undefined,
  }));

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = name.trim();
    let bad = false;
    if (!trimmed) { setNameError('Template name is required.'); bad = true; } else setNameError('');
    if (!typeId) { setTypeError('Project type is required.'); bad = true; } else setTypeError('');
    if (bad) return;
    if (templates.some((t) => t.name.toLowerCase() === trimmed.toLowerCase())) {
      setNameError('A template with this name already exists.');
      return;
    }
    setAdding(true);
    try {
      const created = await createProjectTemplate({ name, projectTypeId: typeId, createdBy: profile?.id });
      setTemplates((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`Added template: ${created.name}`);
      setName('');
      setTypeId('');
    } catch (err) {
      toast.error(err.message || 'Failed to add template.');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete template "${row.name}"?`)) return;
    setBusyId(row.id);
    try {
      await removeProjectTemplate(row.id);
      setTemplates((prev) => prev.filter((t) => t.id !== row.id));
      toast.success(`Deleted ${row.name}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete.');
    } finally {
      setBusyId('');
    }
  }

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Project Template</h2>

      <div className="card">
        <form onSubmit={handleAdd} className="inline-form">
          <label className={`inline-form__field${nameError ? ' inline-form__field--invalid' : ''}`}>
            <span>Template Name<RequiredMark /></span>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
              placeholder="e.g. Residential Building"
              maxLength={100}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? 'tpl-name-err' : undefined}
            />
            {nameError && <span id="tpl-name-err" className="form-error-inline">{nameError}</span>}
          </label>
          <label className={`inline-form__field${typeError ? ' inline-form__field--invalid' : ''}`}>
            <span>Project Type<RequiredMark /></span>
            <select
              value={typeId}
              onChange={(e) => { setTypeId(e.target.value); if (typeError) setTypeError(''); }}
              aria-invalid={!!typeError}
              aria-describedby={typeError ? 'tpl-type-err' : undefined}
            >
              <option value="">Select project type…</option>
              {activeTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            {typeError && <span id="tpl-type-err" className="form-error-inline">{typeError}</span>}
          </label>
          <button
            type="submit"
            className="btn-primary btn-primary--sm inline-form__submit"
            disabled={adding}
          >
            <IconPlus /> {adding ? 'Adding…' : 'Add Template'}
          </button>
        </form>
        {activeTypes.length === 0 && !loading && (
          <div className="login-info" style={{ marginTop: 12 }}>
            No active project types available. Add or activate one in Masters → Project Type first.
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="masters-users__toolbar">
          <input
            type="search"
            className="masters-users__search"
            placeholder="Search by template or type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search templates"
          />
          <ExportButton filename="project-templates" columns={exportColumnsIndexed} rows={exportRows} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {loading ? (
          <div className="masters-users__empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="masters-users__empty">No templates yet. Add one above.</div>
        ) : (
          <table className="masters-users__table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Sr.No</th>
                <th>Project Template Name</th>
                <th>Project Type</th>
                <th>Projects using it</th>
                <th className="masters-users__action-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>{r.project_types?.name ?? '—'}</td>
                    <td>0</td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => handleDelete(r)}
                        disabled={busy}
                        aria-label={`Delete ${r.name}`}
                        title="Delete"
                      >
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
