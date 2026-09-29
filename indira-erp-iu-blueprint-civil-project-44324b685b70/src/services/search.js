import { supabase } from '../lib/supabaseClient.js';

const PER_TYPE_LIMIT = 15;

function userLabel(row) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
}

async function searchUsers(like) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, first_name, last_name')
    .or(`email.ilike.${like},first_name.ilike.${like},last_name.ilike.${like}`)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'User', id: r.id, label: userLabel(r), sublabel: r.email, to: `/team?u=${r.id}`,
  }));
}

async function searchProjects(like) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, status')
    .ilike('name', like)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'Project', id: r.id, label: r.name, sublabel: (r.status ?? '').replace('_', ' '), to: `/projects/${r.id}`,
  }));
}

async function searchProjectTasks(like) {
  const { data, error } = await supabase
    .from('project_tasks')
    .select('id, name, project_id, projects!project_tasks_project_id_fkey!inner ( id, name )')
    .ilike('name', like)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'Project Task', id: r.id, label: r.name, sublabel: `in ${r.projects?.name ?? ''}`,
    to: `/projects/${r.projects?.id ?? r.project_id}`,
  }));
}

async function searchIndentItems(like) {
  const { data, error } = await supabase
    .from('indent_items')
    .select('id, item_name, indent:indents!indent_items_indent_id_fkey!inner ( indent_number, project_id, projects!indents_project_id_fkey!inner ( id, name ) )')
    .ilike('item_name', like)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'Indent Item', id: r.id, label: r.item_name,
    sublabel: `${r.indent?.indent_number ?? ''} · ${r.indent?.projects?.name ?? ''}`,
    to: `/projects/${r.indent?.projects?.id ?? r.indent?.project_id}`,
  }));
}

async function searchTemplates(like) {
  const { data, error } = await supabase
    .from('project_templates')
    .select('id, name, project_types ( name )')
    .ilike('name', like)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'Template', id: r.id, label: r.name, sublabel: r.project_types?.name ?? '', to: '/masters/it/project-template',
  }));
}

async function searchTasks(like) {
  const { data, error } = await supabase
    .from('tasks')
    .select('id, name, phase, project_templates ( name )')
    .ilike('name', like)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'Task', id: r.id, label: r.name,
    sublabel: `${r.project_templates?.name ?? ''} · ${r.phase === 'pre_project' ? 'Pre-project' : 'Project'}`,
    to: '/masters/it/task',
  }));
}

async function searchMilestones(like) {
  const { data, error } = await supabase
    .from('milestones')
    .select('id, name, phase, project_templates ( name )')
    .ilike('name', like)
    .limit(PER_TYPE_LIMIT);
  if (error) return [];
  return (data ?? []).map((r) => ({
    type: 'Milestone', id: r.id, label: r.name,
    sublabel: `${r.project_templates?.name ?? ''} · ${r.phase === 'pre_project' ? 'Pre-project' : 'Project'}`,
    to: '/masters/it/milestone',
  }));
}

export async function globalSearch(query, { isItAdmin = false } = {}) {
  const q = query.trim();
  if (q.length < 2) return [];
  const like = `%${q}%`;
  // Available to everyone: users, projects, project tasks, indent items
  const runs = [searchUsers(like), searchProjects(like), searchProjectTasks(like), searchIndentItems(like)];
  // IT admin also gets template internals
  if (isItAdmin) runs.push(searchTemplates(like), searchTasks(like), searchMilestones(like));
  const groups = await Promise.all(runs);
  return groups.flat();
}
