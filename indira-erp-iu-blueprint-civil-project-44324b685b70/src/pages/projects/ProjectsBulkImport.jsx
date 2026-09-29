import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { listProjectTemplates } from '../../services/projectTemplates.js';
import { listProjectTypes } from '../../services/projectTypes.js';
import { listCampuses } from '../../services/campuses.js';
import { listSchools } from '../../services/schools.js';
import { listProfiles } from '../../services/profiles.js';
import { createProject, createProjectTask, createProjectMilestone } from '../../services/projects.js';
import { parseProjectsWorkbook, buildProjectsTemplate } from '../../lib/projectsExcel.js';
import { downloadBlob } from '../../lib/indentExcel.js';
import BackButton from '../../components/BackButton.jsx';

function findByName(list, name) {
  if (!name) return null;
  const n = String(name).trim().toLowerCase();
  return list.find((x) => (x.name ?? '').toLowerCase() === n) ?? null;
}
function profilesByEmails(profiles, emails) {
  if (!emails?.length) return [];
  const map = new Map(profiles.map((p) => [(p.email ?? '').toLowerCase(), p.id]));
  return emails.map((e) => map.get(e)).filter(Boolean);
}

export default function ProjectsBulkImport() {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [templates, setTemplates] = useState([]);
  const [projectTypes, setProjectTypes] = useState([]);
  const [campuses, setCampuses] = useState([]);
  const [schools, setSchools] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [projects, setProjects] = useState([]);
  const [orphanIssues, setOrphanIssues] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [results, setResults] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const [t, pt, c, s, ps] = await Promise.all([
          listProjectTemplates(), listProjectTypes(), listCampuses(), listSchools(), listProfiles(),
        ]);
        setTemplates(t); setProjectTypes(pt); setCampuses(c); setSchools(s); setProfiles(ps);
      } catch (err) { toast.error(err.message || 'Failed to load references.'); }
    })();
  }, [toast]);

  async function handleFile(file) {
    if (!file) return;
    setParsing(true);
    try {
      const parsed = await parseProjectsWorkbook(file);
      if (parsed.errors.length) { toast.error(parsed.errors[0]); return; }
      const resolved = parsed.projects.map((p) => resolveProject(p));
      setProjects(resolved);
      setOrphanIssues(parsed.orphanIssues ?? []);
      setResults([]);
      toast.info(`Parsed ${parsed.projects.length} project${parsed.projects.length === 1 ? '' : 's'}.`);
    } catch (err) { toast.error(err.message || 'Parse failed.'); }
    finally { setParsing(false); }
  }

  function resolveProject(p) {
    const tpl = findByName(templates, p.template);
    const version = tpl?.template_versions?.[0];
    const ptype = findByName(projectTypes, p.projectType);
    const campus = findByName(campuses, p.campus);
    const school = findByName(schools, p.school);
    const issues = [...p._rowIssues];
    if (p.template && !tpl) issues.push(`template "${p.template}" not found`);
    if (!p.template && !ptype) issues.push(`project type "${p.projectType}" not found`);
    if (p.campus && !campus) issues.push(`campus "${p.campus}" not found`);
    if (p.school && !school) issues.push(`school "${p.school}" not found`);
    return { ...p, _tpl: tpl, _version: version, _ptype: ptype, _campus: campus, _school: school, _issues: issues };
  }

  async function importAll() {
    setSaving(true);
    const res = [];
    for (const p of projects) {
      if (p._issues.length) { res.push({ project: p, status: 'skipped', message: p._issues.join('; ') }); continue; }
      try {
        const created = await createProject({
          name: p.name,
          projectClass: p.class,
          templateId: p._tpl?.id ?? null,
          templateVersionId: p._version?.id ?? null,
          projectTypeId: p._ptype?.id ?? null,
          campusId: p._campus?.id ?? null,
          schoolId: p._school?.id ?? null,
          startDate: p.startDate || null,
          endDate: p.endDate || null,
          createdBy: profile?.id,
        });
        // Add tasks/subtasks/milestones (Excel-defined ones ride on top of any template-inflated structure)
        for (const t of p.tasks) {
          const taskRow = await createProjectTask(created.id, {
            phase: t.phase || 'project',
            name: t.name,
            weightPct: t.weight || 0,
            startDate: t.startDate || null,
            endDate: t.endDate || null,
            assignedToIds: profilesByEmails(profiles, t.assignees),
            actorId: profile?.id,
          });
          for (const s of t.subs) {
            await createProjectTask(created.id, {
              phase: s.phase || 'project',
              parentTaskId: taskRow.id,
              name: s.name,
              weightPct: s.weight || 0,
              startDate: s.startDate || null,
              endDate: s.endDate || null,
              assignedToIds: profilesByEmails(profiles, s.assignees),
              actorId: profile?.id,
            });
          }
        }
        for (const m of p.milestones) {
          await createProjectMilestone(created.id, { phase: m.phase || 'project', name: m.name, targetDate: m.targetDate || null, actorId: profile?.id });
        }
        res.push({ project: p, status: 'ok', projectId: created.id });
      } catch (err) {
        res.push({ project: p, status: 'error', message: err.message ?? String(err) });
      }
    }
    setResults(res);
    setSaving(false);
    const ok = res.filter((x) => x.status === 'ok').length;
    toast.success(`Imported ${ok}/${projects.length} project${projects.length === 1 ? '' : 's'}.`);
  }

  async function template() {
    try {
      const buf = await buildProjectsTemplate();
      downloadBlob(buf, 'projects-template.xlsx');
    } catch (err) { toast.error(err.message || 'Failed.'); }
  }

  const readyCount = projects.filter((p) => !p._issues.length).length;

  return (
    <>
      <BackButton to="/projects" label="Back to Projects" />
      <h2 className="page-title">Bulk Import Projects</h2>
      <div className="form-hint" style={{ marginBottom: 12 }}>
        Import multiple projects with their tasks, subtasks, and milestones from a single Excel workbook.
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <ol style={{ paddingLeft: 20, margin: '0 0 12px 0', fontSize: 13 }}>
          <li><b>Download</b> the template below and fill in your projects, tasks and subtasks.</li>
          <li><b>Upload</b> the completed .xlsx file. The preview will show what will be imported.</li>
          <li>Review issues (if any), then click <b>Import</b>.</li>
        </ol>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'stretch' }}>
          <button type="button" className="btn-secondary btn-secondary--sm" onClick={template}>Download template (.xlsx)</button>
          <label className="btn-primary btn-primary--sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Choose Excel file to upload
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
          </label>
        </div>
        {parsing && <div className="form-hint" style={{ marginTop: 8 }}>Reading workbook…</div>}
        {orphanIssues.length > 0 && (
          <ul style={{ color: '#a56a00', marginTop: 8, fontSize: 12 }}>
            {orphanIssues.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>

      {projects.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div><b>{projects.length}</b> project{projects.length === 1 ? '' : 's'} parsed · {readyCount} ready · {projects.length - readyCount} with issues</div>
            <button type="button" className="btn-primary btn-primary--sm" disabled={saving || readyCount === 0} onClick={importAll}>
              {saving ? 'Importing…' : `Import ${readyCount} project(s)`}
            </button>
          </div>

          <ul className="bulk-preview">
            {projects.map((p, idx) => {
              const result = results.find((x) => x.project === p);
              const bg = p._issues.length ? '#fff7ed' : (result?.status === 'ok' ? '#f0fdf4' : result?.status === 'error' ? '#fef2f2' : '#fff');
              return (
                <li key={idx} className="bulk-preview__item" style={{ background: bg }}>
                  <div className="bulk-preview__head">
                    <span><b>{p.name || '(unnamed)'}</b> — {p.class || '?'} · {p._tpl ? `template: ${p._tpl.name}` : `Blank (type: ${p._ptype?.name ?? '?'})`}</span>
                    <span className="form-hint">{p.tasks.length} task(s) · {p.tasks.reduce((n, t) => n + t.subs.length, 0)} subtask(s) · {p.milestones.length} milestone(s)</span>
                  </div>
                  {p._issues.length > 0 && (
                    <div style={{ color: '#b3261e', fontSize: 12, padding: '4px 8px' }}>Issues: {p._issues.join('; ')}</div>
                  )}
                  {result && (
                    <div style={{ fontSize: 12, padding: '4px 8px', color: result.status === 'ok' ? '#166534' : '#b3261e' }}>
                      {result.status === 'ok' ? 'Imported successfully.' : `Failed: ${result.message}`}
                    </div>
                  )}
                  {(p.tasks.length > 0 || p.milestones.length > 0) && (
                    <ul className="bulk-preview__tree">
                      {p.tasks.map((t, ti) => (
                        <li key={`t${ti}`}>
                          <span className="my-tasks-kind">Task</span> {t.name} <span className="form-hint">· {t.weight || 0}%</span>
                          {t.subs.length > 0 && (
                            <ul>
                              {t.subs.map((s, si) => (
                                <li key={`s${si}`}>
                                  <span className="my-tasks-kind">Sub</span> {s.name} <span className="form-hint">· {s.weight || 0}%</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                      {p.milestones.map((m, mi) => (
                        <li key={`m${mi}`}>
                          <span className="my-tasks-kind">Milestone</span> {m.name} <span className="form-hint">· {m.targetDate || '—'}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>

          {results.some((r) => r.status === 'ok') && (
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => navigate('/projects')}>Back to Projects list</button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
