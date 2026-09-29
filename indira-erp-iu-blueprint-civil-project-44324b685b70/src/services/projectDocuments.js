import { supabase } from '../lib/supabaseClient.js';
import { notifyMany } from '../lib/notify.js';

const SELECT = `
  id, project_id, name, display_name, file_path, size_bytes, mime_type, task_id, uploaded_by, created_at,
  uploader:profiles!project_documents_uploaded_by_fkey ( id, first_name, last_name, email ),
  task:project_tasks!project_documents_task_id_fkey ( id, name, parent_task_id )
`;

export async function listDocuments(projectId) {
  const { data, error } = await supabase
    .from('project_documents')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function uploadDocument(projectId, file, uploaderId, { displayName, taskId } = {}) {
  if (!file) throw new Error('No file selected.');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from('project-docs').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from('project_documents')
    .insert({
      project_id: projectId,
      name: file.name,
      display_name: displayName?.trim() || null,
      task_id: taskId || null,
      file_path: path,
      size_bytes: file.size,
      mime_type: file.type || null,
      uploaded_by: uploaderId ?? null,
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  // Notify PM about the upload (unless PM is the uploader)
  try {
    const { data: proj } = await supabase.from('projects').select('name, project_manager_id').eq('id', projectId).single();
    if (proj?.project_manager_id && proj.project_manager_id !== uploaderId) {
      notifyMany([{
        recipient_profile_id: proj.project_manager_id, subject_profile_id: uploaderId ?? null,
        type: 'document_uploaded',
        message: `Document "${data.display_name || data.name}" uploaded to "${proj.name}".\n#project=${projectId}`,
        email: true,
      }]);
    }
  } catch { /* ignore */ }
  return data;
}

export async function getDocumentSignedUrl(path, expiresInSeconds = 300) {
  const { data, error } = await supabase.storage.from('project-docs').createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function deleteDocument(doc) {
  await supabase.storage.from('project-docs').remove([doc.file_path]).catch(() => {});
  const { error } = await supabase.from('project_documents').delete().eq('id', doc.id);
  if (error) throw error;
}
