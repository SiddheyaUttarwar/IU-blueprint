import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import { listEnrolledProfiles, updateProfileRoles, ROLE_LABELS } from '../../services/roles.js';
import ExportButton from '../../components/ExportButton.jsx';
import ChangeRoleModal from '../../components/ChangeRoleModal.jsx';

function displayRoles(profile) {
  const list = (profile.roles?.length ? profile.roles : [profile.role].filter(Boolean));
  return list.map((r) => ROLE_LABELS[r] ?? r);
}

export default function UsersEnrolledPanel({ reloadKey }) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listEnrolledProfiles();
      setRows(data);
    } catch (err) {
      setError(err.message || 'Failed to load enrolled users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const name = [r.first_name, r.last_name].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || (r.email ?? '').toLowerCase().includes(q);
    });
  }, [rows, query]);

  const exportColumns = [
    { key: 'name', label: 'Name', value: (r) => [r.first_name, r.last_name].filter(Boolean).join(' ') },
    { key: 'email', label: 'Email' },
    { key: 'roles', label: 'Roles', value: (r) => displayRoles(r).join('; ') },
    { key: 'status', label: 'Status', value: (r) => (r.first_login_at ? 'Active' : 'Invited') },
    { key: 'source', label: 'Source', value: (r) => r.source ?? '' },
    { key: 'enrolled_at', label: 'Enrolled At' },
    { key: 'first_login_at', label: 'First Login At' },
  ];

  async function handleSaveRoles(nextRoles) {
    setSaving(true);
    try {
      const updated = await updateProfileRoles(editing.id, nextRoles);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      toast.success(`Roles updated for ${editing.email}.`);
      setEditing(null);
    } catch (err) {
      toast.error(err.message || 'Failed to update roles.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="masters-users__toolbar">
          <input
            type="search"
            className="masters-users__search"
            placeholder="Search enrolled users…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search enrolled users"
          />
          <ExportButton filename="enrolled-users" columns={exportColumns} rows={filtered} />
        </div>

        {error && <div className="login-error" role="alert">{error}</div>}

        {loading ? (
          <div className="masters-users__empty">Loading enrolled users…</div>
        ) : filtered.length === 0 ? (
          <div className="masters-users__empty">No enrolled users match your search.</div>
        ) : (
          <table className="masters-users__table table--responsive">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Roles</th>
                <th>Status</th>
                <th>First Login</th>
                <th className="masters-users__action-col">Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || '—';
                const status = r.first_login_at ? 'Active' : 'Invited';
                return (
                  <tr key={r.id}>
                    <td data-label="Name">{name}</td>
                    <td data-label="Email">{r.email}</td>
                    <td data-label="Roles">
                      <span className="role-chips">
                        {displayRoles(r).map((label) => (
                          <span key={label} className="role-chip">{label}</span>
                        ))}
                      </span>
                    </td>
                    <td data-label="Status">
                      <span className={`status-pill status-pill--${status === 'Active' ? 'active' : 'planning'}`}>{status}</span>
                    </td>
                    <td data-label="First Login">{r.first_login_at ? new Date(r.first_login_at).toLocaleDateString() : '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn-secondary btn-secondary--sm"
                        onClick={() => setEditing(r)}
                      >
                        Change Role
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ChangeRoleModal
        open={!!editing}
        profile={editing}
        onCancel={() => setEditing(null)}
        onSave={handleSaveRoles}
        busy={saving}
      />
    </>
  );
}
