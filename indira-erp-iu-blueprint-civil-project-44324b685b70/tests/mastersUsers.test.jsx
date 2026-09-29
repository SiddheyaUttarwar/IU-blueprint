import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

function renderPage(ui) { return render(<MemoryRouter>{ui}</MemoryRouter>); }

const authValue = { profile: { indira_university_id: 1 } };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../src/context/ToastContext.jsx', () => ({ useToast: () => toast }));

const listEmployeesByUniversity = vi.fn();
const listDesignations = vi.fn();
vi.mock('../src/services/ums.js', async () => {
  const actual = await vi.importActual('../src/services/ums.js');
  return {
    ...actual,
    listEmployeesByUniversity: (...a) => listEmployeesByUniversity(...a),
    listDesignations: (...a) => listDesignations(...a),
    isUmsConfigured: () => true,
  };
});

const enrollUmsEmployee = vi.fn();
vi.mock('../src/services/enrollment.js', () => ({
  enrollUmsEmployee: (...a) => enrollUmsEmployee(...a),
}));

const listEnrolledProfiles = vi.fn();
const updateProfileRoles = vi.fn();
vi.mock('../src/services/roles.js', async () => {
  const actual = await vi.importActual('../src/services/roles.js');
  return {
    ...actual,
    listEnrolledProfiles: (...a) => listEnrolledProfiles(...a),
    updateProfileRoles: (...a) => updateProfileRoles(...a),
  };
});

const profilesSelect = vi.fn(() => Promise.resolve({ data: [] }));
vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: {
    from: () => ({ select: () => profilesSelect() }),
  },
}));

const { default: MastersUsers } = await import('../src/pages/masters/Users.jsx');

const EMPLOYEES = [
  { empId: 1, firstName: 'Abhilash', middleName: 'S', lastName: 'Kasbe', emailId: 'a.k@x.edu', designationId: 1, indiraUniversityId: 1 },
  { empId: 2, firstName: 'Priya', middleName: '', lastName: 'Sharma', emailId: 'p.s@x.edu', designationId: 2, indiraUniversityId: 1 },
];
const DESIGNATIONS = [{ id: 1, name: 'Professor' }, { id: 2, name: 'Assistant Professor' }];
const ENROLLED = [
  { id: 'p1', email: 'a.k@x.edu', first_name: 'Abhilash', last_name: 'Kasbe', role: 'member', roles: ['member'], source: 'manual', enrolled_at: '2026-08-01T00:00:00Z', first_login_at: null },
  { id: 'p2', email: 'p.s@x.edu', first_name: 'Priya', last_name: 'Sharma', role: 'project_admin', roles: ['project_admin', 'it_admin'], source: 'manual', enrolled_at: '2026-08-02T00:00:00Z', first_login_at: '2026-08-15T00:00:00Z' },
];

// UMS Employees panel is currently a "Coming soon" placeholder — the integration is paused
// until the UMS API is deployed. Re-enable this suite once UsersUmsPanel routes back to the
// real component. Kept in the file so the test cases don't get lost.
describe.skip('MastersUsers — UMS Employees tab', () => {
  beforeEach(() => {
    listEmployeesByUniversity.mockReset().mockResolvedValue(EMPLOYEES);
    listDesignations.mockReset().mockResolvedValue(DESIGNATIONS);
    listEnrolledProfiles.mockReset().mockResolvedValue([]);
    enrollUmsEmployee.mockReset();
    profilesSelect.mockReset().mockResolvedValue({ data: [] });
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it('renders UMS employees table when UMS tab is selected', async () => {
    renderPage(<MastersUsers />);
    fireEvent.click(screen.getByRole('tab', { name: /ums employees/i }));
    await waitFor(() => expect(screen.getByText('Abhilash S Kasbe')).toBeInTheDocument());
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
  });

  it('enrolls an employee and fires a toast', async () => {
    enrollUmsEmployee.mockResolvedValue({ id: 'p1' });
    renderPage(<MastersUsers />);
    fireEvent.click(screen.getByRole('tab', { name: /ums employees/i }));
    await waitFor(() => expect(screen.getByText('Priya Sharma')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button', { name: /^enroll$/i });
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });
});

describe('MastersUsers — Enrolled Users tab', () => {
  beforeEach(() => {
    listEmployeesByUniversity.mockResolvedValue(EMPLOYEES);
    listDesignations.mockResolvedValue(DESIGNATIONS);
    listEnrolledProfiles.mockReset().mockResolvedValue(ENROLLED);
    updateProfileRoles.mockReset();
    profilesSelect.mockResolvedValue({ data: [] });
    toast.success.mockClear();
    toast.error.mockClear();
  });

  it('switches to Enrolled tab and shows enrolled users with role chips', async () => {
    renderPage(<MastersUsers />);
    fireEvent.click(screen.getByRole('tab', { name: /enrolled users/i }));
    await waitFor(() => expect(screen.getByText('Abhilash Kasbe')).toBeInTheDocument());
    expect(screen.getByText('Priya Sharma')).toBeInTheDocument();
    const priyaRow = screen.getByText('Priya Sharma').closest('tr');
    expect(priyaRow).toHaveTextContent('Project Admin');
    expect(priyaRow).toHaveTextContent('IT Admin');
  });

  it('opens the Change Role modal and saves new roles', async () => {
    updateProfileRoles.mockResolvedValue({ ...ENROLLED[0], roles: ['member', 'project_manager'], role: 'project_manager' });
    renderPage(<MastersUsers />);
    fireEvent.click(screen.getByRole('tab', { name: /enrolled users/i }));
    await waitFor(() => expect(screen.getByText('Abhilash Kasbe')).toBeInTheDocument());
    const abhilashRow = screen.getByText('Abhilash Kasbe').closest('tr');
    fireEvent.click(abhilashRow.querySelector('button'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Project Manager'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(updateProfileRoles).toHaveBeenCalledWith('p1', expect.arrayContaining(['member', 'project_manager'])));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it('shows a toast error when role update fails', async () => {
    updateProfileRoles.mockRejectedValue(new Error('permission denied'));
    renderPage(<MastersUsers />);
    fireEvent.click(screen.getByRole('tab', { name: /enrolled users/i }));
    await waitFor(() => expect(screen.getByText('Abhilash Kasbe')).toBeInTheDocument());
    const abhilashRow = screen.getByText('Abhilash Kasbe').closest('tr');
    fireEvent.click(abhilashRow.querySelector('button'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/permission/i)));
  });
});
