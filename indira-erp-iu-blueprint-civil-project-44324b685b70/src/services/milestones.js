import { supabase } from '../lib/supabaseClient.js';

export async function listMilestones() {
  const { data, error } = await supabase
    .from('milestones')
    .select('id, project_template_id, phase, name, sort_order, created_at, project_templates ( id, name )')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createMilestone({ templateId, phase, name, createdBy }) {
  const trimmed = name.trim();
  if (!templateId) throw new Error('Project template is required.');
  if (!phase) throw new Error('Project phase is required.');
  if (!trimmed) throw new Error('Milestone name is required.');
  const { data, error } = await supabase
    .from('milestones')
    .insert({ project_template_id: templateId, phase, name: trimmed, created_by: createdBy ?? null })
    .select('id, project_template_id, phase, name, sort_order, created_at, project_templates ( id, name )')
    .single();
  if (error) {
    if (error.code === '23505') throw new Error('A milestone with this name already exists in this template & phase.');
    throw error;
  }
  return data;
}

export async function upsertMasterMilestone({ templateId, phase, name, createdBy }) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Milestone name is required.');
  const lower = trimmed.toLowerCase();

  const { data: existing, error: findErr } = await supabase
    .from('milestones').select('id, name')
    .eq('project_template_id', templateId).eq('phase', phase)
    .ilike('name', trimmed).limit(20);
  if (findErr) throw findErr;
  const match = (existing ?? []).find((r) => r.name.toLowerCase() === lower);
  if (match) return match;

  const { data, error } = await supabase
    .from('milestones')
    .insert({ project_template_id: templateId, phase, name: trimmed, created_by: createdBy ?? null })
    .select('id, name')
    .single();
  if (error) {
    if (error.code === '23505') {
      const { data: retry } = await supabase.from('milestones').select('id, name')
        .eq('project_template_id', templateId).eq('phase', phase)
        .ilike('name', trimmed).limit(1).single();
      if (retry) return retry;
    }
    throw error;
  }
  return data;
}

export async function removeMilestone(id) {
  const { error } = await supabase.from('milestones').delete().eq('id', id);
  if (error) throw error;
}
