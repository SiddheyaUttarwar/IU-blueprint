import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { listProjectTypes } from '../../services/projectTypes.js';
import { listProjectTemplates, createProjectTemplate, removeProjectTemplate } from '../../services/projectTemplates.js';
import ExportButton from '../../components/ExportButton.jsx';
import AddProjectTemplateModal from '../../components/AddProjectTemplateModal.jsx';
import VersionsListModal from '../../components/VersionsListModal.jsx';
import BackButton from '../../components/BackButton.jsx';
import { IconPlus, IconTrash, IconEye } from '../../components/Icons.jsx';

export default function ProjectTemplates() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [types, setTypes] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [versionsTemplate, setVersionsTemplate] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [tpls, tp] = await Promise.all([
        listProjectTemplates(),
        listProjectTypes(),
      ]);
      setTemplates(tpls);
      setTypes(tp);
    } catch (err) {
      setError(err.message || 'Failed to load templates.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);


  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) => {
      const type = t.project_types?.name ?? '';
      return t.name.toLowerCase().includes(q)
        || type.toLowerCase().includes(q);
    });
  }, [templates, query]);

  const exportRows = filtered.map((t, i) => ({ ...t, __i: i }));
  const exportColumns = [
    { key: 'srno', label: 'Sr.No', value: (r) => r.__i + 1 },
    { key: 'name', label: 'Template Name' },
    { key: 'type', label: 'Project Type', value: (r) => r.project_types?.name ?? '' },
    { key: 'version', label: 'Latest Version', value: (r) => (r.latest_version ? `v${r.latest_version.version_no}` : '') },
    { key: 'created_at', label: 'Created At' },
  ];

  async function handleSave(payload) {
    setSaving(true);
    try {
      await createProjectTemplate({ ...payload, createdBy: profile?.id });
      toast.success(
        payload.isDraft
          ? `Draft template "${payload.name}" saved.`
          : `Template "${payload.name}" created (v1).`
      );
      setModalOpen(false);
      await load();
    } catch (err) {
      toast.error(err.message || 'Failed to save template.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(t) {
    if (!window.confirm(`Delete template "${t.name}" and all its versions? This cannot be undone.`)) return;
    setBusyId(t.id);
    try {
      await removeProjectTemplate(t.id);
      setTemplates((prev) => prev.filter((x) => x.id !== t.id));
      toast.success(`Deleted ${t.name}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete.');
    } finally {
      setBusyId('');
    }
  }

  const existingNames = useMemo(() => templates.map((t) => t.name), [templates]);

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Project Templates</h2>

      <div className="card">
        <div className="masters-users__toolbar">
          <input
            type="search"
            className="masters-users__search"
            placeholder="Search by name or type…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search project templates"
          />
          <button type="button" className="btn-primary btn-primary--sm" onClick={() => setModalOpen(true)}>
            <IconPlus /> Add Project Template
          </button>
          <ExportButton filename="project-templates" columns={exportColumns} rows={exportRows} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {loading ? (
          <div className="masters-users__empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="masters-users__empty">No templates. Click <b>Add Project Template</b> to create one.</div>
        ) : (
          <table className="masters-users__table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Sr. No.</th>
                <th>Template Name</th>
                <th>Project Type</th>
                <th>Latest Version</th>
                <th className="masters-users__action-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((t, i) => {
                const busy = busyId === t.id;
                const ver = t.latest_version;
                return (
                  <tr key={t.id}>
                    <td>{i + 1}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {t.name}
                        {t.is_draft && <span className="draft-chip">Draft</span>}
                      </div>
                      {t.description && <div className="template-desc">{t.description}</div>}
                    </td>
                    <td>{t.project_types?.name ?? '—'}</td>
                    <td>
                      {ver ? (
                        <div className="row-actions" style={{ gap: 6 }}>
                          <span className="version-pill">v{ver.version_no}</span>
                          {(t.all_versions?.length ?? 0) > 0 && (
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={() => setVersionsTemplate(t)}
                              aria-label={`See all versions of ${t.name}`}
                              title="See all versions"
                            >
                              <IconEye />
                            </button>
                          )}
                        </div>
                      ) : '—'}
                    </td>
                    <td>
                      <div className="row-actions">
                        <Link
                          to={`/masters/project-templates/${t.id}/build`}
                          className="btn-secondary btn-secondary--sm"
                        >
                          Build Structure
                        </Link>
                        <button
                          type="button"
                          className="icon-btn icon-btn--danger"
                          onClick={() => handleDelete(t)}
                          disabled={busy}
                          aria-label={`Delete ${t.name}`}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <AddProjectTemplateModal
        open={modalOpen}
        projectTypes={types}
        existingNames={existingNames}
        onCancel={() => setModalOpen(false)}
        onSave={handleSave}
        busy={saving}
      />

      <VersionsListModal
        open={!!versionsTemplate}
        template={versionsTemplate}
        onCancel={() => setVersionsTemplate(null)}
        onSelect={(v) => {
          navigate(`/masters/project-templates/${versionsTemplate.id}/build?v=${v.id}`);
          setVersionsTemplate(null);
        }}
      />
    </>
  );
}
