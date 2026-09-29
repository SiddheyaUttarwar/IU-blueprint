import { supabase } from '../lib/supabaseClient.js';

const SCHOOL_SELECT = 'id, campus_id, name, is_active, created_at, updated_at, campuses ( id, name )';

export async function listSchools() {
  const { data, error } = await supabase
    .from('schools')
    .select(SCHOOL_SELECT)
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createSchool({ name, campusId, isActive = true, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('School name is required.');
  if (!campusId) throw new Error('Campus is required.');
  const { data, error } = await supabase
    .from('schools')
    .insert({ name: trimmed, campus_id: campusId, is_active: isActive, created_by: createdBy ?? null })
    .select(SCHOOL_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A school with that name already exists in the selected campus.');
    throw error;
  }
  return data;
}

export async function updateSchoolActive(id, isActive) {
  const { data, error } = await supabase
    .from('schools')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(SCHOOL_SELECT)
    .single();
  if (error) throw error;
  return data;
}

export async function removeSchool(id) {
  const { error } = await supabase.from('schools').delete().eq('id', id);
  if (error) throw error;
}
