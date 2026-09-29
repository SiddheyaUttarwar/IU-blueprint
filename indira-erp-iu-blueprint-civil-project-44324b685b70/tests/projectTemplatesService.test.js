import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

const svc = await import('../src/services/projectTemplates.js');

describe('projectTemplates service', () => {
  beforeEach(() => from.mockReset());

  it('lists templates and flattens latest_version from the sorted versions array', async () => {
    from.mockReturnValue({
      select: () => ({
        order: () => Promise.resolve({
          data: [{
            id: 't1', name: 'Bridge', description: null, department_id: 1, project_type_id: 'pt1',
            project_types: { id: 'pt1', name: 'Civil' },
            template_versions: [
              { id: 'v1', version_no: 1, is_locked: true, created_at: 'a' },
              { id: 'v2', version_no: 2, is_locked: false, created_at: 'b' },
            ],
          }],
          error: null,
        }),
      }),
    });
    const rows = await svc.listProjectTemplates();
    expect(rows[0].latest_version.version_no).toBe(2);
    expect(rows[0].all_versions).toHaveLength(2);
  });

  it('rejects missing name', async () => {
    await expect(svc.createProjectTemplate({ name: '   ', projectTypeId: 't1' })).rejects.toThrow(/name/i);
  });

  it('rejects missing project type', async () => {
    await expect(svc.createProjectTemplate({ name: 'X', projectTypeId: '' })).rejects.toThrow(/type/i);
  });

  it('translates 23505 to friendly duplicate message on template insert', async () => {
    from.mockReturnValueOnce({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: { code: '23505' } }) }) }),
    });
    await expect(svc.createProjectTemplate({ name: 'X', projectTypeId: 't1' })).rejects.toThrow(/already exists/i);
  });

  it('creates a template + auto-inserts v1 and returns row with latest_version populated', async () => {
    const tpl = { id: 'tpl1', name: 'X', project_type_id: 't1', description: 'D', project_types: { id: 't1', name: 'Civil' } };
    const version = { id: 'v1', version_no: 1, is_locked: false, created_at: 't' };
    const insertTpl = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: tpl, error: null }) }) }));
    const insertVer = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: version, error: null }) }) }));
    from.mockReturnValueOnce({ insert: insertTpl }).mockReturnValueOnce({ insert: insertVer });

    const out = await svc.createProjectTemplate({
      name: '  X  ', projectTypeId: 't1', description: 'D', createdBy: 'u1',
    });

    expect(insertTpl).toHaveBeenCalledWith({
      name: 'X', project_type_id: 't1', department_id: null, description: 'D', created_by: 'u1', is_draft: false,
    });
    expect(insertVer).toHaveBeenCalledWith({
      template_id: 'tpl1', version_no: 1, is_locked: false, created_by: 'u1',
    });
    expect(out.latest_version.version_no).toBe(1);
  });

  it('rolls back the template if v1 insert fails', async () => {
    const tpl = { id: 'tpl1' };
    const insertTpl = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: tpl, error: null }) }) }));
    const insertVer = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: new Error('boom') }) }) }));
    const del = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    from.mockReturnValueOnce({ insert: insertTpl }).mockReturnValueOnce({ insert: insertVer }).mockReturnValueOnce({ delete: del });
    await expect(svc.createProjectTemplate({ name: 'X', projectTypeId: 't1' })).rejects.toThrow(/boom/);
    expect(del).toHaveBeenCalled();
  });

  it('deletes a template', async () => {
    const del = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    from.mockReturnValue({ delete: del });
    await expect(svc.removeProjectTemplate('t1')).resolves.toBeUndefined();
  });
});
