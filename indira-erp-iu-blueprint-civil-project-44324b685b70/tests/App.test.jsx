import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      getUser: () => Promise.resolve({ data: { user: null } }),
      onAuthStateChange: (callback) => {
        queueMicrotask(() => callback('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: () => Promise.resolve({ error: null }),
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  },
}));

const { AuthProvider } = await import('../src/context/AuthContext.jsx');
const { default: App } = await import('../src/App.jsx');

describe('App', () => {
  it('renders the login page for unauthenticated users on /login', async () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /indira blueprint/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  });

  it('redirects unauthenticated users from / to /login', async () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument();
    });
  });
});


