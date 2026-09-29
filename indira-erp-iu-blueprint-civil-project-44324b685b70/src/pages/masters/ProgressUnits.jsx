import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  listProgressUnits, createProgressUnit, updateProgressUnit, removeProgressUnit,
} from '../../services/progressUnits.js';
import ExportButton from '../../components/ExportButton.jsx';
import { IconPlus, IconTrash } from '../../components/Icons.jsx';
import RequiredMark from '../../components/RequiredMark.jsx';
import BackButton from '../../components/BackButton.jsx';

export default function ProgressUnits() {
  const { profile } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const data = await listProgressUnits();
        if (!cancelled) setRows(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load units.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  const exportColumns = [
    { key: 'name', label: 'Unit' },
    { key: 'is_active', label: 'Status', value: (r) => (r.is_active ? 'Active' : 'Inactive') },
  ];

  async function handleAdd(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) { setNameError('Unit name is required.'); return; }
    if (rows.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
      setNameError('A unit with this name already exists.');
      return;
    }
    setNameError('');
    setAdding(true);
    try {
      const created = await createProgressUnit({ name: trimmed, isActive: active, createdBy: profile?.id });
      setRows((prev) => [...prev, created].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name)));
      toast.success(`Added unit: ${created.name}`);
      setName(''); setActive(true);
    } catch (err) {
      toast.error(err.message || 'Failed to add unit.');
    } finally { setAdding(false); }
  }

  async function handleToggle(row) {
    setBusyId(row.id);
    try {
      const updated = await updateProgressUnit(row.id, { is_active: !row.is_active });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      toast.success(`${updated.name} is now ${updated.is_active ? 'Active' : 'Inactive'}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to update.');
    } finally { setBusyId(''); }
  }

  async function handleDelete(row) {
    if (!window.confirm(`Delete unit "${row.name}"? Tasks and items already using it will keep their value as free text.`)) return;
    setBusyId(row.id);
    try {
      await removeProgressUnit(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      toast.success(`Deleted ${row.name}.`);
    } catch (err) {
      toast.error(err.message || 'Failed to delete.');
    } finally { setBusyId(''); }
  }

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Progress Units (Quantity Based)</h2>

      <div className="card">
        <div className="form-hint" style={{ marginBottom: 8 }}>
          These units appear in the Indent item picker and the Progress Metric (Quantity Based) modal.
          Deactivate to hide from pickers without deleting existing data.
        </div>
        <form onSubmit={handleAdd} className="inline-form">
          <label className={`inline-form__field${nameError ? ' inline-form__field--invalid' : ''}`}>
            <span>Unit Name<RequiredMark /></span>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError(''); }}
              placeholder="e.g. Nos, m³, sq.ft"
              maxLength={20}
              aria-invalid={!!nameError}
            />
            {nameError && <span className="form-error-inline">{nameError}</span>}
          </label>
          <label className="inline-form__checkbox">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Active</span>
          </label>
          <button type="submit" className="btn-primary btn-primary--sm inline-form__submit" disabled={adding}>
            <IconPlus /> {adding ? 'Adding…' : 'Add Unit'}
          </button>
        </form>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="masters-users__toolbar">
          <input
            type="search"
            className="masters-users__search"
            placeholder="Search units…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search units"
          />
          <ExportButton filename="progress-units" columns={exportColumns} rows={filtered} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {loading ? (
          <div className="masters-users__empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="masters-users__empty">No units yet. Add one above.</div>
        ) : (
          <table className="masters-users__table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>Sr. No.</th>
                <th>Unit</th>
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
                    <td>
                      <button
                        type="button"
                        className={`status-toggle${r.is_active ? ' is-active' : ''}`}
                        onClick={() => handleToggle(r)}
                        disabled={busy}
                        aria-pressed={r.is_active}
                        title="Toggle active/inactive"
                      >
                        {r.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </td>
                    <td>
                      <button
                        type="button" className="icon-btn icon-btn--danger"
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
