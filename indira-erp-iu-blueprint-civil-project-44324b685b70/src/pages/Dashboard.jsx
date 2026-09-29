import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { loadPortfolio, computeRow } from '../services/portfolio.js';
import { useToast } from '../context/ToastContext.jsx';
import { exportPortfolioXlsx } from '../lib/portfolioExport.js';
import { exportPortfolioPdf } from '../lib/portfolioPdf.js';
import { exportPortfolioPpt } from '../lib/portfolioPpt.js';
import { listRagVersions, labelForVersion, getRagConfig } from '../services/ragConfig.js';
import PasswordChangeBanner from '../components/PasswordChangeBanner.jsx';

const STATUS_LABEL = {
  planning: 'Planning', active: 'In progress', on_hold: 'On hold',
  completed: 'Completed', cancelled: 'Cancelled', draft: 'Draft',
};

// Drafts carry status='planning' + is_draft=true in the DB. Everywhere we display / filter status,
// treat drafts as their own bucket (BUG-16). Non-draft projects use their normal status field.
function effectiveStatus(p) { return p?.is_draft ? 'draft' : p?.status; }

const ALL_COLUMNS = [
  { key: 'name',          label: 'Project' },
  { key: 'department',    label: 'Campus' },
  { key: 'status',        label: 'Status' },
  { key: 'tasksDone',     label: 'Tasks Done' },
  { key: 'metric',        label: 'Metric Progress' },
  { key: 'vsPlan',        label: 'vs Plan' },
  { key: 'plannedFinish', label: 'Planned Finish' },
  { key: 'forecastFinish',label: 'Forecast Finish' },
  { key: 'scheduleRag',   label: 'Schedule' },
  { key: 'budget',        label: 'Budget' },
  { key: 'spent',         label: 'Spent' },
  { key: 'costRag',       label: 'Cost' },
];
const COLS_LS_KEY = 'iu-blueprint.dashboard.visibleCols';

function fmtDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }); }
function fmtRupee(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)} K`;
  return `₹${n.toFixed(0)}`;
}

export default function Dashboard() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [schedule, setSchedule] = useState('');
  const [cost, setCost] = useState('');
  // Default: newest project on top. Any column header click switches to that column's
  // sort; clicking the same header again toggles direction as before.
  const [sortKey, setSortKey] = useState('created');
  const [sortDir, setSortDir] = useState('desc');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const raw = localStorage.getItem(COLS_LS_KEY);
      if (raw) return new Set(JSON.parse(raw));
    } catch { /* ignore */ }
    return new Set(ALL_COLUMNS.map((c) => c.key));
  });
  const [colsOpen, setColsOpen] = useState(false);
  const [ragVersions, setRagVersions] = useState([]);
  const [selectedRagVersionId, setSelectedRagVersionId] = useState('');
  const [portfolioRaw, setPortfolioRaw] = useState(null);
  const [liveRagConfig, setLiveRagConfig] = useState(null);
  function toggleCol(key) {
    setVisibleCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { if (next.size <= 1) return prev; next.delete(key); }
      else next.add(key);
      try { localStorage.setItem(COLS_LS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const [pf, vs, cfg] = await Promise.all([
          loadPortfolio(),
          listRagVersions().catch(() => []),
          getRagConfig().catch(() => null),
        ]);
        if (cancelled) return;
        setPortfolioRaw(pf);
        setRagVersions(vs);
        setLiveRagConfig(cfg);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load portfolio.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  // Effective RAG snapshot for Dashboard RAG chips:
  //   - If user picked a version → use that version's snapshot.
  //   - Else → use the most recent version's snapshot (which mirrors the live rag_config).
  //   - If no versions saved yet → fall back to live rag_config.
  const effectiveRagCfg = useMemo(() => {
    if (selectedRagVersionId) return ragVersions.find((v) => v.id === selectedRagVersionId)?.snapshot ?? liveRagConfig;
    return ragVersions[0]?.snapshot ?? liveRagConfig;
  }, [selectedRagVersionId, ragVersions, liveRagConfig]);

  // Recompute rows whenever the raw portfolio data or the RAG snapshot changes.
  useEffect(() => {
    if (!portfolioRaw) { setRows([]); return; }
    const pf = portfolioRaw;
    setRows(pf.projects.map((p) => computeRow(p, pf.tasks, pf.amountsByTask, pf.dateBaselines, effectiveRagCfg, pf.indentByProject)));
  }, [portfolioRaw, effectiveRagCfg]);

  const departments = useMemo(() => [...new Set(rows.map((r) => r.department))].sort(), [rows]);

  const filtered = useMemo(() => {
    const qLower = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (department && r.department !== department) return false;
      if (status && effectiveStatus(r.project) !== status) return false;
      if (schedule && r.scheduleRag !== schedule) return false;
      if (cost && r.costRag !== cost) return false;
      if (qLower) {
        const hay = `${r.project.name} ${r.department} ${r.project.project_manager ? (r.project.project_manager.first_name + ' ' + r.project.project_manager.last_name) : ''}`.toLowerCase();
        if (!hay.includes(qLower)) return false;
      }
      return true;
    });
  }, [rows, q, department, status, schedule, cost]);

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const ragOrder = { red: 0, amber: 1, green: 2, unrated: 3 };
    return [...filtered].sort((a, b) => {
      let av, bv;
      switch (sortKey) {
        case 'created':       av = a.project.created_at ?? ''; bv = b.project.created_at ?? ''; break;
        case 'name':          av = a.project.name; bv = b.project.name; break;
        case 'department':    av = a.department; bv = b.department; break;
        case 'status':        av = a.project.status; bv = b.project.status; break;
        case 'tasksDone':     av = a.tasksDonePct; bv = b.tasksDonePct; break;
        case 'metric':        av = a.metricProgress; bv = b.metricProgress; break;
        case 'vsPlan':        av = a.vsPlanDeltaPts; bv = b.vsPlanDeltaPts; break;
        case 'plannedFinish': av = a.plannedFinish ?? ''; bv = b.plannedFinish ?? ''; break;
        case 'forecastFinish':av = a.forecastFinish ?? ''; bv = b.forecastFinish ?? ''; break;
        case 'scheduleRag':   av = ragOrder[a.scheduleRag] ?? 9; bv = ragOrder[b.scheduleRag] ?? 9; break;
        case 'budget':        av = a.budget; bv = b.budget; break;
        case 'spent':         av = a.spent; bv = b.spent; break;
        case 'costRag':       av = ragOrder[a.costRag] ?? 9; bv = ragOrder[b.costRag] ?? 9; break;
        default:              av = 0; bv = 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return  1 * dir;
      return 0;
    });
  }, [filtered, sortKey, sortDir]);

  const counts = useMemo(() => {
    const c = { red: 0, amber: 0, green: 0, unrated: 0 };
    for (const r of rows) c[r.scheduleRag] = (c[r.scheduleRag] ?? 0) + 1;
    return c;
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageStart = (page - 1) * perPage;
  const paged = sorted.slice(pageStart, pageStart + perPage);

  function toggleSort(k) {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }
  function sortArrow(k) { return sortKey === k ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''; }

  async function handleExport() {
    try {
      await exportPortfolioXlsx(sorted);
      toast.success('Portfolio exported to Excel.');
    } catch (err) { toast.error(err.message || 'Excel export failed.'); }
  }
  async function handleExportPdf() {
    try {
      await exportPortfolioPdf(sorted);
      toast.success('Portfolio exported to PDF.');
    } catch (err) { toast.error(err.message || 'PDF export failed.'); }
  }
  async function handleExportPpt() {
    try {
      await exportPortfolioPpt(sorted);
      toast.success('Portfolio exported to PowerPoint.');
    } catch (err) { toast.error(err.message || 'PPT export failed.'); }
  }

  return (
    <div className="portfolio">
      <PasswordChangeBanner />
      <div className="portfolio__header">
        <div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Dashboard</h1>
          <div className="form-hint">
            {rows.length} projects across {departments.length} campuses · on schedule:&nbsp;
            <span className="rag-count rag-count--red">{counts.red} red</span> ·&nbsp;
            <span className="rag-count rag-count--amber">{counts.amber} amber</span> ·&nbsp;
            <span className="rag-count rag-count--green">{counts.green} green</span> ·&nbsp;
            {counts.unrated} not rated yet
          </div>
        </div>
        <div className="portfolio__header-actions">
          <input type="search" className="masters-users__search"
            placeholder="Search name, code or manager"
            value={q} onChange={(e) => setQ(e.target.value)} />
          {ragVersions.length > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
              <span className="form-hint" style={{ margin: 0 }}>RAG:</span>
              <select value={selectedRagVersionId} onChange={(e) => setSelectedRagVersionId(e.target.value)} title="RAG version driving the Schedule/Cost pills. Latest is the most recently saved snapshot.">
                <option value="">Latest — {labelForVersion(ragVersions[0])}</option>
                {ragVersions.slice(1).map((v) => (
                  <option key={v.id} value={v.id}>{labelForVersion(v)}</option>
                ))}
              </select>
            </label>
          )}
          <div style={{ position: 'relative' }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setColsOpen((o) => !o)}>
              Columns ({visibleCols.size})
            </button>
            {colsOpen && (
              <div className="eye-popover__panel" style={{ right: 0, left: 'auto', minWidth: 200 }}>
                {ALL_COLUMNS.map((c) => (
                  <label key={c.key} className="notif-prefs__row" style={{ padding: '4px 8px', gap: 6 }}>
                    <input type="checkbox" checked={visibleCols.has(c.key)} onChange={() => toggleCol(c.key)} />
                    <span>{c.label}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleExport} disabled={loading || !rows.length}>
            Excel
          </button>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleExportPdf} disabled={loading || !rows.length}>
            PDF
          </button>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={handleExportPpt} disabled={loading || !rows.length}>
            PPT
          </button>
        </div>
      </div>

      <div className="portfolio__filters">
        <label className="portfolio__filter">
          <span>Campus</span>
          <select value={department} onChange={(e) => { setDepartment(e.target.value); setPage(1); }}>
            <option value="">All campuses</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
        <label className="portfolio__filter">
          <span>Status</span>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="portfolio__filter">
          <span>Schedule</span>
          <select value={schedule} onChange={(e) => { setSchedule(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="red">Red</option>
            <option value="amber">Amber</option>
            <option value="green">Green</option>
            <option value="unrated">Not rated</option>
          </select>
        </label>
        <label className="portfolio__filter">
          <span>Cost</span>
          <select value={cost} onChange={(e) => { setCost(e.target.value); setPage(1); }}>
            <option value="">All</option>
            <option value="red">Red</option>
            <option value="amber">Amber</option>
            <option value="green">Green</option>
            <option value="unrated">Not rated</option>
          </select>
        </label>
        <span className="portfolio__count">{sorted.length} of {rows.length} shown</span>
      </div>

      {loading && <div className="card">Loading dashboard…</div>}
      {error && <div className="login-error" role="alert">{error}</div>}

      {!loading && !error && (
        <div className="portfolio__card">
          <div className="portfolio__card-head">
            <span>ALL PROJECTS</span>
            <span className="form-hint">click a row to open the project</span>
          </div>
          <div className="portfolio__table-wrap">
            <table className="portfolio__table table--responsive">
              <thead>
                <tr>
                  {visibleCols.has('name')          && <th onClick={() => toggleSort('name')}>Project{sortArrow('name')}</th>}
                  {visibleCols.has('department')    && <th onClick={() => toggleSort('department')}>Campus{sortArrow('department')}</th>}
                  {visibleCols.has('status')        && <th onClick={() => toggleSort('status')}>Status{sortArrow('status')}</th>}
                  {visibleCols.has('tasksDone')     && <th onClick={() => toggleSort('tasksDone')}>Tasks Done{sortArrow('tasksDone')}</th>}
                  {visibleCols.has('metric')        && <th onClick={() => toggleSort('metric')}>Metric Progress{sortArrow('metric')}</th>}
                  {visibleCols.has('vsPlan')        && <th onClick={() => toggleSort('vsPlan')}>vs Plan{sortArrow('vsPlan')}</th>}
                  {visibleCols.has('plannedFinish') && <th onClick={() => toggleSort('plannedFinish')}>Planned Finish{sortArrow('plannedFinish')}</th>}
                  {visibleCols.has('forecastFinish')&& <th onClick={() => toggleSort('forecastFinish')}>Forecast Finish{sortArrow('forecastFinish')}</th>}
                  {visibleCols.has('scheduleRag')   && <th onClick={() => toggleSort('scheduleRag')}>Schedule{sortArrow('scheduleRag')}</th>}
                  {visibleCols.has('budget')        && <th onClick={() => toggleSort('budget')}>Budget{sortArrow('budget')}</th>}
                  {visibleCols.has('spent')         && <th onClick={() => toggleSort('spent')}>Spent{sortArrow('spent')}</th>}
                  {visibleCols.has('costRag')       && <th onClick={() => toggleSort('costRag')}>Cost{sortArrow('costRag')}</th>}
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <tr key={r.project.id} className="portfolio__row">
                    {visibleCols.has('name') && (
                      <td data-label="Project">
                        <Link to={`/projects/${r.project.id}`} className="portfolio__project-link">
                          <div className="portfolio__project-name">{r.project.name}</div>
                          <div className="portfolio__project-code">{r.project.id.slice(0, 8).toUpperCase()}</div>
                        </Link>
                      </td>
                    )}
                    {visibleCols.has('department') && <td data-label="Campus">{r.department}</td>}
                    {visibleCols.has('status') && (() => { const s = effectiveStatus(r.project); return <td data-label="Status"><span className={`status-pill status-pill--${s === 'draft' ? 'planning' : s}`}>{STATUS_LABEL[s] ?? s}</span></td>; })()}
                    {visibleCols.has('tasksDone') && (
                      <td data-label="Tasks Done">
                        <div className="portfolio__minibar-wrap">
                          <span className="portfolio__minibar-label">{r.tasksDonePct}%</span>
                          <span className="portfolio__minibar"><span className="portfolio__minibar-fill" style={{ width: `${r.tasksDonePct}%` }} /></span>
                        </div>
                      </td>
                    )}
                    {visibleCols.has('metric') && (
                      <td data-label="Metric Progress">
                        <div className="portfolio__minibar-wrap">
                          <span className="portfolio__minibar-label">{r.metricProgress}% of {r.plannedProgress}% planned</span>
                          <span className="portfolio__minibar">
                            <span className="portfolio__minibar-fill" style={{ width: `${r.metricProgress}%` }} />
                            <span className="portfolio__minibar-plan" style={{ left: `${r.plannedProgress}%` }} />
                          </span>
                        </div>
                      </td>
                    )}
                    {visibleCols.has('vsPlan') && (
                      <td data-label="vs Plan">
                        <span className={`vs-plan-pill vs-plan-pill--${r.vsPlanDeltaPts >= 0 ? 'good' : 'bad'}`}>
                          {r.vsPlanDeltaPts >= 0 ? '+' : ''}{r.vsPlanDeltaPts}%
                        </span>
                      </td>
                    )}
                    {visibleCols.has('plannedFinish') && <td data-label="Planned Finish">{fmtDate(r.plannedFinish)}</td>}
                    {visibleCols.has('forecastFinish') && (
                      <td data-label="Forecast Finish">
                        {fmtDate(r.forecastFinish)}
                        {r.forecastDeltaDays !== 0 && (
                          <div className="form-hint">{r.forecastDeltaDays > 0 ? `+${r.forecastDeltaDays} d` : `${r.forecastDeltaDays} d`}</div>
                        )}
                      </td>
                    )}
                    {visibleCols.has('scheduleRag') && <td data-label="Schedule"><span className={`rag-pill rag-pill--${r.scheduleRag}`}>● {ragLabel(r.scheduleRag)}</span></td>}
                    {visibleCols.has('budget') && <td data-label="Budget">{fmtRupee(r.budget)}</td>}
                    {visibleCols.has('spent') && (
                      <td data-label="Spent">
                        {fmtRupee(r.spent)}
                        {r.budget > 0 && <div className="form-hint">{r.spentPctOfBudget}% of budget</div>}
                      </td>
                    )}
                    {visibleCols.has('costRag') && (
                      <td data-label="Cost">
                        <span className={`rag-pill rag-pill--${r.costRag}`}>● {ragLabel(r.costRag)}</span>
                        {r.costOverrun !== 0 && r.budget > 0 && (
                          <div className="form-hint">{r.costOverrun > 0 ? `+${fmtRupee(Math.abs(r.costOverrun))}` : `−${fmtRupee(Math.abs(r.costOverrun))}`}</div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
                {paged.length === 0 && (
                  <tr><td colSpan={visibleCols.size} className="masters-users__empty">No projects match the filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="portfolio__pagination">
            <div className="form-hint">
              Showing <b>{sorted.length === 0 ? 0 : pageStart + 1}–{Math.min(pageStart + perPage, sorted.length)}</b> of {sorted.length}
            </div>
            <label className="portfolio__perpage">
              <span>Per page</span>
              <select value={perPage} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}>
                {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="portfolio__pager">
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>← Prev</button>
              <span className="portfolio__pageno">{page} / {pageCount}</span>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page === pageCount}>Next →</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ragLabel(r) { return r === 'unrated' ? 'Not rated' : r.charAt(0).toUpperCase() + r.slice(1); }
