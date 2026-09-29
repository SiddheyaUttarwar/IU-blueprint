import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ToastProvider, useToast } from '../src/context/ToastContext.jsx';

function Trigger() {
  const t = useToast();
  return (
    <div>
      <button onClick={() => t.success('Saved!')}>fire success</button>
      <button onClick={() => t.error('Boom')}>fire error</button>
      <button onClick={() => t.info('Just so you know', { duration: 0 })}>fire sticky</button>
    </div>
  );
}

describe('ToastProvider', () => {
  afterEach(() => vi.useRealTimers());

  it('renders and auto-dismisses a success toast after the default duration', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire success'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved!');
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('allows manual dismiss via close button', () => {
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire error'));
    expect(screen.getByRole('status')).toHaveTextContent('Boom');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not auto-dismiss when duration is 0', () => {
    vi.useFakeTimers();
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('fire sticky'));
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByRole('status')).toHaveTextContent('Just so you know');
  });
});
