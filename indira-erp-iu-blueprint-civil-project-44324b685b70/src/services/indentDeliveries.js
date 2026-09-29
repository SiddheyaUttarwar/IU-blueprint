import { supabase } from '../lib/supabaseClient.js';
import { assertProjectActiveByIndentItem } from '../lib/projectGuards.js';
import { notifyMany } from '../lib/notify.js';

const SELECT = `
  id, indent_item_id, delivery_date, qty, note, created_by, created_at,
  author:profiles!indent_item_deliveries_created_by_fkey ( id, first_name, last_name, email )
`;

export async function listDeliveries(indentItemId) {
  const { data, error } = await supabase
    .from('indent_item_deliveries')
    .select(SELECT)
    .eq('indent_item_id', indentItemId)
    .order('delivery_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function addDelivery(indentItemId, createdBy, { deliveryDate, qty, note }) {
  await assertProjectActiveByIndentItem(indentItemId);
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) throw new Error('Quantity must be a positive number.');
  // Look up PM for notification
  const { data: ctx } = await supabase
    .from('indent_items')
    .select('item_name, assigned_to_ids, indents!indent_items_indent_id_fkey!inner ( project_id, projects!indents_project_id_fkey!inner ( id, name, project_manager_id ) )')
    .eq('id', indentItemId).single();
  const { data, error } = await supabase
    .from('indent_item_deliveries')
    .insert({
      indent_item_id: indentItemId,
      created_by: createdBy ?? null,
      delivery_date: deliveryDate || new Date().toISOString().slice(0, 10),
      qty: n,
      note: note?.trim() || null,
    })
    .select(SELECT)
    .single();
  if (error) throw error;
  // Notify PM
  try {
    const project = ctx?.indents?.projects;
    if (project?.project_manager_id && project.project_manager_id !== createdBy) {
      notifyMany([{
        recipient_profile_id: project.project_manager_id, subject_profile_id: createdBy ?? null,
        type: 'indent_delivery',
        message: `Delivery logged for "${ctx.item_name}" in "${project.name}".\n#project=${project.id}`,
        email: true,
      }]);
    }
  } catch { /* ignore */ }
  return data;
}

export async function listMyIndentItems(profileId) {
  if (!profileId) return [];
  const { data, error } = await supabase
    .from('indent_items')
    .select(`
      id, item_name, item_description, unit, buy_qty, received_qty, received_on, unit_price,
      mapped_task_id, assigned_to_ids,
      indent:indents!indent_items_indent_id_fkey!inner (
        id, indent_number, indent_date,
        project:projects!indents_project_id_fkey!inner ( id, name, status )
      )
    `)
    .contains('assigned_to_ids', [profileId])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
