-- ============================================================================
-- Migration 20260909 — RAG monthly versioning + drop separate monthly table
-- ----------------------------------------------------------------------------
-- 1. Drop the separate rag_rule_months table (functionality merged into rag_config versions).
-- 2. Add rag_config_versions — one row per calendar month capturing the amber-only snapshot.
--    Dashboard uses the latest version by default; user can switch versions via a dropdown.
--    Unique(year, month) enforces "one edit per month".
-- ============================================================================

drop table if exists public.rag_rule_months cascade;

create table if not exists public.rag_config_versions (
  id uuid primary key default gen_random_uuid(),
  effective_year  integer not null,
  effective_month integer not null,
  snapshot jsonb not null,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint rag_config_versions_ym_unique unique (effective_year, effective_month),
  constraint rag_config_versions_month_check check (effective_month between 1 and 12),
  constraint rag_config_versions_year_check  check (effective_year  between 2020 and 2099)
);
create index if not exists rag_config_versions_ym_idx on public.rag_config_versions (effective_year desc, effective_month desc);

alter table public.rag_config_versions enable row level security;

drop policy if exists "rag_config_versions: authenticated read" on public.rag_config_versions;
create policy "rag_config_versions: authenticated read"
  on public.rag_config_versions for select using (auth.uid() is not null);

drop policy if exists "rag_config_versions: admin write" on public.rag_config_versions;
create policy "rag_config_versions: admin write"
  on public.rag_config_versions for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

notify pgrst, 'reload schema';
