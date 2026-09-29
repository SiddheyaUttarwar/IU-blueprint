import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { supabase } from '../../lib/supabaseClient.js';
import { listEmployeesByUniversity, listDesignations, filterEmployees, isUmsConfigured } from '../../services/ums.js';
import { enrollUmsEmployee } from '../../services/enrollment.js';
import ExportButton from '../../components/ExportButton.jsx';

const DEFAULT_UNIVERSITY_ID = 1;

// UMS integration is not deployed yet — replace the panel body with a coming-soon card so it's
// clear this tab isn't broken, it's paused. The real component follows below for when the API is wired.
// eslint-disable-next-line no-unused-vars
function UsersUmsPanelPending({ onEnrolledChange }) {  return (
    <div className="card" style={{ padding: 32, textAlign: 'center' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>
      <h3 style={{ marginTop: 0, marginBottom: 6 }}>UMS integration — coming soon</h3>
      <p className="form-hint" style={{ maxWidth: 480, margin: '0 auto' }}>
        Enrolling employees directly from the UMS directory will be available once the UMS API is
        deployed. Until then, please use <b>Add User</b> above to enrol users manually.
      </p>
    </div>
  );
}

export default function UsersUmsPanel(props) {
  return <UsersUmsPanelPending {...props} />;
}

// eslint-disable-next-line no-unused-vars
function UsersUmsPanelReal({ onEnrolledChange }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [employees, setEmployees] = useState([]);
  const [designations, setDesignations] = useState([]);
  const [enrolledEmails, setEnrolledEmails] = useState(new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyEmail, setBusyEmail] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const universityId = profile?.indira_university_id ?? DEFAULT_UNIVERSITY_ID;
        const [emps, desigs, { data: enrolled }] = await Promise.all([
          listEmployeesByUniversity(universityId),
          listDesignations(),
          supabase.from('profiles').select('email'),
        ]);
        if (cancelled) return;
        setEmployees(emps ?? []);
        setDesignations(desigs ?? []);
        setEnrolledEmails(new Set((enrolled ?? []).map((r) => r.email.toLowerCase())));
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load employees.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [profile?.indira_university_id]);

  const designationById = useMemo(
    () => Object.fromEntries((designations ?? []).map((d) => [d.id, d.name])),
    [designations],
  );

  const filtered = useMemo(() => filterEmployees(employees, query), [employees, query]);

  const exportColumns = [
    { key: 'name', label: 'Name', value: (r) => [r.firstName, r.middleName, r.lastName].filter(Boolean).join(' ') },
    { key: 'emailId', label: 'Email' },
    { key: 'designation', label: 'Designation', value: (r) => designationById[r.designationId] ?? '' },
    { key: 'enrolled', label: 'Enrolled', value: (r) => (enrolledEmails.has(r.emailId.toLowerCase()) ? 'Yes' : 'No') },
  ];

  async function handleEnroll(emp) {
    setBusyEmail(emp.emailId);
    setError('');
    try {
      await enrollUmsEmployee(emp);
      setEnrolledEmails((prev) => new Set(prev).add(emp.emailId.toLowerCase()));
      toast.success(`Enrolled ${emp.firstName} ${emp.lastName}. Invitation email sent.`);
      onEnrolledChange?.();
    } catch (err) {
      const msg = err.message || 'Enrollment failed.';
      setError(msg);
      toast.error(msg);
    } finally {
      setBusyEmail('');
    }
  }

  return (
    <div className="card">
      <div className="masters-users__toolbar">
        <input
          type="search"
          className="masters-users__search"
          placeholder="Search by name or email…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search users"
        />
        <ExportButton filename="ums-employees" columns={exportColumns} rows={filtered} />
      </div>

      {error && <div className="login-error" role="alert">{error}</div>}

      {loading ? (
        <div className="masters-users__empty">Loading employees…</div>
      ) : !isUmsConfigured() ? (
        <div className="masters-users__empty">
          UMS integration is not configured. Use <b>Add User</b> to enrol users manually until the UMS API is available.
        </div>
      ) : filtered.length === 0 ? (
        <div className="masters-users__empty">No employees match your search.</div>
      ) : (
        <table className="masters-users__table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Designation</th>
              <th className="masters-users__action-col">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => {
              const already = enrolledEmails.has(e.emailId.toLowerCase());
              const busy = busyEmail === e.emailId;
              return (
                <tr key={e.empId}>
                  <td>{[e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ')}</td>
                  <td>{e.emailId}</td>
                  <td>{designationById[e.designationId] ?? '—'}</td>
                  <td>
                    {already ? (
                      <span className="status-pill">Enrolled</span>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary btn-primary--sm"
                        onClick={() => handleEnroll(e)}
                        disabled={busy}
                      >
                        {busy ? 'Enrolling…' : 'Enroll'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
