import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

const svc = await import('../src/services/progressUnits.js');

describe('createProgressUnit', () => {
  beforeEach(() => { from.mockReset(); svc.invalidateUnitCache(); });

  it('rejects blank name', async () => {
    await expect(svc.createProgressUnit({ name: '   ' })).rejects.toThrow(/required/i);
  });

  it('rejects >20 chars', async () => {
    await expect(svc.createProgressUnit({ name: 'x'.repeat(21) })).rejects.toThrow(/20 characters/i);
  });

  it('maps unique-violation to friendly duplicate message', async () => {
    from.mockReturnValueOnce({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505' } }) }) }),
    });
    await expect(svc.createProgressUnit({ name: 'Nos' })).rejects.toThrow(/already exists/i);
  });

  it('inserts trimmed name and busts the cache', async () => {
    // Prime the cache via getUnitNames — stub list call
    from.mockReturnValueOnce({
      select: () => ({ order: () => ({ eq: () => Promise.resolve({ data: [{ name: 'Nos' }], error: null }) }) }),
    });
    await svc.getUnitNames();
    expect(svc.cachedUnitNames()).toEqual(['Nos']);
    // Now insert — should invalidate
    const inserted = { id: 'u1', name: 'kg', is_active: true, sort_order: 0 };
    from.mockReturnValueOnce({
      insert: (row) => {
        expect(row.name).toBe('kg');
        return { select: () => ({ single: () => Promise.resolve({ data: inserted, error: null }) }) };
      },
    });
    const out = await svc.createProgressUnit({ name: '  kg  ' });
    expect(out.name).toBe('kg');
    // Cache was invalidated → cachedUnitNames returns COMMON_UNITS fallback until next fetch
    expect(svc.cachedUnitNames()).not.toEqual(['Nos']);
  });
});
