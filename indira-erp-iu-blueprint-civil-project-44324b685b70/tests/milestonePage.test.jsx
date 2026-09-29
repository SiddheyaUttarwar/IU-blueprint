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

const listMilestones = vi.fn();
const createMilestone = vi.fn();
const removeMilestone = vi.fn();
vi.mock('../src/services/milestones.js', () => ({
  listMilestones: (...a) => listMilestones(...a),
  createMilestone: (...a) => createMilestone(...a),
  removeMilestone: (...a) => removeMilestone(...a),
}));

const { default: Milestone } = await import('../src/pages/masters/it/Milestone.jsx');

const TEMPLATES = [{ id: 'tpl1', name: 'Bridge' }];
const MILESTONES = [
  { id: 'm1', name: 'Foundation completed', project_template_id: 'tpl1', phase: 'project', project_templates: { id: 'tpl1', name: 'Bridge' } },
  { id: 'm2', name: 'Design signed off', project_template_id: 'tpl1', phase: 'pre_project', project_templates: { id: 'tpl1', name: 'Bridge' } },
];

describe('Milestone page', () => {
  beforeEach(() => {
    listProjectTemplates.mockReset().mockResolvedValue(TEMPLATES);
    listMilestones.mockReset().mockResolvedValue(MILESTONES);
    createMilestone.mockReset();
    removeMilestone.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders milestones grouped by template + phase', async () => {
    renderPage(<Milestone />);
    await waitFor(() => expect(screen.getByText('Foundation completed')).toBeInTheDocument());
    expect(screen.getByText('Design signed off')).toBeInTheDocument();
  });

  it('blocks submit with inline errors when required fields are empty', async () => {
    renderPage(<Milestone />);
    await waitFor(() => expect(screen.getByText('Foundation completed')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add milestone/i }));
    expect(screen.getByText(/project template is required/i)).toBeInTheDocument();
    expect(screen.getByText(/milestone name is required/i)).toBeInTheDocument();
    expect(createMilestone).not.toHaveBeenCalled();
  });

  it('shows inline dup error on client-side name clash within same template + phase', async () => {
    renderPage(<Milestone />);
    await waitFor(() => expect(screen.getByText('Foundation completed')).toBeInTheDocument());
    const [templateSel, phaseSel] = screen.getAllByRole('combobox');
    fireEvent.change(templateSel, { target: { value: 'tpl1' } });
    fireEvent.change(phaseSel, { target: { value: 'project' } });
    fireEvent.change(screen.getByPlaceholderText(/foundation completed/i), { target: { value: 'Foundation completed' } });
    fireEvent.click(screen.getByRole('button', { name: /add milestone/i }));
    expect(screen.getByText(/already exists in this template & phase/i)).toBeInTheDocument();
    expect(createMilestone).not.toHaveBeenCalled();
  });

  it('adds a milestone and fires a success toast', async () => {
    const created = { id: 'm3', name: 'Grid connected', project_template_id: 'tpl1', phase: 'project', project_templates: { id: 'tpl1', name: 'Bridge' } };
    createMilestone.mockResolvedValue(created);
    renderPage(<Milestone />);
    await waitFor(() => expect(screen.getByText('Foundation completed')).toBeInTheDocument());
    const [templateSel, phaseSel] = screen.getAllByRole('combobox');
    fireEvent.change(templateSel, { target: { value: 'tpl1' } });
    fireEvent.change(phaseSel, { target: { value: 'project' } });
    fireEvent.change(screen.getByPlaceholderText(/foundation completed/i), { target: { value: 'Grid connected' } });
    fireEvent.click(screen.getByRole('button', { name: /add milestone/i }));
    await waitFor(() => expect(createMilestone).toHaveBeenCalledWith({ templateId: 'tpl1', phase: 'project', name: 'Grid connected', createdBy: 'admin-1' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('deletes a milestone after confirmation', async () => {
    removeMilestone.mockResolvedValue();
    renderPage(<Milestone />);
    await waitFor(() => expect(screen.getByText('Foundation completed')).toBeInTheDocument());
    const row = screen.getByText('Foundation completed').closest('.task-item');
    fireEvent.click(row.querySelector('button[aria-label^="Delete"]'));
    await waitFor(() => expect(removeMilestone).toHaveBeenCalledWith('m1'));
  });
});
