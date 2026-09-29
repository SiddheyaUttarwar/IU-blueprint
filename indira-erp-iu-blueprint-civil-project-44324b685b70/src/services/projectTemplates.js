import { supabase } from '../lib/supabaseClient.js';

const TEMPLATE_SELECT = `
  id, name, description, department_id, project_type_id, is_draft, created_at,
  project_types ( id, name ),
  template_versions (
    id, version_no, is_locked, created_at, updated_at, updated_by,
    updated_by_profile:profiles!template_versions_updated_by_fkey ( id, first_name, last_name, email )
  )
`;

export async function listProjectTemplates() {
  const { data, error } = await supabase
    .from('project_templates')
    .select(TEMPLATE_SELECT)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map(withLatestVersion);
}

function withLatestVersion(row) {
  const versions = [...(row.template_versions ?? [])].sort((a, b) => b.version_no - a.version_no);
  return { ...row, latest_version: versions[0] ?? null, all_versions: versions };
}

export async function createProjectTemplate({ name, projectTypeId, description, createdBy, isDraft = false }) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) throw new Error('Template name is required.');
  if (!projectTypeId) throw new Error('Project type is required.');

  const { data: tpl, error: tErr } = await supabase
    .from('project_templates')
    .insert({
      name: trimmed,
      project_type_id: projectTypeId,
      department_id: null,
      description: description?.trim() || null,
      created_by: createdBy ?? null,
      is_draft: !!isDraft,
    })
    .select(TEMPLATE_SELECT)
    .single();
  if (tErr) {
    if (tErr.code === '23505') throw new Error('A template with that name already exists.');
    throw tErr;
  }

  const { data: version, error: vErr } = await supabase
    .from('template_versions')
    .insert({ template_id: tpl.id, version_no: 1, is_locked: false, created_by: createdBy ?? null })
    .select('id, version_no, is_locked, created_at')
    .single();
  if (vErr) {
    await supabase.from('project_templates').delete().eq('id', tpl.id);
    throw vErr;
  }

  return withLatestVersion({ ...tpl, template_versions: [version] });
}

export async function publishTemplate(templateId) {
  const { error } = await supabase
    .from('project_templates')
    .update({ is_draft: false })
    .eq('id', templateId);
  if (error) throw error;
}

export async function removeProjectTemplate(id) {
  const { error } = await supabase.from('project_templates').delete().eq('id', id);
  if (error) throw error;
}

export async function bumpTemplateVersion(templateId, actorId) {
  const { data: latest, error: e1 } = await supabase
    .from('template_versions')
    .select('version_no')
    .eq('template_id', templateId)
    .order('version_no', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (e1) throw e1;
  const nextNo = (latest?.version_no ?? 0) + 1;
  const { data: version, error } = await supabase
    .from('template_versions')
    .insert({
      template_id: templateId,
      version_no: nextNo,
      is_locked: false,
      created_by: actorId ?? null,
      updated_by: actorId ?? null,
    })
    .select('id, version_no, updated_at, updated_by')
    .single();
  if (error) throw error;
  return version;
}
