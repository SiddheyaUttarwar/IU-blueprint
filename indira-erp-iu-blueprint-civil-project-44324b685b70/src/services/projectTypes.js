import { supabase } from '../lib/supabaseClient.js';

export async function listProjectTypes() {
  const { data, error } = await supabase
    .from('project_types')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createProjectType({ name, isActive = true, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name is required.');
  const { data, error } = await supabase
    .from('project_types')
    .insert({ name: trimmed, is_active: isActive, created_by: createdBy ?? null })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A project type with that name already exists.');
    throw error;
  }
  return data;
}

export async function updateProjectTypeActive(id, isActive) {
  const { data, error } = await supabase
    .from('project_types')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeProjectType(id) {
  const { error } = await supabase.from('project_types').delete().eq('id', id);
  if (error) throw error;
}
