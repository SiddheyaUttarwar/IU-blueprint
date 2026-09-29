import { supabase } from '../lib/supabaseClient.js';

export async function listCampuses() {
  const { data, error } = await supabase
    .from('campuses')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createCampus({ name, isActive = true, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Campus name is required.');
  const { data, error } = await supabase
    .from('campuses')
    .insert({ name: trimmed, is_active: isActive, created_by: createdBy ?? null })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A campus with that name already exists.');
    throw error;
  }
  return data;
}

export async function updateCampusActive(id, isActive) {
  const { data, error } = await supabase
    .from('campuses')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeCampus(id) {
  const { error } = await supabase.from('campuses').delete().eq('id', id);
  if (error) {
    if (error.code === '23503') throw new Error('This campus has schools attached — delete or move them first.');
    throw error;
  }
}
