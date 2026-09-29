import { supabase } from '../lib/supabaseClient.js';

export const DEFAULT_RAG_CONFIG = {
  progress_amber_pts: 2.00,
  progress_red_pts: 5.00,
  schedule_amber_pct: 5.00,
  schedule_amber_min_days: 7,
  schedule_red_pct: 10.00,
  cost_amber_pct: 5.00,
  cost_red_pct: 10.00,
};

export const RAG_PARAMETER_LABELS = {
  progress_amber_pts: 'Amber Threshold (pts behind plan)',
  progress_red_pts: 'Red Threshold (pts behind plan)',
  schedule_amber_pct: 'Amber Allowance (% of baseline)',
  schedule_amber_min_days: 'Minimum Amber Days',
  schedule_red_pct: 'Red Threshold (% of baseline)',
  cost_amber_pct: 'Amber Threshold (% over budget)',
  cost_red_pct: 'Red Threshold (% over budget)',
};

export const RAG_METRIC_BY_PARAM = {
  progress_amber_pts: 'progress',
  progress_red_pts: 'progress',
  schedule_amber_pct: 'schedule',
  schedule_amber_min_days: 'schedule',
  schedule_red_pct: 'schedule',
  cost_amber_pct: 'cost',
  cost_red_pct: 'cost',
};

export async function getRagConfig() {
  const { data, error } = await supabase
    .from('rag_config')
    .select('*, updated_by_profile:profiles!rag_config_updated_by_fkey ( id, first_name, last_name, email )')
    .eq('is_active', true)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export function validateRagConfig(cfg) {
  const errs = {};
  const nz = (v) => v == null || v === '' || Number.isNaN(Number(v));
  if (nz(cfg.progress_amber_pts) || Number(cfg.progress_amber_pts) < 0) errs.progress_amber_pts = 'Must be a non-negative number.';
  if (nz(cfg.progress_red_pts) || Number(cfg.progress_red_pts) < 0) errs.progress_red_pts = 'Must be a non-negative number.';
  if (!errs.progress_amber_pts && !errs.progress_red_pts && Number(cfg.progress_red_pts) < Number(cfg.progress_amber_pts)) {
    errs.progress_red_pts = 'Red threshold must be ≥ Amber threshold.';
  }
  if (nz(cfg.schedule_amber_pct) || Number(cfg.schedule_amber_pct) < 0) errs.schedule_amber_pct = 'Must be a non-negative percentage.';
  if (nz(cfg.schedule_red_pct) || Number(cfg.schedule_red_pct) < 0) errs.schedule_red_pct = 'Must be a non-negative percentage.';
  if (!errs.schedule_amber_pct && !errs.schedule_red_pct && Number(cfg.schedule_red_pct) < Number(cfg.schedule_amber_pct)) {
    errs.schedule_red_pct = 'Red % must be ≥ Amber %.';
  }
  if (!Number.isInteger(Number(cfg.schedule_amber_min_days)) || Number(cfg.schedule_amber_min_days) < 0) {
    errs.schedule_amber_min_days = 'Must be a whole number of days (0 or more).';
  }
  if (nz(cfg.cost_amber_pct) || Number(cfg.cost_amber_pct) < 0) errs.cost_amber_pct = 'Must be a non-negative percentage.';
  if (nz(cfg.cost_red_pct) || Number(cfg.cost_red_pct) < 0) errs.cost_red_pct = 'Must be a non-negative percentage.';
  if (!errs.cost_amber_pct && !errs.cost_red_pct && Number(cfg.cost_red_pct) < Number(cfg.cost_amber_pct)) {
    errs.cost_red_pct = 'Red % must be ≥ Amber %.';
  }
  return errs;
}

export async function updateRagConfig(current, patch, actorProfileId) {
  const errs = validateRagConfig({ ...current, ...patch });
  if (Object.keys(errs).length) {
    const first = Object.values(errs)[0];
    throw new Error(first);
  }
  const changedParams = Object.keys(patch).filter((k) => String(current?.[k] ?? '') !== String(patch[k] ?? ''));
  if (changedParams.length === 0) return current;

  const { data: updated, error: uErr } = await supabase
    .from('rag_config')
    .update({ ...patch, updated_by: actorProfileId ?? null, updated_at: new Date().toISOString() })
    .eq('id', current.id)
    .select('*')
    .single();
  if (uErr) throw uErr;

  const auditRows = changedParams.map((param) => ({
    changed_by: actorProfileId ?? null,
    metric: RAG_METRIC_BY_PARAM[param],
    parameter: RAG_PARAMETER_LABELS[param] ?? param,
    previous_value: String(current?.[param] ?? ''),
    new_value: String(patch[param] ?? ''),
  }));
  if (auditRows.length) {
    const { error: aErr } = await supabase.from('rag_config_audit').insert(auditRows);
    if (aErr) console.error('rag audit insert failed', aErr);
  }
  return updated;
}

// --- Monthly version snapshots (amber-only, one row per calendar month) --------
// Each version stores a jsonb snapshot of the amber thresholds. Red is derived as
// "anything beyond amber" so we only capture amber values.

export async function listRagVersions() {
  const { data, error } = await supabase
    .from('rag_config_versions')
    .select('id, effective_year, effective_month, version_no, snapshot, reason, created_at, created_by, created_by_profile:profiles!rag_config_versions_created_by_fkey ( id, first_name, last_name, email )')
    .order('effective_year', { ascending: false })
    .order('effective_month', { ascending: false })
    .order('version_no', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function getLatestRagVersion() {
  const list = await listRagVersions();
  return list[0] ?? null;
}

// Save a snapshot for the given year+month. Multiple versions per month are allowed —
// the version_no auto-increments (v1, v2, v3, …) within the same month.
export async function saveRagVersion(snapshot, { year, month, reason, actorId }) {
  // Determine the next version_no for this year+month.
  const { data: existing, error: qErr } = await supabase
    .from('rag_config_versions')
    .select('version_no')
    .eq('effective_year', year)
    .eq('effective_month', month)
    .order('version_no', { ascending: false })
    .limit(1);
  if (qErr) throw qErr;
  const nextVersionNo = (existing?.[0]?.version_no ?? 0) + 1;

  const { data, error } = await supabase
    .from('rag_config_versions')
    .insert({
      effective_year: year,
      effective_month: month,
      version_no: nextVersionNo,
      snapshot,
      reason: reason ?? null,
      created_by: actorId ?? null,
    })
    .select('id, effective_year, effective_month, version_no, snapshot, reason, created_at')
    .single();
  if (error) throw error;
  return data;
}

export function labelForVersion(v) {
  if (!v) return '';
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${MONTHS[v.effective_month - 1]} ${v.effective_year}`;
  return v.version_no && v.version_no > 1 ? `${base} v${v.version_no}` : `${base}${v.version_no === 1 ? ' v1' : ''}`;
}

export async function listRagAudit(limit = 50) {
  const { data, error } = await supabase
    .from('rag_config_audit')
    .select('*, changed_by_profile:profiles!rag_config_audit_changed_by_fkey ( id, first_name, last_name, email )')
    .order('changed_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}
