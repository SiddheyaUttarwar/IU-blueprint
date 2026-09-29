import { supabase } from './supabaseClient.js';

// Fire-and-forget audit write. Failure never blocks the caller.
export async function audit({ actorId, action, entityType, entityId, before, after, context }) {
  try {
    await supabase.from('audit_log').insert({
      actor_id: actorId ?? null,
      action,
      entity_type: entityType,
      entity_id: entityId ?? null,
      before: before ?? null,
      after: after ?? null,
      context: context ?? null,
    });
  } catch (err) {
    if (import.meta?.env?.DEV) console.warn('audit failed:', action, entityType, err?.message);
  }
}

export async function listAuditForEntity(entityType, entityId, { limit = 100 } = {}) {
  const { data, error } = await supabase
    .from('audit_log')
    .select(`
      *,
      actor:profiles!audit_log_actor_id_fkey ( id, first_name, last_name, email )
    `)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
