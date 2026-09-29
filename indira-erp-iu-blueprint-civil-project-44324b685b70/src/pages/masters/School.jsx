import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { listCampuses } from '../../services/campuses.js';
import {
  listSchools, createSchool, updateSchoolActive, removeSchool,
} from '../../services/schools.js';
import ExportButton from '../../components/ExportButton.jsx';
import { IconPlus, IconTrash } from '../../components/Icons.jsx';
import RequiredMark from '../../components/RequiredMark.jsx';
import BackButton from '../../components/BackButton.jsx';

export default function School() {
  const { profile } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [campusId, setCampusId] = useState('');
  const [active, setActive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [nameError, setNameError] = useState('');
  const [campusError, setCampusError] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [s, c] = await Promise.all([listSchools(), listCampuses()]);
        if (!cancelled) {
          setRows(s);
          setCampuses(c);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load schools.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const activeCampuses = useMemo(() => campuses.filter((c) => c.is_active), [campuses]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const campusName = r.campuses?.name ?? '';
      return r.name.toLowerCase().includes(q) || campusName.toLowerCase().includes(q);
    });
  }, [rows, query]);

  const exportColumns = [
    { key: 'name', label: 'School' },
    { key: 'campus', label: 'Campus', value: (r) => r.campuses?.name ?? '' },
    { key: 'is_active', label: 'Status', value: (r) => (r.is_active ? 'Active' : 'Inactive') },
  ];

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = name.trim();
    let bad = false;
    if (!trimmed) { setNameError('School name is required.'); bad = true; } else setNameError('');
    if (!campusId) { setCampusError('Campus is required.'); bad = true; } else setCampusError('');
    if (bad) return;
    if (rows.some((r) => r.campus_id === campusId && r.name.toLowerCase() === trimmed.toLowerCase())) {
      setNameError('A school with this name already exists in the selected campus.');
      return;
    }
    setAdding(true);
    try {
      const created = await createSchool({ name: trimmed, campusId, isActive: active, createdBy: profile?.id });
      setRows((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      toast.success(`Added school: ${created.name}`);
      setName('');
      setCampusId('');
      setActive(true);
    } catch (err) {
      toast.error(err.message || 'Failed to add school.');
    } finally {
      setAdding(false);
    }
  }

  async function handleToggle(row) {
    setBusyId(row.id);
    try {
      const updated = await updateSchoolActive(row.id, !row.is_active);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(`${updated.name} is now ${updated.is_active ? 'Active' : 'Inactive'}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to update.');
    } finally {
      setBusyId('');
    }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete school "${row.name}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      await removeSchool(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
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
      <h2 className="page-title">School</h2>

      <div className="card">
        <form onSubmit={handleAdd} className="inline-form">
          <label className={`inline-form__field${campusError ? ' inline-form__field--invalid' : ''}`}>
            <span>Campus<RequiredMark /></span>
            <select
              value={campusId}
              onChange={(e) => { setCampusId(e.target.value); if (campusError) setCampusError(''); }}
              aria-invalid={!!campusError}
            >
              <option value="">Select campus…</option>
              {activeCampuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {campusError && <span className="form-error-inline">{campusError}</span>}
          </label>
          <label className={`inline-form__field${nameError ? ' inline-form__field--invalid' : ''}`}>
            <span>School Name<RequiredMark /></span>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
              placeholder="e.g. School of Engineering"
              maxLength={120}
              aria-invalid={!!nameError}
            />
            {nameError && <span className="form-error-inline">{nameError}</span>}
          </label>
          <label className="inline-form__checkbox">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Active</span>
          </label>
          <button type="submit" className="btn-primary btn-primary--sm inline-form__submit" disabled={adding}>
            <IconPlus /> {adding ? 'Adding…' : 'Add School'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="masters-users__toolbar">
          <input
            type="search"
            className="masters-users__search"
            placeholder="Search schools or campus…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search schools"
          />
          <ExportButton filename="schools" columns={exportColumns} rows={filtered} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {loading ? (
          <div className="masters-users__empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="masters-users__empty">No schools yet. Add one above.</div>
        ) : (
          <table className="masters-users__table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Sr. No.</th>
                <th>School</th>
                <th>Campus</th>
                <th>Status</th>
                <th className="masters-users__action-col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const busy = busyId === r.id;
                return (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td>{r.name}</td>
                    <td>{r.campuses?.name ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className={`status-toggle${r.is_active ? ' is-active' : ''}`}
                        onClick={() => handleToggle(r)}
                        disabled={busy}
                        aria-pressed={r.is_active}
                      >
                        {r.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-btn icon-btn--danger"
                        onClick={() => handleDelete(r)}
                        disabled={busy}
                        aria-label={`Delete ${r.name}`}
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
