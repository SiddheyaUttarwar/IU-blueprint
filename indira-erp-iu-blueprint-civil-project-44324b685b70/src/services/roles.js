import { supabase } from '../lib/supabaseClient.js';

// ALL_ROLES retains its historical order because the primary-role fallback logic below reads
// project_admin > leadership > it_admin > project_manager > member (most→least privileged).
export const ALL_ROLES = ['project_admin', 'leadership', 'it_admin', 'project_manager', 'member'];

// Display order for role checkbox lists — Add User dialog and Change Roles now share this
// least→most privileged reading, so the two dialogs stop contradicting each other (BUG-25).
export const ROLE_DISPLAY_ORDER = ['member', 'project_manager', 'leadership', 'it_admin', 'project_admin'];

export const ROLE_LABELS = {
  project_admin: 'Project Admin',
  leadership: 'Leadership',
  it_admin: 'IT Admin',
  project_manager: 'Project Manager',
  member: 'Member',
};

export async function updateProfileRoles(profileId, roles) {
  const normalized = [...new Set(roles.filter((r) => ALL_ROLES.includes(r)))];
  const primary = normalized.includes('project_admin')
    ? 'project_admin'
    : normalized.includes('leadership')
      ? 'leadership'
      : normalized.includes('it_admin')
        ? 'it_admin'
        : normalized.includes('project_manager')
          ? 'project_manager'
          : 'member';
  const { data, error } = await supabase
    .from('profiles')
    .update({ roles: normalized, role: primary })
    .eq('id', profileId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function listEnrolledProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name, role, roles, source, enrolled_at, first_login_at')
    .order('enrolled_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
