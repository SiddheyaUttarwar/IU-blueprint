import { supabase } from '../lib/supabaseClient.js';
import { audit } from '../lib/audit.js';
import { notifyMany } from '../lib/notify.js';

const INDENT_SELECT = `
  id, project_id, indent_number, indent_date, activity_name, indenter_name, indenter_mobile,
  is_academic, source_file_path, source_file_name, notes, created_by, created_at, updated_at,
  created_by_profile:profiles!indents_created_by_fkey ( id, first_name, last_name, email )
`;

export async function listIndentsForProject(projectId) {
  const { data, error } = await supabase
    .from('indents')
    .select(INDENT_SELECT)
    .eq('project_id', projectId)
    .order('indent_date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listIndentItemsForProject(projectId) {
  const { data, error } = await supabase
    .from('indent_items')
    .select('id, indent_id, item_name, item_description, unit, have_qty, buy_qty, unit_price, remark, mapped_task_id, assigned_to_ids, received_qty, received_on, received_note, sort_order, planned_amount, actual_amount, parent_indent_item_id, indents!inner ( project_id )')
    .eq('indents.project_id', projectId)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createIndent(projectId, {
  indentNumber, indentDate, activityName, indenterName, indenterMobile, isAcademic,
  sourceFilePath, sourceFileName, notes, createdBy,
}) {
  const trimmed = (indentNumber ?? '').trim();
  if (!trimmed) throw new Error('Indent number is required.');
  if (!indentDate) throw new Error('Indent date is required.');
  const { data, error } = await supabase
    .from('indents')
    .insert({
      project_id: projectId,
      indent_number: trimmed,
      indent_date: indentDate,
      activity_name: activityName?.trim() || null,
      indenter_name: indenterName?.trim() || null,
      indenter_mobile: indenterMobile?.trim() || null,
      is_academic: !!isAcademic,
      source_file_path: sourceFilePath || null,
      source_file_name: sourceFileName || null,
      notes: notes?.trim() || null,
      created_by: createdBy ?? null,
    })
    .select(INDENT_SELECT)
    .single();
  if (error) {
    if (error.code === '23505') throw new Error(`Indent number "${trimmed}" already exists for this project.`);
    throw error;
  }
  return data;
}

export async function createIndentWithItems(projectId, indent, items) {
  const created = await createIndent(projectId, indent);
  const rows = (items ?? []).map((it, idx) => ({
    indent_id: created.id,
    item_name: (it.item_name ?? '').trim(),
    item_description: it.item_description?.trim() || null,
    unit: it.unit?.trim() || null,
    have_qty: Number(it.have_qty ?? 0),
    buy_qty: Number(it.buy_qty ?? 0),
    unit_price: it.unit_price == null || it.unit_price === '' ? null : Number(it.unit_price),
    remark: it.remark?.trim() || null,
    sort_order: it.sort_order ?? idx + 1,
  })).filter((r) => r.item_name);
  if (rows.length === 0) return { indent: created, items: [] };
  const { data, error } = await supabase.from('indent_items').insert(rows).select('*');
  if (error) throw error;
  return { indent: created, items: data ?? [] };
}

export async function uploadIndentFile(projectId, file) {
  if (!file) throw new Error('No file selected.');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  const path = `${projectId}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from('indent-files').upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return { path, name: file.name };
}

export async function getIndentFileSignedUrl(path, expiresInSeconds = 300) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from('indent-files').createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data?.signedUrl ?? null;
}

export async function updateIndent(id, patch) {
  const cleaned = { ...patch, updated_at: new Date().toISOString() };
  if (cleaned.indent_number !== undefined) cleaned.indent_number = cleaned.indent_number.trim();
  if (cleaned.notes !== undefined) cleaned.notes = cleaned.notes?.trim() || null;
  const { data, error } = await supabase.from('indents').update(cleaned).eq('id', id).select(INDENT_SELECT).single();
  if (error) throw error;
  return data;
}

export async function removeIndent(id) {
  const { error } = await supabase.from('indents').delete().eq('id', id);
  if (error) throw error;
}

export async function addIndentItem(indentId, item) {
  const row = {
    indent_id: indentId,
    item_name: (item.item_name ?? '').trim(),
    item_description: item.item_description?.trim() || null,
    unit: item.unit?.trim() || null,
    have_qty: Number(item.have_qty ?? 0),
    buy_qty: Number(item.buy_qty ?? 0),
    unit_price: item.unit_price == null || item.unit_price === '' ? null : Number(item.unit_price),
    remark: item.remark?.trim() || null,
    mapped_task_id: item.mapped_task_id || null,
    assigned_to_ids: Array.isArray(item.assigned_to_ids) ? item.assigned_to_ids : [],
    sort_order: item.sort_order ?? 0,
    parent_indent_item_id: item.parent_indent_item_id || null,
  };
  if (!row.item_name) throw new Error('Item name is required.');
  const { data, error } = await supabase.from('indent_items').insert(row).select('*').single();
  if (error) throw error;
  // Notify PM + assignees on new indent item
  try {
    const { data: ctx } = await supabase
      .from('indents')
      .select('indent_number, projects!indents_project_id_fkey!inner ( id, name, project_manager_id )')
      .eq('id', indentId).single();
    const project = ctx?.projects;
    const recipients = new Set(Array.isArray(row.assigned_to_ids) ? row.assigned_to_ids : []);
    if (project?.project_manager_id) recipients.add(project.project_manager_id);
    if (recipients.size) {
      notifyMany(Array.from(recipients).map((pid) => ({
        recipient_profile_id: pid,
        type: 'indent_item_added',
        message: `New indent item "${data.item_name}" added to ${ctx.indent_number} in "${project.name}".\n#project=${project.id}`,
        email: true,
      })));
    }
  } catch { /* ignore */ }
  return data;
}

const TRACKED_ITEM_FIELDS = ['unit_price', 'buy_qty', 'have_qty', 'received_qty', 'planned_amount', 'actual_amount'];

async function logIndentItemChanges(itemId, before, after, { actorId, reason } = {}) {
  if (!before || !after) return;
  const rows = [];
  for (const field of TRACKED_ITEM_FIELDS) {
    const prev = before[field];
    const next = after[field];
    if (prev === next) continue;
    if (prev == null && next == null) continue;
    const pn = prev == null ? null : Number(prev);
    const nn = next == null ? null : Number(next);
    const delta = pn != null && nn != null ? Number((nn - pn).toFixed(4)) : null;
    rows.push({
      item_id: itemId,
      field,
      previous_value: pn,
      new_value: nn,
      delta,
      reason: reason ?? null,
      changed_by: actorId ?? null,
    });
  }
  if (!rows.length) return;
  const { error } = await supabase.from('indent_item_variance_history').insert(rows);
  if (error) console.warn('[indent_item history] insert failed:', error.message);
}

export async function updateIndentItem(id, patch, { actorId, reason } = {}) {
  const cleaned = { ...patch, updated_at: new Date().toISOString() };
  if (cleaned.item_name !== undefined) cleaned.item_name = (cleaned.item_name ?? '').trim();
  if (cleaned.item_description !== undefined) cleaned.item_description = cleaned.item_description?.trim() || null;
  if (cleaned.unit !== undefined) cleaned.unit = cleaned.unit?.trim() || null;
  if (cleaned.have_qty !== undefined) cleaned.have_qty = Number(cleaned.have_qty);
  if (cleaned.buy_qty !== undefined) cleaned.buy_qty = Number(cleaned.buy_qty);
  if (cleaned.unit_price !== undefined) cleaned.unit_price = cleaned.unit_price == null || cleaned.unit_price === '' ? null : Number(cleaned.unit_price);
  if (cleaned.remark !== undefined) cleaned.remark = cleaned.remark?.trim() || null;
  if (cleaned.received_qty !== undefined) cleaned.received_qty = Number(cleaned.received_qty);
  if (cleaned.planned_amount !== undefined) cleaned.planned_amount = cleaned.planned_amount == null || cleaned.planned_amount === '' ? null : Number(cleaned.planned_amount);
  if (cleaned.actual_amount !== undefined) cleaned.actual_amount = cleaned.actual_amount == null || cleaned.actual_amount === '' ? null : Number(cleaned.actual_amount);
  const { data: before } = await supabase.from('indent_items').select('*').eq('id', id).single();
  const { data, error } = await supabase.from('indent_items').update(cleaned).eq('id', id).select('*').single();
  if (error) throw error;
  await logIndentItemChanges(id, before, data, { actorId, reason });
  audit({
    actorId, action: 'update', entityType: 'indent_item', entityId: id,
    before, after: data, context: { indent_id: data?.indent_id },
  });
  return data;
}

export async function listIndentItemHistory(itemId) {
  const { data, error } = await supabase
    .from('indent_item_variance_history')
    .select('id, item_id, field, previous_value, new_value, delta, reason, changed_by, created_at, changed_by_profile:profiles!indent_item_variance_history_changed_by_fkey ( id, first_name, last_name, email )')
    .eq('item_id', itemId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function removeIndentItem(id) {
  const { error } = await supabase.from('indent_items').delete().eq('id', id);
  if (error) throw error;
}

export async function extractIndentFromFile(projectId, file) {
  // OCR runs on the Python service (Vercel /api/extract-indent in production,
  // scripts/indent_scan/ocr_server.py on :8765 in local dev). URL comes from
  // VITE_OCR_ENDPOINT — no Supabase fallback, no LLM path.
  const endpoint = import.meta?.env?.VITE_OCR_ENDPOINT;
  if (!endpoint) {
    throw new Error('OCR endpoint is not configured. Set VITE_OCR_ENDPOINT in the Vercel environment variables and redeploy.');
  }
  const fd = new FormData();
  fd.append('file', file, file.name);
  let res;
  try {
    res = await fetch(endpoint, { method: 'POST', body: fd });
  } catch (netErr) {
    throw new Error(`Could not reach the OCR service at ${endpoint}. (${netErr.message})`);
  }
  if (!res.ok) {
    let msg = `OCR failed (HTTP ${res.status}).`;
    try { const body = await res.json(); if (body?.detail) msg = body.detail; } catch { /* not JSON */ }
    throw new Error(msg);
  }
  const data = await res.json();
  const { path } = await uploadIndentFile(projectId, file);
  return { path, ...data };
}

export async function recordReceipt(id, { receivedQty, receivedOn, receivedNote }, { actorId } = {}) {
  const { data: before } = await supabase.from('indent_items').select('*').eq('id', id).single();
  const rq = Number(receivedQty ?? 0);
  const price = Number(before?.unit_price ?? 0);
  // Actual amount = received × unit price. Kept as a stored column so reports don't recompute.
  const nextActual = Number.isFinite(rq) && Number.isFinite(price) ? Number((rq * price).toFixed(2)) : null;
  const patch = {
    received_qty: rq,
    received_on: receivedOn || null,
    received_note: receivedNote?.trim() || null,
    actual_amount: nextActual,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase.from('indent_items').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  await logIndentItemChanges(id, before, data, { actorId, reason: receivedNote?.trim() || null });
  return data;
}

export function computeItemTotals(items) {
  let totalNeed = 0;
  let totalCost = 0;
  let totalActual = 0;
  for (const i of items ?? []) {
    const buy = Number(i.buy_qty || 0);
    const price = Number(i.unit_price || 0);
    const actual = Number(i.actual_amount ?? (Number(i.received_qty || 0) * price));
    totalNeed += buy;
    totalCost += buy * price;
    if (Number.isFinite(actual)) totalActual += actual;
  }
  return { totalNeed, totalCost, totalActual };
}

// Group indent items so each parent carries its own children in `.subRows`.
// Sub-rows are same-item additions at a later time / different price. The parent's
// rolled-up planned amount = sum(parent line + child lines). Same for actual.
export function groupItemsByParent(items) {
  const list = items ?? [];
  const childrenByParent = new Map();
  const parents = [];
  for (const it of list) {
    if (it.parent_indent_item_id) {
      if (!childrenByParent.has(it.parent_indent_item_id)) childrenByParent.set(it.parent_indent_item_id, []);
      childrenByParent.get(it.parent_indent_item_id).push(it);
    } else {
      parents.push(it);
    }
  }
  return parents.map((p) => {
    const subRows = (childrenByParent.get(p.id) ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const parentPlanned = Number(p.buy_qty || 0) * Number(p.unit_price || 0);
    const parentActual = p.actual_amount != null ? Number(p.actual_amount) : Number(p.received_qty || 0) * Number(p.unit_price || 0);
    const childPlanned = subRows.reduce((s, c) => s + Number(c.buy_qty || 0) * Number(c.unit_price || 0), 0);
    const childActual = subRows.reduce((s, c) => s + (c.actual_amount != null ? Number(c.actual_amount) : Number(c.received_qty || 0) * Number(c.unit_price || 0)), 0);
    return {
      ...p,
      subRows,
      rolledPlanned: parentPlanned + childPlanned,
      rolledActual: parentActual + childActual,
    };
  });
}
