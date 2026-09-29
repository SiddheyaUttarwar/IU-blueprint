import { supabase } from '../lib/supabaseClient.js';

// Aggregate pending management items for a Project Manager:
// budget allocations, indent-item assignments/mapping, milestone dates.
export async function listPendingPmItems(profileId) {
  if (!profileId) return { items: [], projectsById: new Map() };

  const [{ data: projects }, { data: allTasks }, { data: budgets }, { data: items }, { data: milestones }, { data: dismissals }] = await Promise.all([
    supabase.from('projects').select('id, name, status').order('name'),
    supabase.from('project_tasks').select('id, project_id, name, parent_task_id'),
    supabase.from('project_budgets').select('id, task_id, project_id'),
    supabase.from('indent_items').select('id, item_name, mapped_task_id, assigned_to_ids, indent:indents ( id, indent_number, project_id )'),
    supabase.from('project_milestones').select('id, name, target_date, project_id'),
    supabase.from('pm_task_dismissals').select('item_type, item_id').eq('profile_id', profileId),
  ]);

  const projectsById = new Map((projects ?? []).map((p) => [p.id, p]));
  const dismissedSet = new Set((dismissals ?? []).map((d) => `${d.item_type}:${d.item_id}`));
  const budgetTaskIds = new Set((budgets ?? []).map((b) => b.task_id).filter(Boolean));

  const pending = [];

  // Tasks (root only) without a budget row
  for (const t of allTasks ?? []) {
    if (t.parent_task_id) continue;
    if (budgetTaskIds.has(t.id)) continue;
    if (dismissedSet.has(`budget:${t.id}`)) continue;
    const proj = projectsById.get(t.project_id);
    if (!proj) continue;
    pending.push({
      key: `budget:${t.id}`, type: 'budget', itemId: t.id, project: proj,
      label: `Allocate budget for task "${t.name}"`,
      link: `/projects/${t.project_id}`,
    });
  }

  // Indent items without assignees / without mapped task
  for (const it of items ?? []) {
    const projectId = it.indent?.project_id;
    const proj = projectsById.get(projectId);
    if (!proj) continue;
    const hasAssignees = Array.isArray(it.assigned_to_ids) && it.assigned_to_ids.length > 0;
    const hasMap = !!it.mapped_task_id;
    if (!hasAssignees && !dismissedSet.has(`indent_assign:${it.id}`)) {
      pending.push({
        key: `indent_assign:${it.id}`, type: 'indent_assign', itemId: it.id, project: proj,
        label: `Assign users to indent item "${it.item_name}" (${it.indent?.indent_number})`,
        link: `/projects/${projectId}`,
      });
    }
    if (!hasMap && !dismissedSet.has(`indent_map:${it.id}`)) {
      pending.push({
        key: `indent_map:${it.id}`, type: 'indent_map', itemId: it.id, project: proj,
        label: `Map indent item "${it.item_name}" (${it.indent?.indent_number}) to a task`,
        link: `/projects/${projectId}`,
      });
    }
  }

  // Milestones without target date
  for (const m of milestones ?? []) {
    if (m.target_date) continue;
    if (dismissedSet.has(`milestone_date:${m.id}`)) continue;
    const proj = projectsById.get(m.project_id);
    if (!proj) continue;
    pending.push({
      key: `milestone_date:${m.id}`, type: 'milestone_date', itemId: m.id, project: proj,
      label: `Set target date for milestone "${m.name}"`,
      link: `/projects/${m.project_id}`,
    });
  }

  return { items: pending, projectsById };
}

export async function dismissPmItem(profileId, itemType, itemId) {
  const { error } = await supabase.from('pm_task_dismissals').insert({
    profile_id: profileId, item_type: itemType, item_id: itemId,
  });
  if (error && error.code !== '23505') throw error;
}

export async function undismissPmItem(profileId, itemType, itemId) {
  const { error } = await supabase.from('pm_task_dismissals').delete()
    .eq('profile_id', profileId).eq('item_type', itemType).eq('item_id', itemId);
  if (error) throw error;
}
