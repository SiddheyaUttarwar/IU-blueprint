import { supabase } from '../lib/supabaseClient.js';
import { COMMON_UNITS } from '../lib/units.js';

// Cached active-unit names — every unit picker in the app shares this cache so
// we don't fetch per-row. Falls back to COMMON_UNITS on any error.
let _cachedNames = null;
let _pending = null;
export function getUnitNames() {
  if (_cachedNames) return Promise.resolve(_cachedNames);
  if (_pending) return _pending;
  _pending = listProgressUnits({ activeOnly: true })
    .then((rows) => { _cachedNames = rows.map((r) => r.name); return _cachedNames; })
    .catch(() => { _cachedNames = COMMON_UNITS; return _cachedNames; })
    .finally(() => { _pending = null; });
  return _pending;
}
export function cachedUnitNames() { return _cachedNames ?? COMMON_UNITS; }
export function invalidateUnitCache() { _cachedNames = null; _pending = null; }

export async function listProgressUnits({ activeOnly = false } = {}) {
  let q = supabase.from('progress_units').select('*').order('sort_order', { ascending: true });
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function createProgressUnit({ name, isActive = true, createdBy }) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Unit name is required.');
  if (trimmed.length > 20) throw new Error('Unit name must be 20 characters or fewer.');
  const { data, error } = await supabase
    .from('progress_units')
    .insert({ name: trimmed, is_active: isActive, created_by: createdBy ?? null })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A unit with that name already exists.');
    throw error;
  }
  invalidateUnitCache();
  return data;
}

export async function updateProgressUnit(id, patch) {
  const cleaned = { ...patch, updated_at: new Date().toISOString() };
  if (cleaned.name !== undefined) cleaned.name = String(cleaned.name).trim();
  const { data, error } = await supabase
    .from('progress_units')
    .update(cleaned)
    .eq('id', id)
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A unit with that name already exists.');
    throw error;
  }
  invalidateUnitCache();
  return data;
}

export async function removeProgressUnit(id) {
  const { error } = await supabase.from('progress_units').delete().eq('id', id);
  if (error) throw error;
  invalidateUnitCache();
}
