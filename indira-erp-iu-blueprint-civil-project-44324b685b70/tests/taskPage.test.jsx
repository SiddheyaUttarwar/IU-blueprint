import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function renderPage(ui) { return render(<MemoryRouter>{ui}</MemoryRouter>); }

const authValue = { profile: { id: 'admin-1' } };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }));

const listProjectTemplates = vi.fn();
vi.mock('../src/services/projectTemplates.js', () => ({
  listProjectTemplates: (...a) => listProjectTemplates(...a),
}));

const listTasks = vi.fn();
const createTaskWithSubtasks = vi.fn();
const removeTask = vi.fn();
const addSubtask = vi.fn();
vi.mock('../src/services/tasks.js', async () => {
  const actual = await vi.importActual('../src/services/tasks.js');
  return {
    ...actual,
    listTasks: (...a) => listTasks(...a),
    createTaskWithSubtasks: (...a) => createTaskWithSubtasks(...a),
    removeTask: (...a) => removeTask(...a),
    addSubtask: (...a) => addSubtask(...a),
  };
});

const { default: TaskPage } = await import('../src/pages/masters/it/Task.jsx');

const TEMPLATES = [{ id: 'tpl1', name: 'Bridge' }];
const TASKS = [
  { id: 'r1', name: 'Site survey', project_template_id: 'tpl1', phase: 'pre_project', parent_task_id: null, project_templates: { id: 'tpl1', name: 'Bridge' } },
  { id: 's1', name: 'Take measurements', project_template_id: 'tpl1', phase: 'pre_project', parent_task_id: 'r1', project_templates: { id: 'tpl1', name: 'Bridge' } },
];

describe('Task page', () => {
  beforeEach(() => {
    listProjectTemplates.mockReset().mockResolvedValue(TEMPLATES);
    listTasks.mockReset().mockResolvedValue(TASKS);
    createTaskWithSubtasks.mockReset();
    removeTask.mockReset();
    addSubtask.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders tasks grouped by template with subtasks nested', async () => {
    renderPage(<TaskPage />);
    await waitFor(() => expect(screen.getByText('Site survey')).toBeInTheDocument());
    expect(screen.getByText('Take measurements')).toBeInTheDocument();
    expect(screen.getAllByText('Bridge').length).toBeGreaterThan(0);
  });

  it('adds a task with two subtasks', async () => {
    const parent = { id: 'r2', name: 'Excavation', project_template_id: 'tpl1', phase: 'project', parent_task_id: null, project_templates: { id: 'tpl1', name: 'Bridge' } };
    const subs = [
      { id: 'x1', name: 'Dig north', project_template_id: 'tpl1', phase: 'project', parent_task_id: 'r2', project_templates: { id: 'tpl1', name: 'Bridge' } },
      { id: 'x2', name: 'Dig south', project_template_id: 'tpl1', phase: 'project', parent_task_id: 'r2', project_templates: { id: 'tpl1', name: 'Bridge' } },
    ];
    createTaskWithSubtasks.mockResolvedValue({ task: parent, subtasks: subs });

    renderPage(<TaskPage />);
    await waitFor(() => expect(screen.getByText('Site survey')).toBeInTheDocument());

    const [templateSel, phaseSel] = screen.getAllByRole('combobox');
    fireEvent.change(templateSel, { target: { value: 'tpl1' } });
    fireEvent.change(phaseSel, { target: { value: 'project' } });
    fireEvent.change(screen.getByPlaceholderText(/site survey/i), { target: { value: 'Excavation' } });

    fireEvent.click(screen.getByRole('button', { name: /add subtask/i }));
    fireEvent.click(screen.getByRole('button', { name: /add subtask/i }));
    const subInputs = screen.getAllByPlaceholderText(/^subtask \d+$/i);
    fireEvent.change(subInputs[0], { target: { value: 'Dig north' } });
    fireEvent.change(subInputs[1], { target: { value: 'Dig south' } });

    fireEvent.click(screen.getByRole('button', { name: /^add task$/i }));

    await waitFor(() => expect(createTaskWithSubtasks).toHaveBeenCalledWith(expect.objectContaining({
      templateId: 'tpl1', phase: 'project', name: 'Excavation', subtasks: ['Dig north', 'Dig south'],
    })));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('deletes a task after confirmation', async () => {
    removeTask.mockResolvedValue();
    renderPage(<TaskPage />);
    await waitFor(() => expect(screen.getByText('Site survey')).toBeInTheDocument());
    const row = screen.getByText('Site survey').closest('.task-item');
    fireEvent.click(row.querySelector('button[aria-label^="Delete"]'));
    await waitFor(() => expect(removeTask).toHaveBeenCalledWith('r1'));
  });

  it('adds a subtask to an existing task via the inline form', async () => {
    const created = { id: 's2', name: 'Draw plan', project_template_id: 'tpl1', phase: 'pre_project', parent_task_id: 'r1', project_templates: { id: 'tpl1', name: 'Bridge' } };
    addSubtask.mockResolvedValue(created);
    renderPage(<TaskPage />);
    await waitFor(() => expect(screen.getByText('Site survey')).toBeInTheDocument());
    const row = screen.getByText('Site survey').closest('.task-item');
    fireEvent.click(row.querySelector('button.btn-secondary'));
    fireEvent.change(screen.getByPlaceholderText(/subtask name/i), { target: { value: 'Draw plan' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    await waitFor(() => expect(addSubtask).toHaveBeenCalledWith(expect.objectContaining({
      parentTaskId: 'r1', templateId: 'tpl1', phase: 'pre_project', name: 'Draw plan',
    })));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});
