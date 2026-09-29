import { describe, it, expect, vi, beforeEach } from 'vitest';

const from = vi.fn();
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { from: (...a) => from(...a) },
}));

const svc = await import('../src/services/templateStructure.js');
const { equalSplit, sumWeights, validateStructure, flattenForSave, inflateFromDb, PHASES, indentNode, outdentNode } = svc;

describe('equalSplit', () => {
  it('returns [] for 0', () => expect(equalSplit(0)).toEqual([]));
  it('splits 100 into 4 exact quarters', () => expect(equalSplit(4)).toEqual([25, 25, 25, 25]));
  it('splits 100 into 3 with the remainder on the last', () => {
    const r = equalSplit(3);
    expect(r.length).toBe(3);
    expect(r[0]).toBeCloseTo(33.33, 2);
    expect(r[2]).toBeCloseTo(33.34, 2);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
  it('splits 100 into 6', () => {
    const r = equalSplit(6);
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
  });
});

describe('sumWeights', () => {
  it('sums numeric weight_pct values', () => {
    expect(sumWeights([{ weight_pct: 25 }, { weight_pct: 25 }, { weight_pct: 50 }])).toBe(100);
  });
  it('treats missing/non-numeric as 0', () => {
    expect(sumWeights([{}, { weight_pct: '10' }, { weight_pct: null }])).toBe(10);
  });
});

describe('validateStructure', () => {
  function taskOf(o) {
    return {
      name: 'X', is_mandatory: true, weight_pct: 100, progress_metric: 'done_not_done',
      quantity_value: null, quantity_unit: null, children: [], ...o,
    };
  }
  function state(prj = { tasks: [], milestones: [] }) {
    return { project: prj };
  }

  it('passes for an empty structure', () => {
    expect(validateStructure(state())).toEqual([]);
  });

  it('flags weight mismatch', () => {
    const s = state({ tasks: [taskOf({ weight_pct: 60 })], milestones: [] });
    const errs = validateStructure(s);
    expect(errs.some((e) => /add up to 60% — they must total exactly 100%/i.test(e))).toBe(true);
  });

  it('flags duplicate task names case-insensitively', () => {
    const s = state({
      tasks: [taskOf({ name: 'Foundation', weight_pct: 50 }), taskOf({ name: 'FOUNDATION', weight_pct: 50 })],
      milestones: [],
    });
    const errs = validateStructure(s);
    expect(errs.some((e) => /Duplicate task name "FOUNDATION"/i.test(e.message))).toBe(true);
  });

  it('does not require quantity value or unit at template time (PM enters them at project creation)', () => {
    const s = state({
      tasks: [taskOf({ name: 'Material', weight_pct: 100, progress_metric: 'quantity' })],
      milestones: [],
    });
    const errs = validateStructure(s);
    expect(errs.some((e) => /quantity/i.test(e))).toBe(false);
  });

  it('flags subtask weight mismatch vs parent', () => {
    const s = state({
      tasks: [taskOf({
        name: 'P', weight_pct: 100,
        children: [{ name: 'A', weight_pct: 20, progress_metric: 'done_not_done' }, { name: 'B', weight_pct: 20, progress_metric: 'done_not_done' }],
      })],
      milestones: [],
    });
    const errs = validateStructure(s);
    expect(errs.some((e) => /add up to 40%/i.test(e.message))).toBe(true);
  });

  it('flags dependency on a task listed below', () => {
    const t1 = taskOf({ name: 'A', weight_pct: 50 });
    const t2 = taskOf({ name: 'B', weight_pct: 50 });
    t1.tmp_id = 'a'; t2.tmp_id = 'b';
    const s = state({ tasks: [t1, t2], milestones: [] });
    const errs = validateStructure(s, [{ task_tmp_id: 'a', depends_on_tmp_id: 'b' }]);
    expect(errs.some((e) => /can only depend on tasks listed above/i.test(e))).toBe(true);
  });

  it('flags duplicate milestones case-insensitively', () => {
    const s = state({ tasks: [], milestones: [{ name: 'Kickoff' }, { name: 'KICKOFF' }] });
    const errs = validateStructure(s);
    expect(errs.some((e) => /Duplicate milestone "KICKOFF"/i.test(e.message))).toBe(true);
  });
});

describe('flattenForSave / inflateFromDb', () => {
  it('round-trips a simple structure — legacy pre_project rows collapse into project', () => {
    const dbTasks = [
      { id: 't1', version_id: 'v', phase: 'pre_project', parent_task_id: null, name: 'Root', weight_pct: 100, is_mandatory: true, progress_metric: 'done_not_done' },
      { id: 't2', version_id: 'v', phase: 'pre_project', parent_task_id: 't1', name: 'Sub', weight_pct: 100, is_mandatory: true, progress_metric: 'done_not_done' },
    ];
    const dbMs = [{ id: 'm1', version_id: 'v', phase: 'project', name: 'Kickoff' }];
    const { state } = inflateFromDb({ tasks: dbTasks, milestones: dbMs });
    expect(state.project.tasks).toHaveLength(1);
    expect(state.project.tasks[0].children).toHaveLength(1);
    expect(state.project.milestones).toHaveLength(1);

    const flat = flattenForSave(state);
    expect(flat.tasks.filter((t) => !t.parent_tmp_id)).toHaveLength(1);
    expect(flat.tasks.filter((t) => t.parent_tmp_id)).toHaveLength(1);
    expect(flat.tasks.every((t) => t.phase === 'project')).toBe(true);
    expect(flat.milestones).toHaveLength(1);
  });

  it('preserves task_type through inflate → flatten (defaults to "task", keeps "summary")', () => {
    const dbTasks = [
      { id: 't1', version_id: 'v', phase: 'project', parent_task_id: null, task_type: 'summary', name: 'Foundation', weight_pct: 100, is_mandatory: true, progress_metric: 'done_not_done' },
      { id: 't2', version_id: 'v', phase: 'project', parent_task_id: 't1', name: 'Legacy row (no task_type)', weight_pct: 100, is_mandatory: true, progress_metric: 'done_not_done' },
    ];
    const { state } = inflateFromDb({ tasks: dbTasks, milestones: [] });
    expect(state.project.tasks[0].task_type).toBe('summary');
    expect(state.project.tasks[0].children[0].task_type).toBe('task');
    const flat = flattenForSave(state);
    const root = flat.tasks.find((t) => !t.parent_tmp_id);
    const sub = flat.tasks.find((t) => t.parent_tmp_id);
    expect(root.task_type).toBe('summary');
    expect(sub.task_type).toBe('task');
  });
});

describe('loadStructure', () => {
  beforeEach(() => from.mockReset());

  it('loads tasks, milestones and deps for a version', async () => {
    function stub(rows) {
      return { select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: rows, error: null }) }) }) };
    }
    function stubNoOrder(rows) {
      return { select: () => ({ eq: () => Promise.resolve({ data: rows, error: null }) }) };
    }
    from.mockImplementation((table) => {
      if (table === 'template_tasks') return stub([{ id: 't1' }]);
      if (table === 'template_milestones') return stub([{ id: 'm1' }]);
      if (table === 'template_task_dependencies') return stubNoOrder([]);
      return stub([]);
    });
    const out = await svc.loadStructure('v1');
    expect(out.tasks).toHaveLength(1);
    expect(out.milestones).toHaveLength(1);
    expect(Array.isArray(out.dependencies)).toBe(true);
  });
});

describe('PHASES', () => {
  it('exports a single project phase (pre-project was removed)', () => {
    expect(PHASES).toEqual(['project']);
  });
});

describe('indentNode / outdentNode', () => {
  it('indent makes a node a child of its previous sibling', () => {
    const tree = [
      { tmp_id: 'a', name: 'A', children: [] },
      { tmp_id: 'b', name: 'B', children: [] },
    ];
    const res = indentNode(tree, 'b');
    expect(res.changed).toBe(true);
    expect(res.tree).toHaveLength(1);
    expect(res.tree[0].children).toHaveLength(1);
    expect(res.tree[0].children[0].tmp_id).toBe('b');
  });

  it('indent is a no-op for the first sibling', () => {
    const tree = [{ tmp_id: 'a', name: 'A', children: [] }];
    const res = indentNode(tree, 'a');
    expect(res.changed).toBe(false);
  });

  it('outdent promotes a child to be a sibling of its parent', () => {
    const tree = [
      { tmp_id: 'a', name: 'A', children: [
        { tmp_id: 'b', name: 'B', children: [] },
      ] },
    ];
    const res = outdentNode(tree, 'b');
    expect(res.changed).toBe(true);
    expect(res.tree).toHaveLength(2);
    expect(res.tree[0].tmp_id).toBe('a');
    expect(res.tree[1].tmp_id).toBe('b');
    expect(res.tree[0].children).toHaveLength(0);
  });

  it('outdent is a no-op at the root', () => {
    const tree = [{ tmp_id: 'a', name: 'A', children: [] }];
    const res = outdentNode(tree, 'a');
    expect(res.changed).toBe(false);
  });
});

describe('computeSchedule', () => {
  it('sequences leaves by dependency chain and summaries span children', async () => {
    const { computeSchedule } = svc;
    const state = {
      project: { tasks: [
        { tmp_id: 's', name: 'Design', weight_pct: 100, children: [
          { tmp_id: 'a', name: 'A', weight_pct: 50, children: [] },
          { tmp_id: 'b', name: 'B', weight_pct: 50, children: [] },
        ] },
      ], milestones: [] },
    };
    const deps = [{ task_tmp_id: 'b', depends_on_tmp_id: 'a' }];
    const { bars, maxStep } = computeSchedule(state, deps);
    expect(bars.get('a').start).toBe(1);
    expect(bars.get('b').start).toBe(2);
    // Summary spans min..max of children.
    expect(bars.get('s').start).toBe(1);
    expect(bars.get('s').end).toBe(2);
    expect(maxStep).toBe(2);
  });
});

describe('recursive flatten preserves depth', () => {
  it('flattens three levels with correct parent_tmp_id chain', () => {
    const state = {
      project: { tasks: [
        { tmp_id: 'r', name: 'Root', weight_pct: 100, task_type: 'summary', children: [
          { tmp_id: 'c', name: 'Child', weight_pct: 100, task_type: 'summary', children: [
            { tmp_id: 'g', name: 'Grand', weight_pct: 100, task_type: 'task', children: [] },
          ] },
        ] },
      ], milestones: [] },
    };
    const flat = flattenForSave(state);
    expect(flat.tasks).toHaveLength(3);
    expect(flat.tasks.find((t) => t.tmp_id === 'r').parent_tmp_id).toBeNull();
    expect(flat.tasks.find((t) => t.tmp_id === 'c').parent_tmp_id).toBe('r');
    expect(flat.tasks.find((t) => t.tmp_id === 'g').parent_tmp_id).toBe('c');
  });
});
