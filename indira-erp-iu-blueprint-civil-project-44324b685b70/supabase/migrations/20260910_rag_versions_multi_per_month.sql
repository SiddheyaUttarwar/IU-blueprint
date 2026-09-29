-- ============================================================================
-- Migration 20260910 — Allow multiple RAG versions per calendar month
-- ----------------------------------------------------------------------------
-- Drops the "one edit per month" unique constraint and adds a version_no column.
-- New unique key: (year, month, version_no). Labels render as "Sep 2026 v1", "Sep 2026 v2", …
-- Idempotent.
-- ============================================================================

alter table public.rag_config_versions add column if not exists version_no integer;

-- Backfill existing rows: any pre-existing row for a month becomes v1.
update public.rag_config_versions
   set version_no = 1
 where version_no is null;

alter table public.rag_config_versions alter column version_no set not null;
alter table public.rag_config_versions alter column version_no set default 1;

-- Drop the old one-per-month unique constraint; replace with (year, month, version_no).
alter table public.rag_config_versions drop constraint if exists rag_config_versions_ym_unique;
alter table public.rag_config_versions drop constraint if exists rag_config_versions_ymv_unique;
alter table public.rag_config_versions
  add constraint rag_config_versions_ymv_unique unique (effective_year, effective_month, version_no);

-- Helpful index for the "next version_no for this month" lookup.
create index if not exists rag_config_versions_ym_ver_idx
  on public.rag_config_versions (effective_year desc, effective_month desc, version_no desc);

notify pgrst, 'reload schema';
