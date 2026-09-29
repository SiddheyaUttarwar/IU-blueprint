import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import {
  DEFAULT_RAG_CONFIG,
  getRagConfig,
  updateRagConfig,
  validateRagConfig,
  listRagAudit,
  listRagVersions,
  saveRagVersion,
  labelForVersion,
} from '../../services/ragConfig.js';
import BackButton from '../../components/BackButton.jsx';

function fmtName(p) {
  if (!p) return '';
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return full || p.email || '';
}
function fmtDateTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString();
}

export default function RagRules() {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [draft, setDraft] = useState(null);
  const [errors, setErrors] = useState({});
  const [audit, setAudit] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [showAllAudit, setShowAllAudit] = useState(false);
  const [versions, setVersions] = useState([]);
  const [selectedVersionId, setSelectedVersionId] = useState(''); // '' = current live config

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError('');
      try {
        const [cfg, hist, vs] = await Promise.all([
          getRagConfig(),
          listRagAudit(20).catch(() => []),
          listRagVersions().catch(() => []),
        ]);
        if (cancelled) return;
        setConfig(cfg);
        setDraft(cfg);
        setAudit(hist);
        setVersions(vs);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || 'Failed to load RAG configuration.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  function beginEdit() { setDraft({ ...config }); setErrors({}); setEditing(true); }
  function cancelEdit() { setDraft(config); setErrors({}); setEditing(false); }
  function resetDefaults() {
    if (!window.confirm('Reset all RAG thresholds to the organization default values?')) return;
    const next = { ...draft, ...DEFAULT_RAG_CONFIG };
    setDraft(next);
    setErrors(validateRagConfig(next));
  }
  // Red fields are not user-editable — Red = anything beyond Amber. Filter them out of validation errors.
  function amberOnlyErrors(errs) {
    const out = {};
    for (const [k, v] of Object.entries(errs)) {
      if (k === 'progress_red_pts' || k === 'schedule_red_pct' || k === 'cost_red_pct') continue;
      out[k] = v;
    }
    return out;
  }
  function setField(k, v) {
    const next = { ...draft, [k]: v };
    setDraft(next);
    setErrors(amberOnlyErrors(validateRagConfig(next)));
  }
  function askConfirm() {
    const errs = amberOnlyErrors(validateRagConfig(draft));
    setErrors(errs);
    if (Object.keys(errs).length) { toast.error('Fix the highlighted issues before saving.'); return; }
    setConfirmOpen(true);
  }
  async function doSave() {
    setSaving(true);
    try {
      // Red inputs are gone — Red = anything beyond Amber. Mirror each amber value into its red
      // counterpart on save so DB-level "red >= amber" validation still passes.
      const mirrored = {
        ...draft,
        progress_red_pts: Number(draft.progress_amber_pts) || 0,
        schedule_red_pct: Number(draft.schedule_amber_pct) || 0,
        cost_red_pct:     Number(draft.cost_amber_pct)     || 0,
      };
      const patch = {};
      for (const k of Object.keys(DEFAULT_RAG_CONFIG)) {
        if (String(mirrored[k]) !== String(config?.[k])) {
          patch[k] = k === 'schedule_amber_min_days' ? Number(mirrored[k]) : Number(mirrored[k]);
        }
      }
      const updated = await updateRagConfig(config, patch, profile?.id);
      setConfig(updated); setDraft(updated); setEditing(false); setConfirmOpen(false);
      // Snapshot the new values as a new version for the current month (v1, v2, v3, …).
      let savedVer = null;
      try {
        const now = new Date();
        savedVer = await saveRagVersion(mirrored, {
          year: now.getFullYear(), month: now.getMonth() + 1,
          reason: 'RAG rule edit', actorId: profile?.id,
        });
      } catch (vErr) {
        console.warn('Monthly version save failed (non-blocking):', vErr);
      }
      toast.success(savedVer
        ? `RAG rules updated. Saved as ${labelForVersion(savedVer)}.`
        : 'RAG rules updated.');
      const [hist, vs] = await Promise.all([listRagAudit(20).catch(() => []), listRagVersions().catch(() => [])]);
      setAudit(hist);
      setVersions(vs);
      // Snap back to "Latest" so the just-saved version is what's visible in the dropdown label.
      setSelectedVersionId('');
    } catch (err) { toast.error(err.message || 'Save failed.'); }
    finally { setSaving(false); }
  }

  // When user switches to an older version, show its snapshot values in read-only mode.
  function switchVersion(id) {
    setSelectedVersionId(id);
    setEditing(false);
    setErrors({});
    if (!id) { setDraft(config); return; }
    const v = versions.find((x) => x.id === id);
    if (v?.snapshot) setDraft({ ...config, ...v.snapshot });
  }

  const isViewingOldVersion = !!selectedVersionId;
  const readOnly = !editing || !isAdmin || isViewingOldVersion;

  if (loading) return <div className="card">Loading…</div>;
  if (loadError) return (<><BackButton to="/masters" label="Back to Masters" /><div className="card">{loadError}</div></>);
  if (!config || !draft) return (
    <><BackButton to="/masters" label="Back to Masters" /><div className="card">No RAG configuration row found. Run the schema delta.</div></>
  );

  return (
    <>
      <BackButton to="/masters" label="Back to Masters" />
      <div className="rag-header">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 className="page-title" style={{ marginBottom: 0 }}>RAG Rule Master</h2>
            <span className="badge-admin">Admin Only</span>
            <span className="info-icon" title="Changes made to RAG thresholds apply across all applicable projects.">ⓘ</span>
          </div>
          <div className="form-hint" style={{ marginTop: 4 }}>
            Define organization-wide thresholds used to consistently assess project health.
          </div>
          {editing && <div className="editing-indicator" style={{ marginTop: 6 }}>● Editing</div>}
        </div>
        <div className="rag-header__actions">
          {versions.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span className="form-hint" style={{ margin: 0 }}>Version:</span>
              <select value={selectedVersionId} onChange={(e) => switchVersion(e.target.value)} disabled={editing}>
                <option value="">Latest — {labelForVersion(versions[0])} (live)</option>
                {versions.slice(1).map((v) => (
                  <option key={v.id} value={v.id}>{labelForVersion(v)}</option>
                ))}
              </select>
            </label>
          )}
          {!editing && isAdmin && !isViewingOldVersion && (<button type="button" className="btn-primary btn-primary--sm" onClick={beginEdit}>Edit Rules</button>)}
          {editing && (
            <>
              <button type="button" className="btn-secondary" onClick={resetDefaults} disabled={saving}>Reset to Default</button>
              <button type="button" className="btn-secondary" onClick={cancelEdit} disabled={saving}>Cancel</button>
              <button type="button" className="btn-primary btn-primary--sm" onClick={askConfirm} disabled={saving || Object.keys(errors).length > 0}>Save Changes</button>
            </>
          )}
        </div>
      </div>
      {isViewingOldVersion && (
        <div className="banner banner--info" style={{ marginBottom: 12 }}>
          Viewing snapshot from <b>{labelForVersion(versions.find((v) => v.id === selectedVersionId))}</b> — read only. Switch to <b>Current (live)</b> to edit.
        </div>
      )}

      <div className="rag-grid">
        <MetricCard tone="green" title="Progress" desc="Actual % vs Planned %. Threshold is a percentage — e.g. Actual 55%, Planned 60% ⇒ 5% behind.">
          <RagRowsTable rows={[
            { tone: 'green', label: 'Green', condition: 'Actual ≥ Planned progress', threshold: <span className="rag-threshold-static">0%</span> },
            { tone: 'amber', label: 'Amber', condition: 'Behind planned progress by up to', threshold: (
              <ThresholdInput value={draft.progress_amber_pts} onChange={(v) => setField('progress_amber_pts', v)} unit="%" error={errors.progress_amber_pts} readOnly={readOnly} step={0.5} />
            ) },
            { tone: 'red', label: 'Red', condition: 'Behind planned progress by more than', threshold: <span className="rag-threshold-static">Anything beyond Amber</span> },
          ]} />
        </MetricCard>

        <MetricCard tone="amber" title="Schedule" desc="Forecast finish slip vs approved baseline finish.">
          <RagRowsTable rows={[
            { tone: 'green', label: 'Green', condition: 'On or ahead of baseline', threshold: <span className="rag-threshold-static">0 days slip</span> },
            { tone: 'amber', label: 'Amber', condition: 'Slip up to', threshold: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  Baseline ×
                  <ThresholdInput value={draft.schedule_amber_pct} onChange={(v) => setField('schedule_amber_pct', v)} unit="%" error={errors.schedule_amber_pct} readOnly={readOnly} step={0.5} inline />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  or min
                  <ThresholdInput value={draft.schedule_amber_min_days} onChange={(v) => setField('schedule_amber_min_days', v)} unit="days" error={errors.schedule_amber_min_days} readOnly={readOnly} step={1} inline />
                </div>
              </div>
            ) },
            { tone: 'red', label: 'Red', condition: 'Slip beyond Amber', threshold: <span className="rag-threshold-static">Anything beyond Amber</span> },
          ]} />
        </MetricCard>

        <MetricCard tone="red" title="Cost" desc="Forecast cost at completion vs approved project budget.">
          <RagRowsTable rows={[
            { tone: 'green', label: 'Green', condition: 'Forecast ≤ Approved Budget', threshold: <span className="rag-threshold-static">0%</span> },
            { tone: 'amber', label: 'Amber', condition: 'Over budget by up to', threshold: (
              <ThresholdInput value={draft.cost_amber_pct} onChange={(v) => setField('cost_amber_pct', v)} unit="%" error={errors.cost_amber_pct} readOnly={readOnly} step={0.5} />
            ) },
            { tone: 'red', label: 'Red', condition: 'Over budget by more than Amber', threshold: <span className="rag-threshold-static">Anything beyond Amber</span> },
          ]} />
        </MetricCard>
      </div>

      <div className="rag-fixed-row">
        <div className="card">
          <div className="rag-card__label">Fixed Calculation Method</div>
          <ul className="rag-list">
            <li><b>Progress:</b> Leaf-level tasks only · summary/parent tasks excluded · cancelled tasks excluded · each eligible task equally weighted · task progress capped at 100% · Metric Progress = average of eligible task progress · Planned Progress computed task-by-task from frozen baseline.</li>
            <li><b>Schedule:</b> Slip = Forecast Finish − Baseline Finish · Amber threshold = MAX(Baseline Duration × Amber %, Minimum Amber Days) · always uses baseline duration, never forecast.</li>
            <li><b>Cost:</b> Cost RAG uses Forecast at Completion vs Approved Budget · Actual Spend to Date is informational only and does not directly determine Cost RAG.</li>
          </ul>
        </div>
      </div>

      <div className="rag-two-col">
        <div className="card">
          <h3 className="masters-section__title" style={{ marginTop: 0 }}>Not Rated Conditions</h3>
          <div className="rag-not-rated">
            <div className="rag-chip"><span className="health-pill health-pill--na">Progress = Not Rated</span><span>No eligible leaf tasks, or baseline/actual progress unavailable.</span></div>
            <div className="rag-chip"><span className="health-pill health-pill--na">Schedule = Not Rated</span><span>Baseline finish or forecast finish unavailable.</span></div>
            <div className="rag-chip"><span className="health-pill health-pill--na">Cost = Not Rated</span><span>Approved budget or Forecast at Completion unavailable.</span></div>
          </div>
          <div className="form-hint" style={{ marginTop: 8 }}>Missing data is shown as neutral grey — never silently treated as Green.</div>
        </div>

        <div className="card">
          <h3 className="masters-section__title" style={{ marginTop: 0 }}>Overall Project RAG</h3>
          <p className="form-hint" style={{ marginTop: 0 }}>
            Overall RAG = <b>highest severity</b> among applicable dimensions.
          </p>
          <div className="rag-overall-example">
            <div>Progress <span className="health-pill health-pill--green">Green</span></div>
            <div>Schedule <span className="health-pill health-pill--red">Red</span></div>
            <div>Cost <span className="health-pill health-pill--amber">Amber</span></div>
            <div style={{ marginTop: 8, fontWeight: 600 }}>Overall <span className="health-pill health-pill--red">Red</span></div>
          </div>
          <div className="form-hint" style={{ marginTop: 8 }}>Severity: Green = 1 · Amber = 2 · Red = 3. If data is missing, dimension is Not Rated (does not raise severity, but is called out).</div>
        </div>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 className="masters-section__title" style={{ marginTop: 0 }}>Audit History</h3>
          {audit.length > 5 && (
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setShowAllAudit((v) => !v)}>
              {showAllAudit ? 'Show recent' : 'View Full History'}
            </button>
          )}
        </div>
        {audit.length === 0 ? (
          <div className="masters-users__empty">No changes recorded yet.</div>
        ) : (
          <table className="masters-users__table">
            <thead>
              <tr>
                <th>Date &amp; Time</th>
                <th>Changed By</th>
                <th>Metric</th>
                <th>Parameter</th>
                <th>Previous Value</th>
                <th>New Value</th>
              </tr>
            </thead>
            <tbody>
              {(showAllAudit ? audit : audit.slice(0, 5)).map((a) => (
                <tr key={a.id}>
                  <td>{fmtDateTime(a.changed_at)}</td>
                  <td>{fmtName(a.changed_by_profile) || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{a.metric}</td>
                  <td>{a.parameter}</td>
                  <td>{a.previous_value || '—'}</td>
                  <td>{a.new_value || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirmOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modal__header">
              <h3 className="modal__title">Apply RAG Rule Changes?</h3>
              <button type="button" className="modal__close" onClick={() => setConfirmOpen(false)} aria-label="Close">×</button>
            </div>
            <div className="modal__body">
              <p>These changes will affect the RAG rating of all applicable projects across the portfolio. Existing project ratings may change based on the new thresholds.</p>
            </div>
            <div className="modal__footer">
              <button type="button" className="btn-secondary" onClick={() => setConfirmOpen(false)} disabled={saving}>Cancel</button>
              <button type="button" className="btn-primary btn-primary--sm" onClick={doSave} disabled={saving}>{saving ? 'Applying…' : 'Apply Changes'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function MetricCard({ tone, title, desc, children }) {
  return (
    <section className={`metric-card metric-card--${tone}`}>
      <div className="metric-card__accent" />
      <header className="metric-card__head">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3 className="metric-card__title">{title}</h3>
          <p className="metric-card__desc">{desc}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

function RagRowsTable({ rows }) {
  return (
    <table className="rag-rows">
      <thead>
        <tr>
          <th>RAG</th>
          <th>Condition</th>
          <th>Threshold (up to)</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td><span className={`health-pill health-pill--${r.tone}`}>{r.label}</span></td>
            <td>{r.condition}</td>
            <td>{r.threshold}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ThresholdInput({ value, onChange, unit, error, readOnly, step = 0.5, inline = false }) {
  const numericShape = (v) => v === '' || /^\d*\.?\d*$/.test(v);
  return (
    <span className={`rag-threshold${inline ? ' rag-threshold--inline' : ''}${error ? ' rag-threshold--invalid' : ''}`}>
      <input
        type="text"
        inputMode="decimal"
        className="rag-threshold__input"
        value={value ?? ''}
        onChange={(e) => { const v = e.target.value; if (numericShape(v)) onChange(v); }}
        onKeyDown={(e) => {
          const allowed = ['Backspace','Delete','Tab','Enter','Escape','Home','End','ArrowLeft','ArrowRight','ArrowUp','ArrowDown'];
          if (allowed.includes(e.key) || e.ctrlKey || e.metaKey) return;
          if (/^[0-9]$/.test(e.key)) return;
          if (e.key === '.' && !String(value ?? '').includes('.')) return;
          e.preventDefault();
        }}
        disabled={readOnly}
        aria-invalid={!!error}
        title={error || ''}
        data-step={step}
      />
      <span className="rag-threshold__unit">{unit}</span>
    </span>
  );
}
