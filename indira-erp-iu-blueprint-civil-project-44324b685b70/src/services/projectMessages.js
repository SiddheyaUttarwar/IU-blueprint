import { supabase } from '../lib/supabaseClient.js';
import { notifyMany } from '../lib/notify.js';

const SELECT = `
  id, project_id, author_id, body, attachments, mentions, hashtags, created_at,
  author:profiles!project_messages_author_id_fkey ( id, first_name, last_name, email )
`;

export async function listMessages(projectId) {
  const { data, error } = await supabase
    .from('project_messages')
    .select(SELECT)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

export async function postMessage(projectId, authorId, body, { attachments = [], mentions = [], hashtags = [] } = {}) {
  const trimmed = (body ?? '').trim();
  if (!trimmed && attachments.length === 0) throw new Error('Message cannot be empty.');
  const { data, error } = await supabase
    .from('project_messages')
    .insert({
      project_id: projectId,
      author_id: authorId ?? null,
      body: trimmed || '(attachment)',
      attachments,
      mentions,
      hashtags,
    })
    .select(SELECT)
    .single();
  if (error) throw error;

  // Fetch project name + author name once so notification text is meaningful.
  // Trailing #msg=/#project= markers are consumed by NotificationBell for deep-linking.
  try {
    const [{ data: proj }, { data: author }] = await Promise.all([
      supabase.from('projects').select('name, project_manager_id').eq('id', projectId).single(),
      authorId
        ? supabase.from('profiles').select('first_name, last_name').eq('id', authorId).single()
        : Promise.resolve({ data: null }),
    ]);
    const projectName = proj?.name || 'a project';
    const authorName = author
      ? `${author.first_name ?? ''} ${author.last_name ?? ''}`.trim() || 'A teammate'
      : 'A teammate';
    const preview = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;

    if (mentions.length) {
      const body = `${authorName} mentioned you in "${projectName}":\n\n${preview}`;
      await notifyMany(mentions.filter(Boolean).map((mid) => ({
        recipient_profile_id: mid,
        subject_profile_id: authorId ?? null,
        type: 'message_mention',
        message: `${body}\n#msg=${data.id}\n#project=${projectId}`,
        email: true,
      })));
    } else if (proj?.project_manager_id && proj.project_manager_id !== authorId) {
      const body = `${authorName} posted a new message in "${projectName}":\n\n${preview}`;
      await notifyMany([{
        recipient_profile_id: proj.project_manager_id,
        subject_profile_id: authorId ?? null,
        type: 'message_posted',
        message: `${body}\n#msg=${data.id}\n#project=${projectId}`,
        email: true,
      }]);
    }
  } catch { /* ignore — bell entry is best-effort */ }
  return data;
}

export async function deleteMessage(id) {
  const { error } = await supabase.from('project_messages').delete().eq('id', id);
  if (error) throw error;
}

export async function uploadMessageAttachment(projectId, file) {
  if (!file) throw new Error('No file');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `messages/${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('project-docs').upload(path, file, {
    cacheControl: '3600', upsert: false, contentType: file.type || undefined,
  });
  if (error) throw error;
  return { name: file.name, path, size: file.size, mime: file.type || null };
}

export async function getMessageAttachmentUrl(path, expires = 300) {
  const { data, error } = await supabase.storage.from('project-docs').createSignedUrl(path, expires);
  if (error) throw error;
  return data?.signedUrl ?? null;
}
