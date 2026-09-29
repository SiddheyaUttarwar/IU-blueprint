import { useEffect, useState } from 'react';
import BackButton from '../../components/BackButton.jsx';
import { listNotificationModules } from '../../services/notificationPrefs.js';

export default function NotificationModulesAdmin() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listNotificationModules();
        if (!cancelled) setRows(list);
      } catch (err) { if (!cancelled) setError(err.message || 'Failed to load.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <h2 className="page-title">Notification Modules</h2>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Modules users can opt into for email notifications. Seeded via SQL migration.
        Toggle a module's active flag from the DB to hide it from user Settings.
      </div>
      <div className="card">
        {loading ? <div className="masters-users__empty">Loading…</div>
          : error ? <div className="login-error">{error}</div>
          : (
            <table className="masters-users__table">
              <thead>
                <tr><th>#</th><th>Key</th><th>Name</th><th>Description</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td><code>{r.key}</code></td>
                    <td><b>{r.name}</b></td>
                    <td>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}
