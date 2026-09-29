import { describe, it, expect, vi, beforeEach } from 'vitest';

const update = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const single = vi.fn();

vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: {
    from: () => ({
      update: (...a) => update(...a),
    }),
  },
}));

// Chain: from('profiles').update(patch).eq('id', id).select().single()
function chain(finalResult) {
  update.mockReturnValue({ eq: (...a) => { eq(...a); return { select: (...b) => { select(...b); return { single: () => Promise.resolve(finalResult) }; } }; } });
}

const { updateProfileRoles, ALL_ROLES } = await import('../src/services/roles.js');

describe('updateProfileRoles', () => {
  beforeEach(() => {
    update.mockReset(); eq.mockReset(); select.mockReset(); single.mockReset();
  });

  it('deduplicates, filters invalid roles, and picks project_admin as primary', async () => {
    chain({ data: { id: 'p1', roles: ['project_admin', 'member'], role: 'project_admin' }, error: null });
    const result = await updateProfileRoles('p1', ['project_admin', 'member', 'nonsense', 'project_admin']);
    expect(update).toHaveBeenCalledWith({ roles: ['project_admin', 'member'], role: 'project_admin' });
    expect(eq).toHaveBeenCalledWith('id', 'p1');
    expect(result.role).toBe('project_admin');
  });

  it('falls back to it_admin then project_manager then member for primary', async () => {
    chain({ data: {}, error: null });
    await updateProfileRoles('p1', ['it_admin', 'member']);
    expect(update).toHaveBeenLastCalledWith({ roles: ['it_admin', 'member'], role: 'it_admin' });

    chain({ data: {}, error: null });
    await updateProfileRoles('p1', ['project_manager', 'member']);
    expect(update).toHaveBeenLastCalledWith({ roles: ['project_manager', 'member'], role: 'project_manager' });

    chain({ data: {}, error: null });
    await updateProfileRoles('p1', ['member']);
    expect(update).toHaveBeenLastCalledWith({ roles: ['member'], role: 'member' });
  });

  it('throws when Supabase returns an error', async () => {
    chain({ data: null, error: new Error('rls denied') });
    await expect(updateProfileRoles('p1', ['member'])).rejects.toThrow(/rls/i);
  });

  it('exposes ALL_ROLES with the expected five values (includes leadership)', () => {
    expect(ALL_ROLES).toEqual(['project_admin', 'leadership', 'it_admin', 'project_manager', 'member']);
  });
});
