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

const { default: ProjectTemplates } = await import('../src/pages/masters/ProjectTemplates.jsx');

const TYPES = [{ id: 'pt1', name: 'Civil', is_active: true }];
const TEMPLATES = [{
  id: 'tpl1', name: 'Bridge', description: 'A bridge',
  project_types: { id: 'pt1', name: 'Civil' },
  latest_version: { id: 'v1', version_no: 1, is_locked: false },
  all_versions: [{ id: 'v1', version_no: 1, is_locked: false }],
}];

describe('ProjectTemplates page (Project Admin side)', () => {
  beforeEach(() => {
    listProjectTypes.mockReset().mockResolvedValue(TYPES);
    listProjectTemplates.mockReset().mockResolvedValue(TEMPLATES);
    createProjectTemplate.mockReset();
    removeProjectTemplate.mockReset();
    toast.success.mockClear();
    toast.error.mockClear();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('renders template rows with type and version (department removed)', async () => {
    renderPage(<ProjectTemplates />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    const row = screen.getByText('Bridge').closest('tr');
    expect(row).toHaveTextContent('Civil');
    expect(row).toHaveTextContent('v1');
  });

  it('opens the Add modal and creates a template', async () => {
    const created = {
      id: 'tpl2', name: 'Road',
      project_types: { id: 'pt1', name: 'Civil' },
      latest_version: { id: 'v1', version_no: 1, is_locked: false },
    };
    createProjectTemplate.mockResolvedValue(created);
    renderPage(<ProjectTemplates />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /add project template/i }));
    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'pt1' } });
    fireEvent.change(screen.getByPlaceholderText(/multi-storey/i), { target: { value: 'Road' } });
    fireEvent.click(screen.getByRole('button', { name: /create template/i }));
    await waitFor(() => expect(createProjectTemplate).toHaveBeenCalledWith(expect.objectContaining({
      projectTypeId: 'pt1', name: 'Road', description: null, createdBy: 'admin-1',
    })));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('deletes a template after confirmation', async () => {
    removeProjectTemplate.mockResolvedValue();
    renderPage(<ProjectTemplates />);
    await waitFor(() => expect(screen.getByText('Bridge')).toBeInTheDocument());
    const row = screen.getByText('Bridge').closest('tr');
    fireEvent.click(row.querySelector('button[aria-label^="Delete"]'));
    await waitFor(() => expect(removeProjectTemplate).toHaveBeenCalledWith('tpl1'));
  });
});
