import { supabase } from '../lib/supabaseClient.js';

export async function listRagRules() {
  const { data, error } = await supabase
    .from('rag_rules')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

function validateThresholds({ greenMinPct, amberMinPct }) {
  const g = Number(greenMinPct);
  const a = Number(amberMinPct);
  if (!Number.isFinite(g) || g < 0 || g > 100) throw new Error('Green threshold must be between 0 and 100.');
  if (!Number.isFinite(a) || a < 0 || a > 100) throw new Error('Amber threshold must be between 0 and 100.');
  if (g <= a) throw new Error('Green threshold must be greater than the Amber threshold.');
  return { g, a };
}

export async function createRagRule({ name, greenMinPct, amberMinPct, description, isActive = true, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('RAG Rule name is required.');
  const { g, a } = validateThresholds({ greenMinPct, amberMinPct });
  const { data, error } = await supabase
    .from('rag_rules')
    .insert({
      name: trimmed,
      green_min_pct: g,
      amber_min_pct: a,
      description: description?.trim() || null,
      is_active: isActive,
      created_by: createdBy ?? null,
    })
    .select()
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A RAG Rule with that name already exists.');
    throw error;
  }
  return data;
}

export async function updateRagRule(id, { name, greenMinPct, amberMinPct, description }) {
  const patch = { updated_at: new Date().toISOString() };
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) throw new Error('RAG Rule name is required.');
    patch.name = trimmed;
  }
  if (greenMinPct !== undefined || amberMinPct !== undefined) {
    const { g, a } = validateThresholds({ greenMinPct, amberMinPct });
    patch.green_min_pct = g;
    patch.amber_min_pct = a;
  }
  if (description !== undefined) patch.description = description?.trim() || null;
  const { data, error } = await supabase.from('rag_rules').update(patch).eq('id', id).select().single();
  if (error) {
    if (error.code === '23505') throw new Error('A RAG Rule with that name already exists.');
    throw error;
  }
  return data;
}

export async function updateRagRuleActive(id, isActive) {
  const { data, error } = await supabase
    .from('rag_rules')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeRagRule(id) {
  const { error } = await supabase.from('rag_rules').delete().eq('id', id);
  if (error) throw error;
}
