-- ============================================================================
-- Migration 20260907 — Baselines, amount tracking, and helpers
-- ----------------------------------------------------------------------------
-- Idempotent: safe to re-run. Applies every schema change added in this session:
--   * project_task_baselines table (append-only date/amount snapshots per task).
--   * kind discriminator + snapshot_amount column on project_task_baselines.
--   * planned_amount / actual_amount columns on indent_items.
--   * project_task_amounts table (per-task planned + actual money).
--   * RLS policies for both new tables.
--
-- Run this once in the Supabase SQL editor BEFORE running the
-- library_wing_a_completed.sql seed. After it completes, Supabase's PostgREST
-- schema cache auto-reloads within a few seconds — if the app still shows
-- "Could not find the table ... in the schema cache", refresh the page.
-- ============================================================================

-- 1. project_task_baselines --------------------------------------------------
create table if not exists public.project_task_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id    uuid not null references public.project_tasks(id) on delete cascade,
  snapshot_start date,
  snapshot_end   date,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists project_task_baselines_task_idx    on public.project_task_baselines (task_id, created_at desc);
create index if not exists project_task_baselines_project_idx on public.project_task_baselines (project_id, created_at desc);

-- Add kind discriminator + snapshot_amount if missing.
alter table public.project_task_baselines add column if not exists kind text not null default 'task_date';
alter table public.project_task_baselines drop constraint if exists project_task_baselines_kind_check;
alter table public.project_task_baselines
  add constraint project_task_baselines_kind_check
  check (kind in ('task_date', 'task_amount', 'milestone_date'));
alter table public.project_task_baselines add column if not exists snapshot_amount numeric;
create index if not exists project_task_baselines_kind_idx on public.project_task_baselines (task_id, kind, created_at desc);

-- Allow milestone baselines by pointing at project_milestones.id in a parallel column.
-- task_id and milestone_id are mutually exclusive; exactly one must be set on each row.
alter table public.project_task_baselines add column if not exists milestone_id uuid references public.project_milestones(id) on delete cascade;
alter table public.project_task_baselines alter column task_id drop not null;
alter table public.project_task_baselines drop constraint if exists project_task_baselines_target_check;
alter table public.project_task_baselines
  add constraint project_task_baselines_target_check
  check ((task_id is not null) <> (milestone_id is not null));
create index if not exists project_task_baselines_milestone_idx on public.project_task_baselines (milestone_id, created_at desc) where milestone_id is not null;

alter table public.project_task_baselines enable row level security;

drop policy if exists "baselines: read" on public.project_task_baselines;
create policy "baselines: read"
  on public.project_task_baselines for select
  using (
    exists (
      select 1 from public.projects p
      where p.id = project_task_baselines.project_id
        and (
          p.is_draft = false
          or p.created_by in (select id from public.profiles where auth_user_id = auth.uid())
          or public.is_project_admin()
        )
    )
  );

drop policy if exists "baselines: write" on public.project_task_baselines;
create policy "baselines: write"
  on public.project_task_baselines for insert
  with check (public.is_project_admin() or public.has_role('project_manager'));

-- 2. indent_items amount columns --------------------------------------------
alter table public.indent_items add column if not exists planned_amount numeric;
alter table public.indent_items add column if not exists actual_amount  numeric;

-- 3. project_task_amounts ---------------------------------------------------
create table if not exists public.project_task_amounts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null unique references public.project_tasks(id) on delete cascade,
  planned_amount numeric,
  actual_amount  numeric,
  currency text not null default 'INR',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
create index if not exists project_task_amounts_task_idx on public.project_task_amounts (task_id);

alter table public.project_task_amounts enable row level security;

drop policy if exists "task amounts: read" on public.project_task_amounts;
create policy "task amounts: read"
  on public.project_task_amounts for select
  using (
    exists (
      select 1 from public.project_tasks pt
      join public.projects p on p.id = pt.project_id
      where pt.id = project_task_amounts.task_id
        and (
          p.is_draft = false
          or p.created_by in (select id from public.profiles where auth_user_id = auth.uid())
          or public.is_project_admin()
        )
    )
  );

drop policy if exists "task amounts: write" on public.project_task_amounts;
create policy "task amounts: write"
  on public.project_task_amounts for all
  using (public.is_project_admin() or public.has_role('project_manager'))
  with check (public.is_project_admin() or public.has_role('project_manager'));

-- 4. Nudge PostgREST to reload the schema cache immediately (no-op if not present).
notify pgrst, 'reload schema';
