import { describe, it, expect, vi, beforeEach } from 'vitest';
import { exportToCsv } from '../src/lib/exportCsv.js';

describe('exportToCsv', () => {
  let anchor;
  beforeEach(() => {
    anchor = { setAttribute: vi.fn(), click: vi.fn(), href: '' };
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => anchor);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => anchor);
    global.URL.createObjectURL = vi.fn(() => 'blob:x');
    global.URL.revokeObjectURL = vi.fn();
  });

  it('throws when no columns are provided', () => {
    expect(() => exportToCsv({ filename: 'x', columns: [], rows: [] })).toThrow(/columns/);
  });

  it('creates a CSV blob, triggers download, and appends .csv suffix', () => {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'email', label: 'Email' },
    ];
    const rows = [{ name: 'Alice, A.', email: 'a@x.edu' }, { name: 'Bob', email: 'b@x.edu' }];
    exportToCsv({ filename: 'users', columns, rows });
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(anchor.setAttribute).toHaveBeenCalledWith('download', 'users.csv');
    expect(anchor.click).toHaveBeenCalled();
  });

  it('respects an existing .csv suffix', () => {
    exportToCsv({ filename: 'report.csv', columns: [{ key: 'a' }], rows: [] });
    expect(anchor.setAttribute).toHaveBeenCalledWith('download', 'report.csv');
  });

  it('uses value function when provided', () => {
    const columns = [{ key: 'full', label: 'Full', value: (r) => `${r.first} ${r.last}` }];
    const rows = [{ first: 'A', last: 'B' }];
    expect(() => exportToCsv({ filename: 'x', columns, rows })).not.toThrow();
  });
});
