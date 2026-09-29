import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

const RAG_COLOR = {
  red:     [176, 42, 55],
  amber:   [224, 165, 0],
  green:   [22, 101, 52],
  unrated: [139, 157, 173],
};

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'; }
function fmtRupee(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000000) return `Rs.${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000)   return `Rs.${(n / 100000).toFixed(2)} L`;
  if (n >= 1000)     return `Rs.${(n / 1000).toFixed(1)} K`;
  return `Rs.${n.toFixed(0)}`;
}

export function exportPortfolioPdf(rows, filename = 'portfolio.pdf') {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a3' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Portfolio', 40, 40);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  const counts = { red: 0, amber: 0, green: 0, unrated: 0 };
  for (const r of rows) counts[r.scheduleRag] = (counts[r.scheduleRag] ?? 0) + 1;
  doc.text(
    `${rows.length} projects · Red: ${counts.red} · Amber: ${counts.amber} · Green: ${counts.green} · Not rated: ${counts.unrated}    Generated ${new Date().toLocaleString()}`,
    40, 58,
  );
  doc.setTextColor(0);

  autoTable(doc, {
    startY: 74,
    head: [[
      'Project', 'Campus', 'Status', 'Tasks Done', 'Progress',
      'vs Plan', 'Planned Finish', 'Forecast', 'Schedule',
      'Budget', 'Spent', 'Cost',
    ]],
    body: rows.map((r) => ([
      r.project.name,
      r.department,
      r.project.status,
      `${r.tasksDonePct}%`,
      `${r.metricProgress}% / ${r.plannedProgress}%`,
      `${r.vsPlanDeltaPts >= 0 ? '+' : ''}${r.vsPlanDeltaPts}%`,
      fmtDate(r.plannedFinish),
      fmtDate(r.forecastFinish) + (r.forecastDeltaDays !== 0 ? ` (${r.forecastDeltaDays > 0 ? '+' : ''}${r.forecastDeltaDays}d)` : ''),
      r.scheduleRag.toUpperCase(),
      fmtRupee(r.budget),
      fmtRupee(r.spent) + (r.budget > 0 ? ` (${r.spentPctOfBudget}%)` : ''),
      r.costRag.toUpperCase(),
    ])),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [21, 86, 133], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 250, 255] },
    columnStyles: { 0: { fontStyle: 'bold' } },
    didParseCell: (data) => {
      if (data.section !== 'body') return;
      if (data.column.index === 8 || data.column.index === 11) {
        const key = String(data.cell.raw || '').toLowerCase();
        const rgb = RAG_COLOR[key];
        if (rgb) {
          data.cell.styles.fillColor = rgb;
          data.cell.styles.textColor = 255;
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.halign = 'center';
        }
      }
    },
  });

  doc.save(filename);
}
