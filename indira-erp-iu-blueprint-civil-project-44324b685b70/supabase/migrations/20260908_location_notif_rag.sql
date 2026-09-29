-- ============================================================================
-- Migration 20260908 — Location tags · Notification prefs · Monthly RAG
-- ----------------------------------------------------------------------------
-- Idempotent. Adds three feature blocks in one script:
--   1. location_tags — Campus → School → Location Tag hierarchy.
--   2. notification_modules + user_notification_prefs — per-user email opt-in per module.
--   3. rag_rule_months — 12-month amber-only baseline overrides per RAG rule.
-- ============================================================================

-- ------------------------------------------------------------------
-- 1. Location Tags — third level below Campus → School
-- ------------------------------------------------------------------
create table if not exists public.location_tags (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_tags_name_per_school_unique unique (school_id, name)
);
create index if not exists location_tags_school_idx on public.location_tags (school_id);
create index if not exists location_tags_active_idx on public.location_tags (is_active);

alter table public.location_tags enable row level security;

drop policy if exists "location_tags: authenticated read" on public.location_tags;
create policy "location_tags: authenticated read"
  on public.location_tags for select using (auth.uid() is not null);

drop policy if exists "location_tags: admin write" on public.location_tags;
create policy "location_tags: admin write"
  on public.location_tags for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- Link projects to a location tag (optional).
alter table public.projects add column if not exists location_tag_id uuid references public.location_tags(id) on delete set null;
create index if not exists projects_location_tag_idx on public.projects (location_tag_id) where location_tag_id is not null;

-- ------------------------------------------------------------------
-- 2. Notification modules + user preferences
-- ------------------------------------------------------------------
create table if not exists public.notification_modules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists notification_modules_active_idx on public.notification_modules (is_active);

alter table public.notification_modules enable row level security;

drop policy if exists "notification_modules: authenticated read" on public.notification_modules;
create policy "notification_modules: authenticated read"
  on public.notification_modules for select using (auth.uid() is not null);

drop policy if exists "notification_modules: admin write" on public.notification_modules;
create policy "notification_modules: admin write"
  on public.notification_modules for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- User preferences: which modules they want email notifications for.
create table if not exists public.user_notification_prefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  module_id uuid not null references public.notification_modules(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint user_notification_prefs_unique unique (user_id, module_id)
);
create index if not exists user_notification_prefs_user_idx on public.user_notification_prefs (user_id);

alter table public.user_notification_prefs enable row level security;

drop policy if exists "user_notification_prefs: self read" on public.user_notification_prefs;
create policy "user_notification_prefs: self read"
  on public.user_notification_prefs for select
  using (user_id in (select id from public.profiles where auth_user_id = auth.uid()) or public.is_project_admin());

drop policy if exists "user_notification_prefs: self write" on public.user_notification_prefs;
create policy "user_notification_prefs: self write"
  on public.user_notification_prefs for all
  using (user_id in (select id from public.profiles where auth_user_id = auth.uid()) or public.is_project_admin())
  with check (user_id in (select id from public.profiles where auth_user_id = auth.uid()) or public.is_project_admin());

-- Seed the default module list (idempotent via key upsert).
insert into public.notification_modules (key, name, description, sort_order) values
  ('tasks',              'Task assignments',    'When a task is assigned to you or updated on a project you manage.',        10),
  ('messages',           'Project messages',    'New messages posted in project message threads you follow.',                20),
  ('mentions',           'Mentions (@you)',     'You are @-mentioned in a message or comment.',                              30),
  ('indent_deliveries',  'Indent deliveries',   'Deliveries logged against your indent items.',                              40),
  ('documents',          'Documents uploaded',  'New documents uploaded to your projects.',                                  50),
  ('baseline_changes',   'Baseline changes',    'Task dates or budget snapshots change on your projects.',                   60),
  ('approvals',          'Approvals',           'A status change or edit needs your approval.',                              70),
  ('milestones',         'Milestone updates',   'Milestones reached, delayed, or re-baselined on your projects.',            80),
  ('budget_variance',    'Budget variance',     'A project or task goes over budget by a meaningful margin.',                90)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  sort_order = excluded.sort_order;

-- ------------------------------------------------------------------
-- 3. RAG rules — monthly amber-only overrides
-- ------------------------------------------------------------------
-- One row per (rag_rule_id, month) — month is 1..12. amber_pct is the amber threshold
-- for that calendar month. Below this = Red, at or above this = Green. No amber zone.
-- If a rule has no row for a month, fall back to rag_rules.amber_min_pct.
create table if not exists public.rag_rule_months (
  id uuid primary key default gen_random_uuid(),
  rag_rule_id uuid not null references public.rag_rules(id) on delete cascade,
  month integer not null,
  amber_pct integer not null,
  updated_at timestamptz not null default now(),
  constraint rag_rule_months_unique unique (rag_rule_id, month),
  constraint rag_rule_months_month_check check (month between 1 and 12),
  constraint rag_rule_months_pct_check   check (amber_pct between 0 and 100)
);
create index if not exists rag_rule_months_rule_idx on public.rag_rule_months (rag_rule_id);

alter table public.rag_rule_months enable row level security;

drop policy if exists "rag_rule_months: authenticated read" on public.rag_rule_months;
create policy "rag_rule_months: authenticated read"
  on public.rag_rule_months for select using (auth.uid() is not null);

drop policy if exists "rag_rule_months: admin write" on public.rag_rule_months;
create policy "rag_rule_months: admin write"
  on public.rag_rule_months for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- Nudge PostgREST to reload the schema cache immediately.
notify pgrst, 'reload schema';
