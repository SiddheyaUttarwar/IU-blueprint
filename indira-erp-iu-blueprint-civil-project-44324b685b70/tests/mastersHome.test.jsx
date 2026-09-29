import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const authValue = { hasRole: () => false, activeRole: null };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const { default: MastersHome } = await import('../src/pages/masters/MastersHome.jsx');

function renderHome() {
  return render(
    <MemoryRouter>
      <MastersHome />
    </MemoryRouter>,
  );
}

describe('MastersHome cards visibility', () => {
  it('shows Project Admin cards for admin (Project Type now lives here)', () => {
    Object.assign(authValue, {
      hasRole: (r) => r === 'project_admin',
      activeRole: 'project_admin',
    });
    renderHome();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Project Templates')).toBeInTheDocument();
    expect(screen.getByText('Project Type')).toBeInTheDocument();
    expect(screen.queryByText('Approval Authority')).not.toBeInTheDocument();
  });

  it('shows IT Admin cards for it_admin (Project Type moved to Project Admin)', () => {
    Object.assign(authValue, {
      hasRole: (r) => r === 'it_admin',
      activeRole: 'it_admin',
    });
    renderHome();
    expect(screen.getByText('Milestone')).toBeInTheDocument();
    expect(screen.getByText('Project Template')).toBeInTheDocument();
    expect(screen.queryByText('Project Type')).not.toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
  });

  it('shows only the active role section when user has both roles (active = project_admin)', () => {
    Object.assign(authValue, {
      hasRole: (r) => ['project_admin', 'it_admin'].includes(r),
      activeRole: 'project_admin',
    });
    renderHome();
    expect(screen.getByText('Users')).toBeInTheDocument();
    expect(screen.getByText('Project Type')).toBeInTheDocument();
    expect(screen.queryByText('Milestone')).not.toBeInTheDocument();
  });

  it('shows only the active role section when user has both roles (active = it_admin)', () => {
    Object.assign(authValue, {
      hasRole: (r) => ['project_admin', 'it_admin'].includes(r),
      activeRole: 'it_admin',
    });
    renderHome();
    expect(screen.getByText('Milestone')).toBeInTheDocument();
    expect(screen.queryByText('Users')).not.toBeInTheDocument();
    expect(screen.queryByText('Project Type')).not.toBeInTheDocument();
  });

  it('shows switch-role hint when active role is not an admin role', () => {
    Object.assign(authValue, { hasRole: () => false, activeRole: 'member' });
    renderHome();
    expect(screen.getByText(/switch to your project admin or it admin role/i)).toBeInTheDocument();
  });
});
