import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

function selectSingleChain(result) {
  return {
    insert: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }),
    update: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }) }),
    delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    select: () => ({ order: () => Promise.resolve({ data: result.data ?? [], error: result.error ?? null }) }),
  };
}

const svc = await import('../src/services/projectTypes.js');

describe('projectTypes service', () => {
  beforeEach(() => from.mockReset());

  it('lists sorted rows', async () => {
    from.mockReturnValue(selectSingleChain({ data: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }));
    const rows = await svc.listProjectTypes();
    expect(rows).toHaveLength(2);
  });

  it('rejects empty name', async () => {
    await expect(svc.createProjectType({ name: '   ' })).rejects.toThrow(/name/i);
  });

  it('translates 23505 duplicate errors to a friendly message', async () => {
    from.mockReturnValue({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'dup' } }) }) }),
    });
    await expect(svc.createProjectType({ name: 'Civil' })).rejects.toThrow(/already exists/i);
  });

  it('creates a project type with trimmed name', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: '1', name: 'Civil', is_active: true }, error: null }) }) }));
    from.mockReturnValue({ insert });
    const out = await svc.createProjectType({ name: '  Civil  ', isActive: true, createdBy: 'u1' });
    expect(insert).toHaveBeenCalledWith({ name: 'Civil', is_active: true, created_by: 'u1' });
    expect(out.name).toBe('Civil');
  });

  it('toggles is_active', async () => {
    const update = vi.fn(() => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: '1', name: 'X', is_active: false }, error: null }) }) }) }));
    from.mockReturnValue({ update });
    const out = await svc.updateProjectTypeActive('1', false);
    expect(out.is_active).toBe(false);
  });

  it('deletes a project type', async () => {
    const del = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    from.mockReturnValue({ delete: del });
    await expect(svc.removeProjectType('1')).resolves.toBeUndefined();
  });
});
