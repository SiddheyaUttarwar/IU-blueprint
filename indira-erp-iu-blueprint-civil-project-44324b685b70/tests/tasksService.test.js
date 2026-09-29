import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

const svc = await import('../src/services/tasks.js');

describe('tasks service', () => {
  beforeEach(() => from.mockReset());

  it('rejects missing template', async () => {
    await expect(svc.createTaskWithSubtasks({ templateId: '', phase: 'project', name: 'X' })).rejects.toThrow(/template/i);
  });

  it('rejects missing phase', async () => {
    await expect(svc.createTaskWithSubtasks({ templateId: 't1', phase: '', name: 'X' })).rejects.toThrow(/phase/i);
  });

  it('rejects empty name', async () => {
    await expect(svc.createTaskWithSubtasks({ templateId: 't1', phase: 'project', name: '  ' })).rejects.toThrow(/name/i);
  });

  it('creates a task with no subtasks', async () => {
    const parent = { id: 'p1', name: 'Root' };
    from.mockReturnValueOnce({
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: parent, error: null }) }) }),
    });
    const out = await svc.createTaskWithSubtasks({ templateId: 't1', phase: 'project', name: 'Root' });
    expect(out.task).toEqual(parent);
    expect(out.subtasks).toEqual([]);
  });

  it('creates parent + subtasks in two writes, filters empty subtask names', async () => {
    const parent = { id: 'p1', name: 'Root' };
    const subs = [{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }];
    const insertParent = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: parent, error: null }) }) }));
    const insertSubs = vi.fn(() => ({ select: () => Promise.resolve({ data: subs, error: null }) }));
    from.mockReturnValueOnce({ insert: insertParent })
        .mockReturnValueOnce({ insert: insertSubs });

    const out = await svc.createTaskWithSubtasks({
      templateId: 't1', phase: 'project', name: 'Root', subtasks: ['A', '  ', 'B', ''],
    });

    expect(insertSubs).toHaveBeenCalledTimes(1);
    const args = insertSubs.mock.calls[0][0];
    expect(args).toHaveLength(2);
    expect(args.map((r) => r.name)).toEqual(['A', 'B']);
    expect(args.every((r) => r.parent_task_id === 'p1')).toBe(true);
    expect(out.subtasks).toEqual(subs);
  });

  it('deletes parent if subtask insert fails', async () => {
    const parent = { id: 'p1' };
    const insertParent = vi.fn(() => ({ select: () => ({ single: () => Promise.resolve({ data: parent, error: null }) }) }));
    const insertSubs = vi.fn(() => ({ select: () => Promise.resolve({ data: null, error: new Error('bad') }) }));
    const del = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    from.mockReturnValueOnce({ insert: insertParent })
        .mockReturnValueOnce({ insert: insertSubs })
        .mockReturnValueOnce({ delete: del });
    await expect(svc.createTaskWithSubtasks({ templateId: 't1', phase: 'project', name: 'Root', subtasks: ['A'] }))
      .rejects.toThrow(/bad/);
    expect(del).toHaveBeenCalled();
  });

  it('phaseLabel maps enums to friendly labels', () => {
    expect(svc.phaseLabel('pre_project')).toBe('Pre-project');
    expect(svc.phaseLabel('project')).toBe('Project');
    expect(svc.phaseLabel('unknown')).toBe('unknown');
  });
});
