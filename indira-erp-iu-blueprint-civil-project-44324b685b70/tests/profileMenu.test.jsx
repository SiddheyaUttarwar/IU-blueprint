import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const signOut = vi.fn();
const authValue = {
  user: { email: 'admin@x.edu' },
  profile: { first_name: 'Aliya', last_name: 'Attar', role: 'project_admin' },
  activeRole: 'project_admin',
  signOut,
};
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const toggleTheme = vi.fn();
vi.mock('../src/context/ThemeContext.jsx', () => ({
  useTheme: () => ({ isDark: false, toggle: toggleTheme }),
}));

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

const { default: ProfileMenu } = await import('../src/components/ProfileMenu.jsx');

function renderMenu() {
  return render(
    <MemoryRouter>
      <ProfileMenu />
    </MemoryRouter>,
  );
}

describe('ProfileMenu', () => {
  beforeEach(() => {
    signOut.mockClear();
    navigate.mockClear();
    toggleTheme.mockClear();
  });

  it('renders name + role in the trigger', () => {
    renderMenu();
    expect(screen.getByText('Aliya Attar')).toBeInTheDocument();
    expect(screen.getByText('Project Admin')).toBeInTheDocument();
  });

  it('opens dropdown showing all reference items', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /open profile menu/i }));
    expect(screen.getByRole('menuitem', { name: /my profile/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /dark mode/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /help/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /change password/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /sign out/i })).toBeInTheDocument();
  });

  it('navigates to /profile from My Profile', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /open profile menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /my profile/i }));
    expect(navigate).toHaveBeenCalledWith('/profile');
  });

  it('navigates to /change-password from Change password', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /open profile menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /change password/i }));
    expect(navigate).toHaveBeenCalledWith('/change-password');
  });

  it('toggles the theme when Dark mode is clicked', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /open profile menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /dark mode/i }));
    expect(toggleTheme).toHaveBeenCalled();
  });

  it('calls signOut from Sign out', () => {
    renderMenu();
    fireEvent.click(screen.getByRole('button', { name: /open profile menu/i }));
    fireEvent.click(screen.getByRole('menuitem', { name: /sign out/i }));
    expect(signOut).toHaveBeenCalled();
  });
});
