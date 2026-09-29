import { supabase } from './supabaseClient.js';

// After a project reaches the 'completed' status the only mutation allowed
// is on `project_budgets` rows (for final accounting). Everything else — tasks,
// milestones, indents, funding, documents, messages — becomes read-only for
// every role, including Project Manager and Project Admin.
export function isCompleted(project) { return project?.status === 'completed'; }

export async function assertProjectMutable(projectId) {
  const { data } = await supabase.from('projects').select('status').eq('id', projectId).single();
  if (data?.status === 'completed') {
    throw new Error('Project is Completed. Only budget entries can be edited after completion.');
  }
}

export async function assertProjectMutableByTask(taskId) {
  const { data } = await supabase
    .from('project_tasks')
    .select('projects!project_tasks_project_id_fkey!inner ( status )')
    .eq('id', taskId).single();
  if (data?.projects?.status === 'completed') {
    throw new Error('Project is Completed. Only budget entries can be edited after completion.');
  }
}

// Members can only take operational actions (log updates, record deliveries,
// mark tasks done) when the project is in the 'active' phase.
// PMs and Project Admins are not subject to this gate.
export async function assertProjectActiveByTask(taskId) {
  const { data } = await supabase
    .from('project_tasks')
    .select('id, projects!project_tasks_project_id_fkey!inner ( status )')
    .eq('id', taskId)
    .single();
  const status = data?.projects?.status;
  if (status !== 'active') {
    throw new Error('This project is not active yet. Ask the Project Manager to start the project.');
  }
}

export async function assertProjectActiveByIndentItem(itemId) {
  const { data } = await supabase
    .from('indent_items')
    .select('id, indents!indent_items_indent_id_fkey!inner ( projects!indents_project_id_fkey!inner ( status ) )')
    .eq('id', itemId)
    .single();
  const status = data?.indents?.projects?.status;
  if (status !== 'active') {
    throw new Error('This project is not active yet. Ask the Project Manager to start the project.');
  }
}
