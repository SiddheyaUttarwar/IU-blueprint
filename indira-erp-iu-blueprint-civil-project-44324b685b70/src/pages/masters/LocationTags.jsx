import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { listSchools } from '../../services/schools.js';
import { listCampuses } from '../../services/campuses.js';
import {
  listLocationTags, createLocationTag, updateLocationTagActive, removeLocationTag,
} from '../../services/locationTags.js';
import { IconPlus, IconTrash } from '../../components/Icons.jsx';
import RequiredMark from '../../components/RequiredMark.jsx';
import BackButton from '../../components/BackButton.jsx';

export default function LocationTags() {
  const { profile } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [schools, setSchools] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [campusId, setCampusId] = useState('');
  const [schoolId, setSchoolId] = useState('');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const [tags, ss, cs] = await Promise.all([listLocationTags(), listSchools(), listCampuses()]);
        if (!cancelled) { setRows(tags); setSchools(ss); setCampuses(cs); }
      } catch (err) { if (!cancelled) setError(err.message || 'Failed to load.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const activeCampuses = useMemo(() => campuses.filter((c) => c.is_active), [campuses]);
  const schoolsForCampus = useMemo(() =>
    schools.filter((s) => s.is_active && (!campusId || s.campus_id === campusId)),
    [schools, campusId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const s = r.schools?.name?.toLowerCase() ?? '';
      const c = r.schools?.campuses?.name?.toLowerCase() ?? '';
      return r.name.toLowerCase().includes(q) || s.includes(q) || c.includes(q);
    });
  }, [rows, query]);

  async function handleAdd(e) {
    e.preventDefault();
    if (!name.trim()) { toast.error('Name is required.'); return; }
    if (!schoolId) { toast.error('Select a school.'); return; }
    setAdding(true);
    try {
      const created = await createLocationTag({ name, schoolId, createdBy: profile?.id });
      setRows((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setName(''); setSchoolId(''); setCampusId('');
      toast.success(`Location tag "${created.name}" added.`);
    } catch (err) { toast.error(err.message || 'Failed to add.'); }
    finally { setAdding(false); }
  }

  async function toggleActive(row) {
    setBusyId(row.id);
    try {
      const updated = await updateLocationTagActive(row.id, !row.is_active);
      setRows((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusyId(''); }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete location tag "${row.name}"?`)) return;
    setBusyId(row.id);
    try {
      await removeLocationTag(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success('Deleted.');
    } catch (err) { toast.error(err.message || 'Failed.'); }
    finally { setBusyId(''); }
  }

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Location Tags</h2>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Third level under Campus → School. Used on Create Project (optional) to tag a project's location.
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <form onSubmit={handleAdd} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
          <label className="login-field">
            <span>Campus<RequiredMark /></span>
            <select value={campusId} onChange={(e) => { setCampusId(e.target.value); setSchoolId(''); }} required>
              <option value="">Select campus…</option>
              {activeCampuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="login-field">
            <span>School<RequiredMark /></span>
            <select value={schoolId} onChange={(e) => setSchoolId(e.target.value)} required disabled={!campusId}>
              <option value="">{campusId ? 'Select school…' : 'Pick a campus first'}</option>
              {schoolsForCampus.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="login-field">
            <span>Tag name<RequiredMark /></span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Block A, Ground Floor" maxLength={80} />
          </label>
          <button type="submit" className="btn-primary btn-primary--sm" disabled={adding}>
            <IconPlus /> {adding ? 'Adding…' : 'Add tag'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="masters-users__toolbar">
          <input type="search" className="masters-users__search"
            placeholder="Search tags, schools, campuses…"
            value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}
        {loading ? <div className="masters-users__empty">Loading…</div>
          : filtered.length === 0 ? <div className="masters-users__empty">No location tags. Add one above.</div>
          : (
            <table className="masters-users__table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Sr.</th>
                  <th>Tag</th>
                  <th>School</th>
                  <th>Campus</th>
                  <th style={{ width: 100 }}>Active</th>
                  <th className="masters-users__action-col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td><b>{r.name}</b></td>
                    <td>{r.schools?.name ?? '—'}</td>
                    <td>{r.schools?.campuses?.name ?? '—'}</td>
                    <td>
                      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                        <input type="checkbox" checked={r.is_active} onChange={() => toggleActive(r)} disabled={busyId === r.id} />
                        <span className="form-hint">{r.is_active ? 'Yes' : 'No'}</span>
                      </label>
                    </td>
                    <td>
                      <button type="button" className="icon-btn icon-btn--danger" onClick={() => handleDelete(r)} disabled={busyId === r.id} aria-label={`Delete ${r.name}`}>
                        <IconTrash />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}
