import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi } from 'vitest';

const authValue = { profile: null };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const { default: PasswordChangeBanner } = await import('../src/components/PasswordChangeBanner.jsx');

function renderBanner() {
  return render(
    <MemoryRouter>
      <PasswordChangeBanner />
    </MemoryRouter>,
  );
}

describe('PasswordChangeBanner', () => {
  it('renders nothing when no profile', () => {
    authValue.profile = null;
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when must_change_password is false', () => {
    authValue.profile = { must_change_password: false };
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it('renders warning and CTA when must_change_password is true', () => {
    authValue.profile = { must_change_password: true };
    renderBanner();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /set password/i })).toHaveAttribute('href', '/set-password');
  });
});
