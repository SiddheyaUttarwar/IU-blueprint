import ExcelJS from 'exceljs';

// Excel bulk import supports multiple projects with tasks + subtasks + milestones in one workbook.
//
// Required column names (row 1, case-insensitive, order does not matter):
//   Row · Type · Parent Row · Name
// Optional columns:
//   Phase · Class · Template · Project Type · Campus · School
//   Weight% · Start Date · End Date · Target Date · Assignees
//
// Type values: "Project", "Task", "Subtask", "Milestone".
// - Project rows: Parent Row blank; Class required (greenfield/brownfield). Template optional
//   — if blank, Project Type required.
// - Task/Milestone rows: Parent Row = Project's row number. Phase optional (defaults 'project').
// - Subtask rows: Parent Row = Task's row number.

const HEADER_ALIASES = {
  row: [/^row(\s*no\.?|\s*#|\s*number)?$/i, /^#$/],
  type: [/^type$/i, /^kind$/i],
  parent: [/^parent(\s*row)?$/i, /^parent\s*#$/i],
  name: [/^name$/i, /^title$/i],
  phase: [/^phase$/i],
  cls: [/^class$/i],
  template: [/^template(\s*name)?$/i],
  ptype: [/^project\s*type$/i, /^type\s*(name)?$/i],
  campus: [/^campus(\s*name)?$/i],
  school: [/^school(\s*name)?$/i],
  weight: [/^weight\s*%?$/i, /^%$/, /^weightage$/i],
  start: [/^start(\s*date)?$/i],
  end: [/^end(\s*date)?$/i, /^finish$/i],
  target: [/^target(\s*date)?$/i, /^due(\s*date)?$/i],
  assignees: [/^assignees?$/i, /^assigned\s*to$/i, /^emails?$/i],
};

function normLabel(v) {
  if (v == null) return '';
  const s = typeof v === 'object' && v.richText ? v.richText.map((r) => r.text).join('') : String(v);
  return s.replace(/\s+/g, ' ').trim();
}
function cellValue(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
  }
  return v;
}
function toDateString(v) {
  if (!v) return '';
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const dmy = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    let [, d, m, y] = dmy;
    if (y.length === 2) y = `20${y}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const p = new Date(s);
  return Number.isNaN(p.getTime()) ? '' : p.toISOString().slice(0, 10);
}
function matchAny(label, patterns) { return patterns.some((re) => re.test(label)); }
function toEmails(v) {
  if (!v) return [];
  return String(v).split(/[;,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
}
function normType(v) {
  const s = normLabel(v).toLowerCase();
  if (['project', 'proj'].includes(s)) return 'project';
  if (['task', 't'].includes(s)) return 'task';
  if (['subtask', 'sub', 'sub-task', 'sub task'].includes(s)) return 'subtask';
  if (['milestone', 'ms', 'm'].includes(s)) return 'milestone';
  return '';
}

export async function parseProjectsWorkbook(fileOrBuffer) {
  let buf;
  if (fileOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(fileOrBuffer)) buf = fileOrBuffer;
  else buf = await fileOrBuffer.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Workbook has no sheets.');

  const headerRow = ws.getRow(1);
  const col = {};
  headerRow.eachCell({ includeEmpty: false }, (cell, cNum) => {
    const l = normLabel(cellValue(cell));
    for (const [key, patterns] of Object.entries(HEADER_ALIASES)) {
      if (col[key] == null && matchAny(l, patterns)) col[key] = cNum;
    }
  });

  const errors = [];
  if (col.type == null) errors.push('Missing "Type" column.');
  if (col.name == null) errors.push('Missing "Name" column.');
  if (errors.length) return { projects: [], errors };

  // Pass 1: extract raw rows keyed by their Excel row number (which is `Row` if present, else row index)
  const rowsByNum = new Map();
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const type = normType(cellValue(row.getCell(col.type)));
    if (!type) continue;
    const name = normLabel(cellValue(row.getCell(col.name)));
    if (!name && type !== 'project') continue;
    const rowNum = col.row ? Number(cellValue(row.getCell(col.row))) || r : r;
    const parent = col.parent ? Number(cellValue(row.getCell(col.parent))) || null : null;
    rowsByNum.set(rowNum, {
      row: rowNum, type, parent, name,
      phase: col.phase ? (normLabel(cellValue(row.getCell(col.phase))) || null) : null,
      class: col.cls ? normLabel(cellValue(row.getCell(col.cls))).toLowerCase() : '',
      template: col.template ? normLabel(cellValue(row.getCell(col.template))) : '',
      projectType: col.ptype ? normLabel(cellValue(row.getCell(col.ptype))) : '',
      campus: col.campus ? normLabel(cellValue(row.getCell(col.campus))) : '',
      school: col.school ? normLabel(cellValue(row.getCell(col.school))) : '',
      weight: col.weight ? Number(cellValue(row.getCell(col.weight))) || 0 : 0,
      startDate: col.start ? toDateString(cellValue(row.getCell(col.start))) : '',
      endDate: col.end ? toDateString(cellValue(row.getCell(col.end))) : '',
      targetDate: col.target ? toDateString(cellValue(row.getCell(col.target))) : '',
      assignees: col.assignees ? toEmails(cellValue(row.getCell(col.assignees))) : [],
      _rowIssues: [],
    });
  }

  // Pass 2: assemble hierarchy
  const projects = [];
  const projectByRow = new Map();
  for (const r of rowsByNum.values()) {
    if (r.type === 'project') {
      if (!r.name) r._rowIssues.push('Project name is required.');
      if (!['greenfield', 'brownfield'].includes(r.class)) r._rowIssues.push('Class must be greenfield or brownfield.');
      if (!r.template && !r.projectType) r._rowIssues.push('If Template is blank, Project Type is required.');
      const proj = { ...r, tasks: [], milestones: [] };
      projects.push(proj);
      projectByRow.set(r.row, proj);
    }
  }
  const taskByRow = new Map();
  for (const r of rowsByNum.values()) {
    if (r.type === 'task') {
      const proj = projectByRow.get(r.parent);
      if (!proj) { r._rowIssues.push(`Parent Row ${r.parent} is not a Project.`); continue; }
      const task = { ...r, phase: r.phase || 'project', subs: [] };
      proj.tasks.push(task);
      taskByRow.set(r.row, { task, project: proj });
    } else if (r.type === 'milestone') {
      const proj = projectByRow.get(r.parent);
      if (!proj) { r._rowIssues.push(`Parent Row ${r.parent} is not a Project.`); continue; }
      proj.milestones.push({ ...r, phase: r.phase || 'project' });
    }
  }
  for (const r of rowsByNum.values()) {
    if (r.type === 'subtask') {
      const parentTask = taskByRow.get(r.parent);
      if (!parentTask) { r._rowIssues.push(`Parent Row ${r.parent} is not a Task.`); continue; }
      parentTask.task.subs.push({ ...r, phase: parentTask.task.phase });
    }
  }

  // Aggregate orphan issues into errors list too
  const orphans = Array.from(rowsByNum.values()).filter((r) => r._rowIssues.length && r.type !== 'project');
  const allIssues = orphans.map((r) => `Row ${r.row} (${r.type}): ${r._rowIssues.join(' / ')}`);

  return { projects, orphanIssues: allIssues, errors: [] };
}

export async function buildProjectsTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Projects');
  const headers = ['Row', 'Type', 'Parent Row', 'Name', 'Phase', 'Class', 'Template', 'Project Type', 'Campus', 'School', 'Weight%', 'Start Date', 'End Date', 'Target Date', 'Assignees'];
  const head = ws.getRow(1);
  headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h; c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F5' } };
  });

  // Example set of rows so the format is self-explanatory
  // Sample rows — do NOT reference specific template/type names that may not exist.
  // For "Template" and "Project Type", type the exact name from your Masters (case-insensitive).
  // For a Blank project, leave Template blank and provide Project Type.
  const rows = [
    [1, 'Project', '', 'Example Blank Project', '', 'greenfield', '', 'REPLACE_WITH_YOUR_PROJECT_TYPE_NAME', '', '', '', '2026-09-15', '2026-11-30', '', ''],
    [2, 'Task', 1, 'Foundation', 'project', '', '', '', '', '', 50, '2026-09-15', '2026-10-15', '', ''],
    [3, 'Subtask', 2, 'Excavation', '', '', '', '', '', '', 60, '2026-09-15', '2026-09-30', '', ''],
    [4, 'Subtask', 2, 'Backfilling', '', '', '', '', '', '', 40, '2026-10-01', '2026-10-15', '', ''],
    [5, 'Task', 1, 'Structure', 'project', '', '', '', '', '', 50, '2026-10-15', '2026-11-30', '', ''],
    [6, 'Milestone', 1, 'Foundation Ready', 'project', '', '', '', '', '', '', '', '', '2026-10-15', ''],
    [7, 'Project', '', 'Example Templated Project', '', 'brownfield', 'REPLACE_WITH_YOUR_TEMPLATE_NAME', '', '', '', '', '2026-10-01', '2026-10-20', '', ''],
    [8, 'Task', 7, 'Gate Fabrication', 'project', '', '', '', '', '', 100, '2026-10-01', '2026-10-20', '', ''],
  ];
  rows.forEach((r, i) => { ws.getRow(i + 2).values = r; });
  ws.columns = [
    { width: 6 }, { width: 10 }, { width: 8 }, { width: 30 }, { width: 12 },
    { width: 12 }, { width: 22 }, { width: 14 }, { width: 20 }, { width: 22 },
    { width: 10 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 30 },
  ];
  return await wb.xlsx.writeBuffer();
}
