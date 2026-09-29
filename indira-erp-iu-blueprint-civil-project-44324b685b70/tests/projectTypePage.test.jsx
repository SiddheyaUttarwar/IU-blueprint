import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function renderPage(ui) { return render(<MemoryRouter>{ui}</MemoryRouter>); }

const authValue = { profile: { id: 'admin-1' } };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }));

const listProjectTypes = vi.fn();
const createProjectType = vi.fn();
const updateProjectTypeActive = vi.fn();
const removeProjectType = vi.fn();
vi.mock('../src/services/projectTypes.js', () => ({
  listProjectTypes: (...a) => listProjectTypes(...a),
  createProjectType: (...a) => createProjectType(...a),
  updateProjectTypeActive: (...a) => updateProjectTypeActive(...a),
  removeProjectType: (...a) => removeProjectType(...a),
}));

const { default: ProjectType } = await import('../src/pages/masters/it/ProjectType.jsx');

const ROWS = [
  { id: 't1', name: 'Civil', is_active: true },
  { id: 't2', name: 'Software', is_active: false },
];

describe('ProjectType page', () => {
  beforeEach(() => {
    listProjectTypes.mockReset().mockResolvedValue(ROWS);
    createProjectType.mockReset();
    updateProjectTypeActive.mockReset();
    removeProjectType.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('lists project types with correct status', async () => {
    renderPage(<ProjectType />);
    await waitFor(() => expect(screen.getByText('Civil')).toBeInTheDocument());
    const civilRow = screen.getByText('Civil').closest('tr');
    expect(civilRow).toHaveTextContent('Active');
    const swRow = screen.getByText('Software').closest('tr');
    expect(swRow).toHaveTextContent('Inactive');
  });

  it('adds a new project type and shows a success toast', async () => {
    createProjectType.mockResolvedValue({ id: 't3', name: 'Research', is_active: true });
    renderPage(<ProjectType />);
    await waitFor(() => expect(screen.getByText('Civil')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/civil construction/i), { target: { value: 'Research' } });
    fireEvent.click(screen.getByRole('button', { name: /add project type/i }));
    await waitFor(() => expect(createProjectType).toHaveBeenCalledWith({ name: 'Research', isActive: true, createdBy: 'admin-1' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByText('Research')).toBeInTheDocument();
  });

  it('toggles a project type active status', async () => {
    updateProjectTypeActive.mockResolvedValue({ id: 't1', name: 'Civil', is_active: false });
    renderPage(<ProjectType />);
    await waitFor(() => expect(screen.getByText('Civil')).toBeInTheDocument());
    const civilRow = screen.getByText('Civil').closest('tr');
    fireEvent.click(civilRow.querySelector('.status-toggle'));
    await waitFor(() => expect(updateProjectTypeActive).toHaveBeenCalledWith('t1', false));
    await waitFor(() => expect(screen.getByText('Civil').closest('tr')).toHaveTextContent('Inactive'));
  });

  it('deletes a project type after confirming', async () => {
    removeProjectType.mockResolvedValue();
    renderPage(<ProjectType />);
    await waitFor(() => expect(screen.getByText('Civil')).toBeInTheDocument());
    const civilRow = screen.getByText('Civil').closest('tr');
    fireEvent.click(civilRow.querySelector('button[aria-label^="Delete"]'));
    await waitFor(() => expect(removeProjectType).toHaveBeenCalledWith('t1'));
    await waitFor(() => expect(screen.queryByText('Civil')).not.toBeInTheDocument());
  });

  it('shows an error toast when create fails on the server', async () => {
    createProjectType.mockRejectedValue(new Error('Server rejected the request.'));
    renderPage(<ProjectType />);
    await waitFor(() => expect(screen.getByText('Civil')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/civil construction/i), { target: { value: 'BrandNew' } });
    fireEvent.click(screen.getByRole('button', { name: /add project type/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/server rejected/i)));
  });

  it('shows an inline error if the name is a client-side duplicate', async () => {
    renderPage(<ProjectType />);
    await waitFor(() => expect(screen.getByText('Civil')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/civil construction/i), { target: { value: 'Civil' } });
    fireEvent.click(screen.getByRole('button', { name: /add project type/i }));
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(createProjectType).not.toHaveBeenCalled();
  });
});
