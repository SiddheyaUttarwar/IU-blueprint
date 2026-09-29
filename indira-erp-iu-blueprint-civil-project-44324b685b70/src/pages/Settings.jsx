import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listNotificationModules, listPrefsForUser, setPref } from '../services/notificationPrefs.js';

export default function Settings() {
  const { profile } = useAuth();
  const toast = useToast();
  const [modules, setModules] = useState([]);
  const [prefs, setPrefs] = useState(new Map()); // module_id → { enabled }
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!profile?.id) { setLoading(false); return; }
      try {
        const [mods, prefMap] = await Promise.all([
          listNotificationModules(),
          listPrefsForUser(profile.id),
        ]);
        if (!cancelled) { setModules(mods); setPrefs(prefMap); }
      } catch (err) { if (!cancelled) toast.error(err.message || 'Failed to load prefs.'); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [profile?.id, toast]);

  async function toggle(moduleId, enabled) {
    setBusy(moduleId);
    try {
      const saved = await setPref(profile.id, moduleId, enabled);
      setPrefs((prev) => { const next = new Map(prev); next.set(moduleId, saved); return next; });
    } catch (err) { toast.error(err.message || 'Failed to save.'); }
    finally { setBusy(''); }
  }

  // Missing rows default to enabled=true (opt-in by default).
  const isEnabled = (moduleId) => (prefs.has(moduleId) ? prefs.get(moduleId).enabled : true);

  return (
    <>
      <h2 className="page-title">Settings</h2>

      <section className="card" style={{ marginBottom: 12 }}>
        <h3 className="masters-section__title" style={{ marginTop: 0 }}>Email notifications</h3>
        <div className="form-hint" style={{ marginBottom: 12 }}>
          Choose which modules you want email notifications for. Changes save immediately.
        </div>
        {loading ? <div className="masters-users__empty">Loading…</div>
          : modules.length === 0 ? <div className="masters-users__empty">No modules defined.</div>
          : (
            <div className="notif-prefs">
              {modules.map((m) => (
                <label key={m.id} className="notif-prefs__row">
                  <input
                    type="checkbox"
                    checked={isEnabled(m.id)}
                    disabled={busy === m.id}
                    onChange={(e) => toggle(m.id, e.target.checked)}
                  />
                  <div className="notif-prefs__body">
                    <div className="notif-prefs__name">{m.name}</div>
                    {m.description && <div className="form-hint">{m.description}</div>}
                  </div>
                </label>
              ))}
            </div>
          )}
      </section>
    </>
  );
}
