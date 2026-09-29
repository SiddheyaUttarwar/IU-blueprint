import { describe, it, expect, vi, beforeEach } from 'vitest';

const invoke = vi.fn();

vi.mock('../src/lib/supabaseClient.js', () => ({
  supabase: { functions: { invoke: (...args) => invoke(...args) } },
}));

const { enrollUmsEmployee } = await import('../src/services/enrollment.js');

const employee = { empId: 1, emailId: 'x@indirauniversity.edu.in', firstName: 'X', lastName: 'Y' };

describe('enrollUmsEmployee', () => {
  beforeEach(() => invoke.mockReset());

  it('calls the enroll-user edge function with the employee payload', async () => {
    invoke.mockResolvedValue({ data: { profile: { id: 'p1', email: 'x@indirauniversity.edu.in' } }, error: null });
    const profile = await enrollUmsEmployee(employee);
    expect(invoke).toHaveBeenCalledWith('enroll-user', { body: { umsEmployee: employee } });
    expect(profile.id).toBe('p1');
  });

  it('surfaces a friendly error for duplicate enrollment (409)', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'x', context: { status: 409 } } });
    await expect(enrollUmsEmployee(employee)).rejects.toThrow(/already enrolled/i);
  });

  it('surfaces a friendly error for non-admin caller (403)', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'x', context: { status: 403 } } });
    await expect(enrollUmsEmployee(employee)).rejects.toThrow(/admins/i);
  });

  it('surfaces the raw error message for other failures', async () => {
    invoke.mockResolvedValue({ data: null, error: { message: 'boom' } });
    await expect(enrollUmsEmployee(employee)).rejects.toThrow('boom');
  });
});
