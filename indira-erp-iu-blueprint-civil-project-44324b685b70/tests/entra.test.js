import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...a) => invoke(...a) } },
}));

const { searchEntraDirectory } = await import('../src/services/entra.js');

describe('searchEntraDirectory', () => {
  beforeEach(() => invoke.mockReset());

  it('returns [] without calling the function for queries under 2 chars', async () => {
    const out = await searchEntraDirectory('a');
    expect(invoke).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it('invokes search-entra with trimmed query and returns users', async () => {
    invoke.mockResolvedValueOnce({ data: { users: [{ id: '1', displayName: 'Alice' }] }, error: null });
    const out = await searchEntraDirectory('  alice  ');
    expect(invoke).toHaveBeenCalledWith('search-entra', { body: { query: 'alice' } });
    expect(out).toHaveLength(1);
    expect(out[0].displayName).toBe('Alice');
  });

  it('maps 403 to a friendly admin-only error', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'nope', context: { status: 403 } } });
    await expect(searchEntraDirectory('alice')).rejects.toThrow(/only project admins/i);
  });

  it('maps 401 to a re-signin prompt', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { message: 'x', context: { status: 401 } } });
    await expect(searchEntraDirectory('alice')).rejects.toThrow(/sign in again/i);
  });
});
