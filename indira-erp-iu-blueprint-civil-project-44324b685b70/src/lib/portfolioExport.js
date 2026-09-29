import ExcelJS from 'exceljs';

// Export the portfolio rows to a formatted .xlsx workbook.
// Uses exceljs which is already in package.json (used elsewhere for indent/project excel).
export async function exportPortfolioXlsx(rows, filename = 'portfolio.xlsx') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Indira BluePrint';
  wb.created = new Date();

  const ws = wb.addWorksheet('Portfolio', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Project',          key: 'name',            width: 32 },
    { header: 'Code',             key: 'code',            width: 12 },
    { header: 'Campus',           key: 'department',      width: 18 },
    { header: 'Status',           key: 'status',          width: 14 },
    { header: 'Tasks Done %',     key: 'tasksDonePct',    width: 12 },
    { header: 'Metric Progress',  key: 'metricProgress',  width: 15 },
    { header: 'Planned Progress', key: 'plannedProgress', width: 15 },
    { header: 'vs Plan (%)',      key: 'vsPlanDeltaPts',  width: 12 },
    { header: 'Planned Finish',   key: 'plannedFinish',   width: 15 },
    { header: 'Forecast Finish',  key: 'forecastFinish',  width: 15 },
    { header: 'Forecast Δ (d)',   key: 'forecastDeltaDays', width: 12 },
    { header: 'Schedule RAG',     key: 'scheduleRag',     width: 12 },
    { header: 'Budget (₹)',       key: 'budget',          width: 15 },
    { header: 'Spent (₹)',        key: 'spent',           width: 15 },
    { header: 'Spent % of Budget',key: 'spentPctOfBudget',width: 15 },
    { header: 'Cost Overrun (₹)', key: 'costOverrun',     width: 15 },
    { header: 'Cost RAG',         key: 'costRag',         width: 12 },
  ];

  // Style header row.
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF155685' } };
  head.alignment = { vertical: 'middle', horizontal: 'left' };
  head.height = 22;

  for (const r of rows) {
    const row = ws.addRow({
      name: r.project.name,
      code: (r.project.id || '').slice(0, 8).toUpperCase(),
      department: r.department,
      status: r.project.status,
      tasksDonePct: r.tasksDonePct / 100,
      metricProgress: r.metricProgress / 100,
      plannedProgress: r.plannedProgress / 100,
      vsPlanDeltaPts: r.vsPlanDeltaPts,
      plannedFinish: r.plannedFinish ? new Date(r.plannedFinish) : null,
      forecastFinish: r.forecastFinish ? new Date(r.forecastFinish) : null,
      forecastDeltaDays: r.forecastDeltaDays,
      scheduleRag: r.scheduleRag,
      budget: r.budget,
      spent: r.spent,
      spentPctOfBudget: r.spentPctOfBudget / 100,
      costOverrun: r.costOverrun,
      costRag: r.costRag,
    });
    // Format percentages
    ['tasksDonePct', 'metricProgress', 'plannedProgress', 'spentPctOfBudget'].forEach((k) => {
      const cell = row.getCell(k);
      if (cell.value != null) cell.numFmt = '0%';
    });
    // Format currency
    ['budget', 'spent', 'costOverrun'].forEach((k) => {
      const cell = row.getCell(k);
      if (cell.value != null) cell.numFmt = '₹#,##0';
    });
    // Format dates
    ['plannedFinish', 'forecastFinish'].forEach((k) => {
      const cell = row.getCell(k);
      if (cell.value) cell.numFmt = 'dd-mmm-yyyy';
    });
    // RAG color fill
    for (const k of ['scheduleRag', 'costRag']) {
      const cell = row.getCell(k);
      const v = String(cell.value ?? '').toLowerCase();
      const fg = v === 'red' ? 'FFB02A37' : v === 'amber' ? 'FFE0A500' : v === 'green' ? 'FF166534' : 'FF8B9DAD';
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fg } };
      cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
      cell.alignment = { horizontal: 'center' };
      cell.value = v.toUpperCase();
    }
  }

  // Footer sheet — meta about the export.
  const meta = wb.addWorksheet('Meta');
  meta.addRow(['Generated at', new Date().toISOString()]);
  meta.addRow(['Rows', rows.length]);
  meta.getColumn(1).width = 22;
  meta.getColumn(2).width = 40;

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
