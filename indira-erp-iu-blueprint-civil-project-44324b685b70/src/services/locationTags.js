import { supabase } from '../lib/supabaseClient.js';

const SELECT = 'id, school_id, name, is_active, created_at, updated_at, schools ( id, name, campuses ( id, name ) )';

export async function listLocationTags() {
  const { data, error } = await supabase.from('location_tags').select(SELECT).order('name');
  if (error) throw error;
  return data ?? [];
}

export async function listLocationTagsForSchool(schoolId) {
  if (!schoolId) return [];
  const { data, error } = await supabase
    .from('location_tags')
    .select('id, school_id, name, is_active')
    .eq('school_id', schoolId)
    .eq('is_active', true)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createLocationTag({ name, schoolId, isActive = true, createdBy }) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Location tag name is required.');
  if (!schoolId) throw new Error('School is required.');
  const { data, error } = await supabase
    .from('location_tags')
    .insert({ name: trimmed, school_id: schoolId, is_active: isActive, created_by: createdBy ?? null })
    .select(SELECT).single();
  if (error) {
    if (error.code === '23505') throw new Error('A location tag with that name already exists in this school.');
    throw error;
  }
  return data;
}

export async function updateLocationTagActive(id, isActive) {
  const { data, error } = await supabase
    .from('location_tags')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id).select(SELECT).single();
  if (error) throw error;
  return data;
}

export async function removeLocationTag(id) {
  const { error } = await supabase.from('location_tags').delete().eq('id', id);
  if (error) throw error;
}
