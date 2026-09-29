import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

const { globalSearch } = await import('../src/services/search.js');

function stubTable(rows) {
  const chain = {
    select: () => chain,
    or: () => chain,
    ilike: () => chain,
    limit: () => Promise.resolve({ data: rows, error: null }),
  };
  return chain;
}

describe('globalSearch', () => {
  beforeEach(() => from.mockReset());

  it('returns [] for queries shorter than 2 chars', async () => {
    const result = await globalSearch('a');
    expect(result).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('queries users only when no admin role is present', async () => {
    from.mockImplementation((table) => {
      if (table === 'profiles') return stubTable([{ id: 'u1', email: 'a@x.edu', first_name: 'A', last_name: '' }]);
      return stubTable([]);
    });
    const results = await globalSearch('brid');
    expect(from).toHaveBeenCalledWith('profiles');
    expect(from).not.toHaveBeenCalledWith('project_templates');
    expect(from).not.toHaveBeenCalledWith('approval_authorities');
    expect(results.map((r) => r.type)).toEqual(['User']);
  });

  it('queries templates, tasks, milestones when isItAdmin', async () => {
    from.mockImplementation((table) => {
      if (table === 'profiles') return stubTable([]);
      if (table === 'project_templates') return stubTable([{ id: 't1', name: 'Bridge', project_types: { name: 'Civil' } }]);
      if (table === 'tasks') return stubTable([{ id: 'k1', name: 'Survey', phase: 'pre_project', project_templates: { name: 'Bridge' } }]);
      if (table === 'milestones') return stubTable([{ id: 'm1', name: 'Foundation', phase: 'project', project_templates: { name: 'Bridge' } }]);
      return stubTable([]);
    });
    const results = await globalSearch('brid', { isItAdmin: true });
    expect(from).toHaveBeenCalledWith('project_templates');
    expect(from).toHaveBeenCalledWith('tasks');
    expect(from).toHaveBeenCalledWith('milestones');
    expect(from).not.toHaveBeenCalledWith('approval_authorities');
    const types = results.map((r) => r.type);
    expect(types).toContain('Template');
    expect(types).toContain('Task');
    expect(types).toContain('Milestone');
  });

  it('does not query approval_authorities (deprecated master)', async () => {
    from.mockImplementation((table) => stubTable(table === 'profiles' ? [{ id: 'u1', email: 'a@x.edu', first_name: 'A', last_name: '' }] : []));
    const results = await globalSearch('com', { isAdmin: true });
    expect(from).not.toHaveBeenCalledWith('approval_authorities');
    expect(results.some((r) => r.type === 'Approval Group')).toBe(false);
  });

  it('shapes results with type, label, sublabel, to', async () => {
    from.mockImplementation((table) => {
      if (table === 'project_templates') return stubTable([{ id: 't1', name: 'Bridge', project_types: { name: 'Civil' } }]);
      return stubTable([]);
    });
    const results = await globalSearch('brid', { isItAdmin: true });
    const tpl = results.find((r) => r.type === 'Template');
    expect(tpl.label).toBe('Bridge');
    expect(tpl.sublabel).toBe('Civil');
    expect(tpl.to).toBe('/masters/it/project-template');
  });

  it('formats task sublabel with template + phase label', async () => {
    from.mockImplementation((table) => {
      if (table === 'tasks') return stubTable([{ id: 'k1', name: 'Survey', phase: 'pre_project', project_templates: { name: 'Bridge' } }]);
      return stubTable([]);
    });
    const results = await globalSearch('sur', { isItAdmin: true });
    const task = results.find((r) => r.type === 'Task');
    expect(task.sublabel).toBe('Bridge · Pre-project');
  });

  it('returns empty for a category on error, without failing overall', async () => {
    from.mockImplementation((table) => {
      if (table === 'tasks') return { select: () => ({ ilike: () => ({ limit: () => Promise.resolve({ data: null, error: new Error('bad') }) }) }) };
      return stubTable([]);
    });
    const results = await globalSearch('x');
    expect(Array.isArray(results)).toBe(true);
    expect(results.find((r) => r.type === 'Task')).toBeUndefined();
  });
});
