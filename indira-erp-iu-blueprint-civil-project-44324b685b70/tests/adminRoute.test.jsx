import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const authValue = { session: null, isAdmin: false, loading: false };

vi.mock('../src/context/AuthContext.jsx', () => ({
  useAuth: () => authValue,
}));

const { default: AdminRoute } = await import('../src/components/AdminRoute.jsx');

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AdminRoute />}>
          <Route path="/masters/users" element={<div>Users Page</div>} />
        </Route>
        <Route path="/" element={<div>Dashboard</div>} />
        <Route path="/login" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AdminRoute', () => {
  it('redirects unauthenticated users to /login', () => {
    Object.assign(authValue, { session: null, isAdmin: false, loading: false });
    renderAt('/masters/users');
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('redirects non-admin authenticated users to /', () => {
    Object.assign(authValue, { session: { user: { id: 'u1' } }, isAdmin: false, loading: false });
    renderAt('/masters/users');
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
  });

  it('renders the admin page for admin users', () => {
    Object.assign(authValue, { session: { user: { id: 'u1' } }, isAdmin: true, loading: false });
    renderAt('/masters/users');
    expect(screen.getByText('Users Page')).toBeInTheDocument();
  });

  it('renders nothing while auth is loading', () => {
    Object.assign(authValue, { session: null, isAdmin: false, loading: true });
    const { container } = renderAt('/masters/users');
    expect(container).toBeEmptyDOMElement();
  });
});
