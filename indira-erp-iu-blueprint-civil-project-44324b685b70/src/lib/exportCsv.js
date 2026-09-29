function escapeCell(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'string' ? value : String(value);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportToCsv({ filename, columns, rows }) {
  if (!columns?.length) throw new Error('exportToCsv: columns required');
  const header = columns.map((c) => escapeCell(c.label ?? c.key)).join(',');
  const body = (rows ?? []).map((row) =>
    columns.map((c) => escapeCell(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','),
  );
  const csv = [header, ...body].join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
