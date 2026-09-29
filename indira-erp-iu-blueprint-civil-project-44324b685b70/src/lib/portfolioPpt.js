import PptxGenJS from 'pptxgenjs';

const RAG_HEX = { red: 'B02A37', amber: 'E0A500', green: '166534', unrated: '8B9DAD' };

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'; }
function fmtRupee(n) {
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000000) return `Rs.${(n / 10000000).toFixed(2)} Cr`;
  if (n >= 100000)   return `Rs.${(n / 100000).toFixed(2)} L`;
  if (n >= 1000)     return `Rs.${(n / 1000).toFixed(1)} K`;
  return `Rs.${n.toFixed(0)}`;
}

export function exportPortfolioPpt(rows, filename = 'portfolio.pptx') {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.333 × 7.5 in

  // Cover slide
  const cover = pptx.addSlide();
  cover.background = { color: '155685' };
  cover.addText('Portfolio Snapshot', { x: 0.6, y: 2.2, w: 12, h: 1.2, fontSize: 48, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI' });
  cover.addText(`Generated ${new Date().toLocaleString()}`, { x: 0.6, y: 3.5, w: 12, h: 0.5, fontSize: 16, color: 'D5DDE6', fontFace: 'Segoe UI' });
  const counts = { red: 0, amber: 0, green: 0, unrated: 0 };
  for (const r of rows) counts[r.scheduleRag] = (counts[r.scheduleRag] ?? 0) + 1;
  cover.addText(
    `${rows.length} projects · Red ${counts.red} · Amber ${counts.amber} · Green ${counts.green} · Not rated ${counts.unrated}`,
    { x: 0.6, y: 4.2, w: 12, h: 0.5, fontSize: 18, color: 'FFFFFF', fontFace: 'Segoe UI' },
  );

  // Summary table slide (all rows on one wide slide)
  const summary = pptx.addSlide();
  summary.addText('All Projects', { x: 0.3, y: 0.2, w: 12, h: 0.5, fontSize: 22, bold: true, color: '155685' });
  const tableHead = [
    { text: 'Project', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Campus', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Status', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Tasks Done', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Progress', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'vs Plan', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Planned Finish', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Forecast', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Sched', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Budget', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Spent', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
    { text: 'Cost', options: { bold: true, fill: '155685', color: 'FFFFFF' } },
  ];
  const tableBody = rows.slice(0, 20).map((r) => ([
    { text: r.project.name, options: { bold: true } },
    { text: r.department },
    { text: r.project.status },
    { text: `${r.tasksDonePct}%` },
    { text: `${r.metricProgress}% / ${r.plannedProgress}%` },
    { text: `${r.vsPlanDeltaPts >= 0 ? '+' : ''}${r.vsPlanDeltaPts}` },
    { text: fmtDate(r.plannedFinish) },
    { text: fmtDate(r.forecastFinish) + (r.forecastDeltaDays !== 0 ? ` (${r.forecastDeltaDays > 0 ? '+' : ''}${r.forecastDeltaDays}d)` : '') },
    { text: r.scheduleRag.toUpperCase(), options: { fill: RAG_HEX[r.scheduleRag], color: 'FFFFFF', bold: true, align: 'center' } },
    { text: fmtRupee(r.budget) },
    { text: fmtRupee(r.spent) + (r.budget > 0 ? ` (${r.spentPctOfBudget}%)` : '') },
    { text: r.costRag.toUpperCase(), options: { fill: RAG_HEX[r.costRag], color: 'FFFFFF', bold: true, align: 'center' } },
  ]));
  summary.addTable([tableHead, ...tableBody], {
    x: 0.3, y: 0.8, w: 12.7, colW: [1.6, 0.8, 0.9, 0.8, 1.3, 0.7, 1.1, 1.3, 0.7, 1.0, 1.2, 0.7],
    fontSize: 9, fontFace: 'Segoe UI', valign: 'middle', border: { pt: 0.5, color: 'D5DDE6' },
  });
  if (rows.length > 20) {
    summary.addText(`(+${rows.length - 20} more — see Excel export for full list)`, { x: 0.3, y: 7.1, w: 12, h: 0.3, fontSize: 10, italic: true, color: '888888' });
  }

  // One card per project (first 12) for a "deck" style
  rows.slice(0, 12).forEach((r) => {
    const s = pptx.addSlide();
    s.addText(r.project.name, { x: 0.4, y: 0.3, w: 12, h: 0.7, fontSize: 28, bold: true, color: '155685' });
    s.addText(`${r.department} · ${r.project.status}`, { x: 0.4, y: 1.0, w: 12, h: 0.4, fontSize: 14, color: '666666' });
    // Metric progress bar
    s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.7, w: 12, h: 0.4, fill: { color: 'EEF2F6' }, line: { color: 'EEF2F6' } });
    s.addShape(pptx.ShapeType.rect, { x: 0.4, y: 1.7, w: 12 * (Math.max(0, Math.min(100, r.metricProgress)) / 100), h: 0.4, fill: { color: '14B8A6' }, line: { color: '14B8A6' } });
    s.addText(`Progress ${r.metricProgress}% (vs planned ${r.plannedProgress}%)`, { x: 0.4, y: 2.2, w: 12, h: 0.4, fontSize: 12, color: '333333' });

    // KPI grid
    const kpi = [
      ['Schedule',       r.scheduleRag.toUpperCase(), RAG_HEX[r.scheduleRag]],
      ['Cost',           r.costRag.toUpperCase(),     RAG_HEX[r.costRag]],
      ['Planned Finish', fmtDate(r.plannedFinish),    'D5DDE6'],
      ['Forecast',       fmtDate(r.forecastFinish) + (r.forecastDeltaDays !== 0 ? ` (${r.forecastDeltaDays > 0 ? '+' : ''}${r.forecastDeltaDays}d)` : ''), 'D5DDE6'],
      ['Budget',         fmtRupee(r.budget),          'D5DDE6'],
      ['Spent',          fmtRupee(r.spent) + (r.budget > 0 ? ` (${r.spentPctOfBudget}%)` : ''), 'D5DDE6'],
    ];
    kpi.forEach(([label, val, fill], i) => {
      const col = i % 3, row = Math.floor(i / 3);
      const x = 0.4 + col * 4.3, y = 3.0 + row * 1.4;
      s.addShape(pptx.ShapeType.roundRect, { x, y, w: 4.0, h: 1.2, fill: { color: 'FFFFFF' }, line: { color: 'D5DDE6', width: 1 }, rectRadius: 0.08 });
      s.addText(label, { x: x + 0.2, y: y + 0.15, w: 3.6, h: 0.35, fontSize: 12, color: '888888', bold: true });
      const useColor = ['Schedule', 'Cost'].includes(label);
      s.addText(val, {
        x: x + 0.2, y: y + 0.5, w: 3.6, h: 0.6, fontSize: 20, bold: true,
        color: useColor ? 'FFFFFF' : '155685',
        fill: useColor ? { color: fill } : undefined,
      });
    });
  });

  pptx.writeFile({ fileName: filename });
}
