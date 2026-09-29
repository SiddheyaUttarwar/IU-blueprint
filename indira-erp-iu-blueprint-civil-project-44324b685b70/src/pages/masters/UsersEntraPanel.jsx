import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { searchEntraDirectory } from '../../services/entra.js';
import { enrollManualUser } from '../../services/enrollment.js';
import AddUserModal from '../../components/AddUserModal.jsx';

export default function UsersEntraPanel({ onEnrolledChange }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [enrolledEmails, setEnrolledEmails] = useState(new Set());
  const [existingEmails, setExistingEmails] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addPrefill, setAddPrefill] = useState(null);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('profiles').select('email');
      if (cancelled) return;
      const rows = (data ?? []).map((r) => (r.email || '').toLowerCase()).filter(Boolean);
      setEnrolledEmails(new Set(rows));
      setExistingEmails(rows);
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced search — fires 350 ms after the user stops typing.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) { setResults([]); setError(''); return; }
    debounceRef.current = setTimeout(async () => {
      setLoading(true); setError('');
      try {
        const list = await searchEntraDirectory(query);
        setResults(list);
      } catch (err) {
        setError(err.message || 'Directory search failed.');
        setResults([]);
      } finally { setLoading(false); }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const enrolledSet = useMemo(() => enrolledEmails, [enrolledEmails]);

  function openEnroll(user) {
    setAddPrefill({
      email: user.mail || user.userPrincipalName || '',
      firstName: user.givenName || (user.displayName?.split(' ')[0] ?? ''),
      lastName: user.surname || (user.displayName?.split(' ').slice(1).join(' ') ?? ''),
      mobileNumber: user.mobilePhone || '',
      // roles default to member in the modal; admin can adjust before saving.
    });
    setAddOpen(true);
  }

  async function handleAdd(payload) {
    setSaving(true);
    try {
      await enrollManualUser({
        email: payload.email,
        firstName: payload.firstName,
        lastName: payload.lastName,
        mobileNumber: payload.mobileNumber,
        roles: payload.roles,
      });
      const em = (payload.email || '').toLowerCase();
      setEnrolledEmails((prev) => new Set(prev).add(em));
      setExistingEmails((prev) => [...prev, em]);
      toast.success(`Invite sent to ${payload.email}.`);
      setAddOpen(false);
      setAddPrefill(null);
      onEnrolledChange?.();
    } catch (err) {
      toast.error(err.message || 'Failed to enroll user.');
    } finally { setSaving(false); }
  }

  return (
    <div className="card">
      <div className="masters-users__toolbar">
        <input
          type="search"
          className="masters-users__search"
          placeholder="Search Entra directory by name, email, or UPN (min 2 chars)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search directory"
          autoFocus
        />
      </div>

      {error && <div className="login-error" role="alert" style={{ marginBottom: 8 }}>{error}</div>}
      {loading && <div className="masters-users__empty">Searching…</div>}
      {!loading && query.trim().length >= 2 && results.length === 0 && !error && (
        <div className="masters-users__empty">No matching users in the directory.</div>
      )}
      {query.trim().length < 2 && (
        <div className="masters-users__empty">Type at least 2 characters to search.</div>
      )}

      {results.length > 0 && (
        <table className="masters-users__table">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Sr. No.</th>
              <th>Name</th>
              <th>Email</th>
              <th>Title / Dept</th>
              <th>Mobile</th>
              <th className="masters-users__action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            {results.map((u, i) => {
              const email = (u.mail || u.userPrincipalName || '').toLowerCase();
              const enrolled = enrolledSet.has(email);
              return (
                <tr key={u.id}>
                  <td>{i + 1}</td>
                  <td>{u.displayName || '—'}</td>
                  <td>{u.mail || u.userPrincipalName || '—'}</td>
                  <td>
                    {u.jobTitle && <div>{u.jobTitle}</div>}
                    {u.department && <div className="form-hint">{u.department}</div>}
                  </td>
                  <td>{u.mobilePhone || '—'}</td>
                  <td>
                    {enrolled ? (
                      <span className="status-pill" style={{ background: '#e6f4ea', color: '#166534' }}>Enrolled</span>
                    ) : (
                      <button
                        type="button" className="btn-primary btn-primary--sm"
                        onClick={() => openEnroll(u)}
                        disabled={!profile}
                      >
                        Enroll
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <AddUserModal
        open={addOpen}
        existingEmails={existingEmails}
        prefill={addPrefill}
        onCancel={() => { setAddOpen(false); setAddPrefill(null); }}
        onSave={handleAdd}
        busy={saving}
      />
    </div>
  );
}
