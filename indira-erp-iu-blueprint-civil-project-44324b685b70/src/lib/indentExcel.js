import ExcelJS from 'exceljs';

const HEADER_LABELS = {
  indentNumber: [/^indent\s*(no\.?|number|#)\s*:?$/i],
  indentDate: [/^(indent\s*)?date\s*:?$/i],
  activity: [/^activity(\s*name)?\s*:?$/i],
};

const ITEM_COLS = {
  sr: [/^sr\.?\s*(no\.?|#)?$/i, /^s\.?\s*no\.?$/i, /^#$/],
  name: [/^item(\s*name)?$/i, /^particulars?$/i, /^description$/i],
  description: [/^item\s*detailed\s*description$/i, /^detailed\s*description$/i, /^description$/i, /^details?$/i, /^spec(ification)?s?$/i],
  unit: [/^unit$/i, /^uom$/i],
  have: [/^quantity\s*in\s*stock$/i, /^qty\s*in\s*stock$/i, /^have(\s*qty)?$/i, /^(qty\s*)?in\s*stock$/i, /^stock$/i, /^available$/i],
  buy: [/^quantity\s*indented$/i, /^qty\s*indented$/i, /^indented\s*qty$/i, /^buy(\s*qty)?$/i, /^(qty\s*)?required$/i, /^to\s*buy$/i, /^qty$/i, /^quantity$/i],
  price: [/^amount\s*per\s*item$/i, /^amount\s*per\s*unit$/i, /^unit\s*price$/i, /^rate$/i, /^price(\s*per\s*unit)?$/i, /^price\s*of\s*1\s*item$/i],
  remark: [/^remark$/i, /^remarks?$/i, /^note$/i, /^notes?$/i],
};

function normLabel(v) {
  if (v == null) return '';
  const s = typeof v === 'object' && v.richText ? v.richText.map((r) => r.text).join('') : String(v);
  return s.replace(/\s+/g, ' ').trim();
}

function matchAny(label, patterns) {
  return patterns.some((re) => re.test(label));
}

function cellValue(cell) {
  const v = cell?.value;
  if (v == null) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if (v.richText) return v.richText.map((r) => r.text).join('');
    if ('result' in v) return v.result;
    if ('text' in v) return v.text;
    if ('hyperlink' in v && v.text) return v.text;
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
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function toNumber(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export async function parseIndentWorkbook(fileOrBuffer) {
  let buffer;
  if (fileOrBuffer instanceof ArrayBuffer || ArrayBuffer.isView(fileOrBuffer)) buffer = fileOrBuffer;
  else if (typeof fileOrBuffer?.arrayBuffer === 'function') buffer = await fileOrBuffer.arrayBuffer();
  else throw new Error('Unsupported input to parseIndentWorkbook.');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Workbook has no sheets.');

  const header = { indentNumber: '', indentDate: '', activity: '' };
  let itemHeaderRow = -1;
  const colMap = {};
  const errors = [];

  const scanRows = Math.min(ws.rowCount, 40);
  for (let r = 1; r <= scanRows; r++) {
    const row = ws.getRow(r);
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => { cells[colNumber] = cell; });

    for (let c = 1; c < cells.length; c++) {
      const label = normLabel(cellValue(cells[c]));
      if (!label) continue;
      if (matchAny(label, HEADER_LABELS.indentNumber)) {
        const v = cellValue(cells[c + 1]);
        if (v != null && v !== '') header.indentNumber = String(v).trim();
      } else if (matchAny(label, HEADER_LABELS.indentDate)) {
        const v = cellValue(cells[c + 1]);
        if (v != null && v !== '') header.indentDate = toDateString(v);
      } else if (matchAny(label, HEADER_LABELS.activity)) {
        const v = cellValue(cells[c + 1]);
        if (v != null && v !== '') header.activity = String(v).trim();
      }
    }

    const looksLikeItemHeader = cells.some((cell) => {
      const l = normLabel(cellValue(cell));
      return l && (matchAny(l, ITEM_COLS.name) || matchAny(l, ITEM_COLS.sr) || matchAny(l, ITEM_COLS.buy));
    });
    if (looksLikeItemHeader && itemHeaderRow === -1) {
      const seen = {};
      cells.forEach((cell, c) => {
        const l = normLabel(cellValue(cell));
        if (!l) return;
        for (const [key, patterns] of Object.entries(ITEM_COLS)) {
          if (seen[key]) continue;
          if (matchAny(l, patterns)) { colMap[key] = c; seen[key] = true; return; }
        }
      });
      if (colMap.name && colMap.buy) itemHeaderRow = r;
    }
  }

  if (itemHeaderRow === -1) errors.push('Could not find an item table (need columns like "Item Name" and "Quantity Indented").');
  if (!header.indentNumber) errors.push('Missing "Indent Number" label + value.');
  if (!header.indentDate) errors.push('Missing "Indent Date" label + value.');

  const items = [];
  if (itemHeaderRow !== -1) {
    for (let r = itemHeaderRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const name = normLabel(cellValue(row.getCell(colMap.name)));
      if (!name) {
        const anyVal = ['description', 'unit', 'buy', 'price'].some((k) => colMap[k] && cellValue(row.getCell(colMap[k])) != null);
        if (!anyVal) break;
        continue;
      }
      items.push({
        item_name: name,
        item_description: colMap.description ? normLabel(cellValue(row.getCell(colMap.description))) || null : null,
        unit: colMap.unit ? normLabel(cellValue(row.getCell(colMap.unit))) || null : null,
        have_qty: colMap.have ? toNumber(cellValue(row.getCell(colMap.have))) ?? 0 : 0,
        buy_qty: colMap.buy ? toNumber(cellValue(row.getCell(colMap.buy))) ?? 0 : 0,
        unit_price: colMap.price ? toNumber(cellValue(row.getCell(colMap.price))) : null,
        remark: colMap.remark ? normLabel(cellValue(row.getCell(colMap.remark))) || null : null,
      });
    }
  }

  return { header, items, errors };
}

export async function buildIndentTemplate() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Indent');

  ws.getCell('A1').value = 'Indent Number';
  ws.getCell('A1').font = { bold: true };
  ws.getCell('B1').value = 'IND-0001';

  ws.getCell('A2').value = 'Indent Date';
  ws.getCell('A2').font = { bold: true };
  ws.getCell('B2').value = new Date().toISOString().slice(0, 10);

  ws.getCell('A3').value = 'Activity';
  ws.getCell('A3').font = { bold: true };
  ws.getCell('B3').value = 'Project / activity name';

  const headers = ['Sr No', 'Item Name', 'Item Detailed Description', 'Unit', 'Quantity in Stock', 'Quantity Indented', 'Amount per Item', 'Remark'];
  const headerRow = ws.getRow(5);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F5' } };
  });

  ws.getRow(6).values = [1, 'Cement OPC 43', 'Grade 43 cement', 'Bag', 5, 50, 380, ''];
  ws.getRow(7).values = [2, 'Steel Rod', '12 mm TMT', 'Kg', 0, 200, 62, 'For column'];

  ws.columns = [
    { width: 8 }, { width: 24 }, { width: 24 }, { width: 10 },
    { width: 10 }, { width: 10 }, { width: 12 }, { width: 20 },
  ];

  return await wb.xlsx.writeBuffer();
}

export function downloadBlob(bufferOrBlob, filename) {
  const blob = bufferOrBlob instanceof Blob
    ? bufferOrBlob
    : new Blob([bufferOrBlob], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
