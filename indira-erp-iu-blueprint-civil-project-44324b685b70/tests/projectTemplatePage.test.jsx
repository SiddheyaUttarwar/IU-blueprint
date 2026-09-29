import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function renderPage(ui) { return render(<MemoryRouter>{ui}</MemoryRouter>); }

const authValue = { profile: { id: 'admin-1' } };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }));

const listProjectTypes = vi.fn();
vi.mock('../src/services/projectTypes.js', () => ({
  listProjectTypes: (...a) => listProjectTypes(...a),
}));

const listProjectTemplates = vi.fn();
const createProjectTemplate = vi.fn();
const removeProjectTemplate = vi.fn();
vi.mock('../src/services/projectTemplates.js', () => ({
  listProjectTemplates: (...a) => listProjectTemplates(...a),
  createProjectTemplate: (...a) => createProjectTemplate(...a),
  removeProjectTemplate: (...a) => removeProjectTemplate(...a),
}));

const { default: ProjectTemplate } = await import('../src/pages/masters/it/ProjectTemplate.jsx');

const TYPES = [
  { id: 't1', name: 'Civil', is_active: true },
  { id: 't2', name: 'Software', is_active: false },
];
const TEMPLATES = [
  { id: 'tpl1', name: 'Bridge', project_type_id: 't1', project_types: { id: 't1', name: 'Civil', is_active: true } },
  { id: 'tpl2', name: 'Road', project_type_id: 't1', project_types: { id: 't1', name: 'Civil', is_active: true } },
];

describe('ProjectTemplate page', () => {
  beforeEach(() => {
    listProjectTypes.mockReset().mockResolvedValue(TYPES);
    listProjectTemplates.mockReset().mockResolvedValue(TEMPLATES);
    createProjectTemplate.mockReset();
    removeProjectTemplate.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders templates numbered Sr.No with type name', async () => {
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    const bridgeRow = screen.getByText('Bridge').closest('tr');
    expect(bridgeRow.querySelector('td').textContent).toBe('1');
    expect(bridgeRow).toHaveTextContent('Civil');
  });

  it('only lists ACTIVE project types in the dropdown', async () => {
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    const select = screen.getByRole('combobox');
    expect(select).toHaveTextContent('Civil');
    expect(select).not.toHaveTextContent('Software');
  });

  it('adds a new template and shows a success toast', async () => {
    const created = { id: 'tpl3', name: 'Tunnel', project_type_id: 't1', project_types: { id: 't1', name: 'Civil', is_active: true } };
    createProjectTemplate.mockResolvedValue(created);
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/residential/i), { target: { value: 'Tunnel' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: /add template/i }));
    await waitFor(() => expect(createProjectTemplate).toHaveBeenCalledWith({ name: 'Tunnel', projectTypeId: 't1', createdBy: 'admin-1' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(screen.getByText('Tunnel')).toBeInTheDocument();
  });

  it('deletes a template after confirmation', async () => {
    removeProjectTemplate.mockResolvedValue();
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    const bridgeRow = screen.getByText('Bridge').closest('tr');
    fireEvent.click(bridgeRow.querySelector('button[aria-label^="Delete"]'));
    await waitFor(() => expect(removeProjectTemplate).toHaveBeenCalledWith('tpl1'));
    await waitFor(() => expect(screen.queryByText('Bridge')).not.toBeInTheDocument());
  });

  it('surfaces server create errors as a toast', async () => {
    createProjectTemplate.mockRejectedValue(new Error('Server rejected the request.'));
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/residential/i), { target: { value: 'BrandNew' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: /add template/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/server rejected/i)));
  });

  it('blocks submit with inline errors when required fields are empty', async () => {
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add template/i }));
    expect(screen.getByText(/template name is required/i)).toBeInTheDocument();
    expect(screen.getByText(/project type is required/i)).toBeInTheDocument();
    expect(createProjectTemplate).not.toHaveBeenCalled();
  });

  it('shows an inline duplicate error for a client-side name clash', async () => {
    renderPage(<ProjectTemplate />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/residential/i), { target: { value: 'Bridge' } });
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 't1' } });
    fireEvent.click(screen.getByRole('button', { name: /add template/i }));
    expect(screen.getByText(/already exists/i)).toBeInTheDocument();
    expect(createProjectTemplate).not.toHaveBeenCalled();
  });
});
