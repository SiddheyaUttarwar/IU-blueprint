import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import ChangeRoleModal from '../src/components/ChangeRoleModal.jsx';

describe('ChangeRoleModal', () => {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  const profile = { id: 'p1', email: 'x@y.edu', first_name: 'X', last_name: 'Y', roles: ['member'], role: 'member' };

  beforeEach(() => { onCancel.mockClear(); onSave.mockClear(); });

  it('renders nothing when closed', () => {
    const { container } = render(<ChangeRoleModal open={false} profile={profile} onCancel={onCancel} onSave={onSave} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the four roles with the current selection checked', () => {
    render(<ChangeRoleModal open profile={profile} onCancel={onCancel} onSave={onSave} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByLabelText('Project Admin')).not.toBeChecked();
    expect(screen.getByLabelText('Project Manager')).not.toBeChecked();
    expect(screen.getByLabelText('IT Admin')).not.toBeChecked();
    expect(screen.getByLabelText('Member')).toBeChecked();
  });

  it('toggles a role and saves the new selection', () => {
    render(<ChangeRoleModal open profile={profile} onCancel={onCancel} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('IT Admin'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(expect.arrayContaining(['member', 'it_admin']));
  });

  it('blocks save when no roles are selected', () => {
    render(<ChangeRoleModal open profile={profile} onCancel={onCancel} onSave={onSave} />);
    fireEvent.click(screen.getByLabelText('Member'));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/at least one role/i)).toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', () => {
    render(<ChangeRoleModal open profile={profile} onCancel={onCancel} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('closes on Escape', () => {
    render(<ChangeRoleModal open profile={profile} onCancel={onCancel} onSave={onSave} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
