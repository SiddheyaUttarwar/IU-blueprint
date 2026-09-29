import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listeners = { cb: null };
const signOut = vi.fn(() => Promise.resolve({ error: null }));
const invoke = vi.fn(() => Promise.resolve({ data: null, error: null }));
const profileResult = { data: null, error: null };

vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      getUser: () => Promise.resolve({ data: { user: { id: 'u1', email: 'x@x.edu' } } }),
      onAuthStateChange: (cb) => {
        listeners.cb = cb;
        queueMicrotask(() => cb('INITIAL_SESSION', null));
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut,
    },
    functions: { invoke: (...args) => invoke(...args) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve(profileResult) }),
      }),
    }),
  },
}));

const { AuthProvider } = await import('../src/context/AuthContext.jsx');
const { default: App } = await import('../src/App.jsx');

function signIn() {
  listeners.cb('SIGNED_IN', { user: { id: 'u1', email: 'x@x.edu' } });
}

describe('enrollment gate', () => {
  beforeEach(() => {
    signOut.mockClear();
    invoke.mockClear();
    profileResult.data = null;
    profileResult.error = null;
  });

  it('signs out and shows not-enrolled when no profile row matches the user', async () => {
    profileResult.data = null;

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument());

    signIn();

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/user is not enrolled in the system/i)).toBeInTheDocument(),
    );
  });

  it('signs out and shows not-enrolled when profile lookup throws', async () => {
    profileResult.error = new Error('db down');

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /sign in with microsoft/i })).toBeInTheDocument());

    signIn();

    await waitFor(() => expect(signOut).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByText(/user is not enrolled in the system/i)).toBeInTheDocument(),
    );
  });
});
