import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

function renderWithRouter(ui) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

const authValue = { profile: { id: 'admin-1' } };
vi.mock('../src/context/AuthContext.jsx', () => ({ useAuth: () => authValue }));

const countUnread = vi.fn();
const listMyNotifications = vi.fn();
const markAllRead = vi.fn();
vi.mock('../src/services/notifications.js', () => ({
  countUnread: (...a) => countUnread(...a),
  listMyNotifications: (...a) => listMyNotifications(...a),
  markAllRead: (...a) => markAllRead(...a),
  markRead: () => Promise.resolve(),
  ensureMilestoneAlerts: () => Promise.resolve(0),
}));

const { default: NotificationBell } = await import('../src/components/NotificationBell.jsx');

describe('NotificationBell', () => {
  beforeEach(() => {
    countUnread.mockReset();
    listMyNotifications.mockReset();
    markAllRead.mockReset();
  });

  it('shows unread badge when count > 0', async () => {
    countUnread.mockResolvedValue(3);
    renderWithRouter(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument());
  });

  it('caps badge display at 9+', async () => {
    countUnread.mockResolvedValue(42);
    renderWithRouter(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('9+')).toBeInTheDocument());
  });

  it('opens dropdown, loads items, marks all read', async () => {
    countUnread.mockResolvedValue(1);
    listMyNotifications.mockResolvedValue([
      { id: 'n1', message: 'Priya signed in for the first time.', created_at: new Date().toISOString(), read_at: null },
    ]);
    markAllRead.mockResolvedValue();

    renderWithRouter(<NotificationBell />);
    await waitFor(() => expect(screen.getByText('1')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));

    await waitFor(() => expect(screen.getByText(/priya signed in/i)).toBeInTheDocument());
    expect(markAllRead).toHaveBeenCalledWith('admin-1');
  });

  it('shows empty state when no notifications', async () => {
    countUnread.mockResolvedValue(0);
    listMyNotifications.mockResolvedValue([]);
    markAllRead.mockResolvedValue();

    renderWithRouter(<NotificationBell />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    await waitFor(() => expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument());
  });
});
