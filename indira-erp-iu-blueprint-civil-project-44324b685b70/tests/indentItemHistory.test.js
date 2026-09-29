import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/lib/notify.js', () => ({ notifyMany: vi.fn() }));

const svc = await import('../src/services/indents.js');

function chainForSelect(row) {
  return { select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: row, error: null }) }) }) };
}

describe('updateIndentItem auto-logs to indent_item_variance_history', () => {
  beforeEach(() => from.mockReset());

  it('inserts one history row per changed tracked field, with correct delta', async () => {
    const before = { id: 'i1', indent_id: 'ind1', unit_price: 100, buy_qty: 5, have_qty: 2, received_qty: 0, item_name: 'Cement' };
    const after = { ...before, unit_price: 120, buy_qty: 10 };
    const inserted = [];
    from.mockImplementation((table) => {
      if (table === 'indent_items') {
        // select-before returns the "before" row; update returns the "after" row
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: before, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: after, error: null }) }) }) }),
        };
      }
      if (table === 'indent_item_variance_history') {
        return { insert: (rows) => { inserted.push(...rows); return Promise.resolve({ error: null }); } };
      }
      return chainForSelect(null);
    });
    await svc.updateIndentItem('i1', { unit_price: 120, buy_qty: 10 }, { actorId: 'u1', reason: 'Price hike' });
    expect(inserted).toHaveLength(2);
    const priceRow = inserted.find((r) => r.field === 'unit_price');
    const qtyRow = inserted.find((r) => r.field === 'buy_qty');
    expect(priceRow.previous_value).toBe(100);
    expect(priceRow.new_value).toBe(120);
    expect(priceRow.delta).toBe(20);
    expect(priceRow.reason).toBe('Price hike');
    expect(priceRow.changed_by).toBe('u1');
    expect(qtyRow.delta).toBe(5);
  });

  it('does not log when no tracked field changed', async () => {
    const before = { id: 'i2', indent_id: 'ind1', unit_price: 100, buy_qty: 5, have_qty: 2, received_qty: 0, item_name: 'Sand', remark: 'old' };
    const after = { ...before, remark: 'new' };
    const inserted = [];
    from.mockImplementation((table) => {
      if (table === 'indent_items') {
        return {
          select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: before, error: null }) }) }),
          update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: after, error: null }) }) }) }),
        };
      }
      if (table === 'indent_item_variance_history') {
        return { insert: (rows) => { inserted.push(...rows); return Promise.resolve({ error: null }); } };
      }
      return chainForSelect(null);
    });
    await svc.updateIndentItem('i2', { remark: 'new' });
    expect(inserted).toHaveLength(0);
  });
});
