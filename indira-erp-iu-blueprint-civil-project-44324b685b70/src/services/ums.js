import { supabase } from '../lib/supabaseClient.js';

const BASE_URL = import.meta.env.VITE_UMS_BASE_URL ?? '';

function umsConfigured() {
  return !!BASE_URL;
}

async function authorizedFetch(path) {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.provider_token;
  if (!token) throw new Error('No Microsoft access token in session. Sign in with Microsoft to use UMS.');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`UMS ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function listEmployeesByUniversity(indiraUniversityId) {
  if (!umsConfigured()) return [];
  return authorizedFetch(`/employee/university/${indiraUniversityId}`);
}

export async function getEmployeeByEmail(email) {
  if (!umsConfigured()) return null;
  return authorizedFetch(`/employee/by-email/${encodeURIComponent(email)}`);
}

export async function listDesignations() {
  if (!umsConfigured()) return [];
  return authorizedFetch('/designations');
}

export async function listDepartments() {
  if (!umsConfigured()) return [];
  return authorizedFetch('/departments');
}

export function filterEmployees(employees, query) {
  const q = query.trim().toLowerCase();
  if (!q) return employees;
  return employees.filter((e) => {
    const name = [e.firstName, e.middleName, e.lastName].filter(Boolean).join(' ').toLowerCase();
    return name.includes(q) || (e.emailId ?? '').toLowerCase().includes(q);
  });
}

export function isUmsConfigured() { return umsConfigured(); }
