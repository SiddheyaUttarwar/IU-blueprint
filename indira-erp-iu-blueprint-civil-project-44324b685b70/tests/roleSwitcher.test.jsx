import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

const authValue = { assignedRoles: [], activeRole: null, setActiveRole: vi.fn() };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const { default: RoleSwitcher } = await import('../src/components/RoleSwitcher.jsx');

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('RoleSwitcher', () => {
  beforeEach(() => authValue.setActiveRole.mockClear());

  it('renders nothing when the user has no assigned roles', () => {
    Object.assign(authValue, { assignedRoles: [], activeRole: null });
    const { container } = renderWithRouter(<RoleSwitcher />);
    // Router wrapper adds an empty div; assert the RoleSwitcher itself rendered nothing.
    expect(container.querySelector('.role-switcher')).toBeNull();
    expect(container.querySelector('.role-switcher__static')).toBeNull();
  });

  it('shows a static label when the user has only one role', () => {
    Object.assign(authValue, { assignedRoles: ['project_admin'], activeRole: 'project_admin' });
    renderWithRouter(<RoleSwitcher />);
    expect(screen.getByText('Project Admin')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows a dropdown of assigned roles when the user has multiple', () => {
    Object.assign(authValue, {
      assignedRoles: ['project_admin', 'project_manager'],
      activeRole: 'project_admin',
    });
    renderWithRouter(<RoleSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /project admin/i }));
    expect(screen.getByRole('option', { name: /project admin/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /project manager/i })).toBeInTheDocument();
  });

  it('calls setActiveRole when a different role is picked', () => {
    Object.assign(authValue, {
      assignedRoles: ['project_admin', 'project_manager'],
      activeRole: 'project_admin',
    });
    renderWithRouter(<RoleSwitcher />);
    fireEvent.click(screen.getByRole('button', { name: /project admin/i }));
    fireEvent.click(screen.getByRole('option', { name: /project manager/i }));
    expect(authValue.setActiveRole).toHaveBeenCalledWith('project_manager');
  });
});
