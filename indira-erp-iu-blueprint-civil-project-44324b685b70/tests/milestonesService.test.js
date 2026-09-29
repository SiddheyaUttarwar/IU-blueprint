import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

const svc = await import('../src/services/milestones.js');

describe('milestones service', () => {
  beforeEach(() => from.mockReset());

  it('lists milestones', async () => {
    from.mockReturnValue({
      select: () => ({ order: () => Promise.resolve({ data: [{ id: '1', name: 'M' }], error: null }) }),
    });
    const rows = await svc.listMilestones();
    expect(rows).toHaveLength(1);
  });

  it('rejects missing template', async () => {
    await expect(svc.createMilestone({ templateId: '', phase: 'project', name: 'M' })).rejects.toThrow(/template/i);
  });

  it('rejects missing phase', async () => {
    await expect(svc.createMilestone({ templateId: 't1', phase: '', name: 'M' })).rejects.toThrow(/phase/i);
  });

  it('rejects empty name', async () => {
    await expect(svc.createMilestone({ templateId: 't1', phase: 'project', name: '  ' })).rejects.toThrow(/name/i);
  });

  it('translates 23505 to friendly duplicate message', async () => {
    from.mockReturnValue({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505', message: 'dup' } }) }) }),
    });
    await expect(svc.createMilestone({ templateId: 't1', phase: 'project', name: 'M' })).rejects.toThrow(/already exists/i);
  });

  it('creates a milestone with trimmed name', async () => {
    const insert = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: { id: '1', name: 'M', project_templates: { id: 't1', name: 'Bridge' } }, error: null }) }) }));
    from.mockReturnValue({ insert });
    const out = await svc.createMilestone({ templateId: 't1', phase: 'project', name: '  M  ', createdBy: 'u1' });
    expect(insert).toHaveBeenCalledWith({ project_template_id: 't1', phase: 'project', name: 'M', created_by: 'u1' });
    expect(out.name).toBe('M');
  });

  it('deletes a milestone', async () => {
    const del = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    from.mockReturnValue({ delete: del });
    await expect(svc.removeMilestone('1')).resolves.toBeUndefined();
  });
});
