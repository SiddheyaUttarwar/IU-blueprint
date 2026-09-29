import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { parseIndentWorkbook, buildIndentTemplate } from '../src/lib/indentExcel.js';

async function buildWorkbookBuffer(rows) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('S1');
  rows.forEach((row, i) => { ws.getRow(i + 1).values = row; });
  return await wb.xlsx.writeBuffer();
}

describe('parseIndentWorkbook', () => {
  it('parses the canonical template shape', async () => {
    const buf = await buildWorkbookBuffer([
      ['Indent Number', 'IND-42'],
      ['Indent Date', '2026-09-03'],
      ['Activity', 'Boundary Wall'],
      [],
      ['Sr No', 'Item Name', 'Description', 'Unit', 'Have Qty', 'Buy Qty', 'Unit Price', 'Remark'],
      [1, 'Cement', 'OPC 43', 'Bag', 5, 50, 380, ''],
      [2, 'Steel Rod', '12 mm TMT', 'Kg', 0, 200, 62, 'Column'],
    ]);
    const result = await parseIndentWorkbook(buf);
    expect(result.errors).toEqual([]);
    expect(result.header).toEqual({ indentNumber: 'IND-42', indentDate: '2026-09-03', activity: 'Boundary Wall' });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      item_name: 'Cement', item_description: 'OPC 43', unit: 'Bag',
      have_qty: 5, buy_qty: 50, unit_price: 380, remark: null,
    });
    expect(result.items[1].remark).toBe('Column');
  });

  it('accepts alternate column names', async () => {
    const buf = await buildWorkbookBuffer([
      ['Indent #', 'A-1'],
      ['Date', '03/09/2026'],
      ['Activity Name', 'X'],
      [],
      ['S No', 'Particulars', 'Details', 'UOM', 'In Stock', 'Quantity', 'Rate', 'Remarks'],
      [1, 'Sand', 'River', 'Cft', 10, 100, 45, ''],
    ]);
    const result = await parseIndentWorkbook(buf);
    expect(result.errors).toEqual([]);
    expect(result.header.indentNumber).toBe('A-1');
    expect(result.header.indentDate).toBe('2026-09-03');
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ item_name: 'Sand', unit: 'Cft', buy_qty: 100, unit_price: 45 });
  });

  it('reports missing header labels', async () => {
    const buf = await buildWorkbookBuffer([
      ['Sr No', 'Item Name', 'Buy Qty'],
      [1, 'Cement', 10],
    ]);
    const result = await parseIndentWorkbook(buf);
    expect(result.errors).toContain('Missing "Indent Number" label + value.');
    expect(result.errors).toContain('Missing "Indent Date" label + value.');
  });

  it('reports missing item table', async () => {
    const buf = await buildWorkbookBuffer([
      ['Indent Number', 'IND-1'],
      ['Indent Date', '2026-01-01'],
    ]);
    const result = await parseIndentWorkbook(buf);
    expect(result.errors.some((e) => /item table/i.test(e))).toBe(true);
    expect(result.items).toEqual([]);
  });

  it('stops at first fully blank row after items', async () => {
    const buf = await buildWorkbookBuffer([
      ['Indent Number', 'IND-9'],
      ['Indent Date', '2026-02-02'],
      [],
      ['Sr No', 'Item Name', 'Buy Qty'],
      [1, 'A', 10],
      [2, 'B', 20],
      [],
      ['Total', '', 30],
    ]);
    const result = await parseIndentWorkbook(buf);
    expect(result.items.map((i) => i.item_name)).toEqual(['A', 'B']);
  });
});

describe('buildIndentTemplate', () => {
  it('produces a workbook that parses back cleanly', async () => {
    const buf = await buildIndentTemplate();
    const result = await parseIndentWorkbook(buf);
    expect(result.errors).toEqual([]);
    expect(result.header.indentNumber).toBe('IND-0001');
    expect(result.items.length).toBeGreaterThanOrEqual(2);
  });
});
