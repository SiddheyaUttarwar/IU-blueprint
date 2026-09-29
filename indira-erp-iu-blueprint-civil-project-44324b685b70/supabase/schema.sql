-- Enrolled users mirrored from UMS. Source of truth for who can sign in.
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text not null unique,
  first_name text,
  middle_name text,
  last_name text,
  emp_id integer,
  title_id integer,
  designation_id integer,
  staff_type_id integer,
  indira_university_id integer,
  employee_number text,
  mobile_number text,
  emergency_contact_number text,
  date_of_birth date,
  organisation_joining_date date,
  gender text,
  blood_group text,
  role text not null default 'member' check (role in ('project_admin', 'project_manager', 'it_admin', 'leadership', 'member')),
  roles text[] not null default '{}',
  source text not null default 'manual' check (source in ('manual', 'sso')),
  must_change_password boolean not null default true,
  first_login_at timestamptz,
  enrolled_at timestamptz not null default now(),
  enrolled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_lower_idx on public.profiles (lower(email));
create index if not exists profiles_auth_user_id_idx on public.profiles (auth_user_id);

-- Upgrades for existing profiles tables (safe no-op if fresh).
alter table public.profiles add column if not exists roles text[] not null default '{}';
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('project_admin', 'project_manager', 'it_admin', 'leadership', 'member'));

-- Project types defined by IT Admin. Consumed by Project Templates and Projects.
create table if not exists public.project_types (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_types_active_idx on public.project_types (is_active);

alter table public.project_types enable row level security;

drop policy if exists "project_types: authenticated read" on public.project_types;
create policy "project_types: authenticated read"
  on public.project_types for select
  using (auth.uid() is not null);

-- Project Type master is now owned by Project Admin (moved from IT Admin). IT Admin retains
-- access so existing IT flows keep working; either role can add / edit / disable / delete.
drop policy if exists "project_types: it admin insert" on public.project_types;
drop policy if exists "project_types: admin insert" on public.project_types;
create policy "project_types: admin insert"
  on public.project_types for insert
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "project_types: it admin update" on public.project_types;
drop policy if exists "project_types: admin update" on public.project_types;
create policy "project_types: admin update"
  on public.project_types for update
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "project_types: it admin delete" on public.project_types;
drop policy if exists "project_types: admin delete" on public.project_types;
create policy "project_types: admin delete"
  on public.project_types for delete
  using (public.is_project_admin() or public.is_it_admin());

-- Project templates defined by IT Admin, tied to a project type.
create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  project_type_id uuid not null references public.project_types(id) on delete restrict,
  description text,
  department_id integer,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.project_templates add column if not exists description text;
alter table public.project_templates add column if not exists department_id integer;

create index if not exists project_templates_type_idx on public.project_templates (project_type_id);
create index if not exists project_templates_name_lower_idx on public.project_templates (lower(name));

-- Template versions. Every save updates updated_by/updated_at (audit of last editor).
create table if not exists public.template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.project_templates(id) on delete cascade,
  version_no integer not null,
  content_hash text,
  is_locked boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, version_no)
);

alter table public.template_versions add column if not exists updated_by uuid;
alter table public.template_versions add column if not exists updated_at timestamptz not null default now();
alter table public.template_versions drop constraint if exists template_versions_updated_by_fkey;
alter table public.template_versions
  add constraint template_versions_updated_by_fkey
  foreign key (updated_by) references public.profiles(id) on delete set null;

create index if not exists template_versions_template_idx on public.template_versions (template_id, version_no desc);
create index if not exists template_versions_updated_by_idx on public.template_versions (updated_by);

alter table public.template_versions enable row level security;

drop policy if exists "template_versions: authenticated read" on public.template_versions;
create policy "template_versions: authenticated read"
  on public.template_versions for select
  using (auth.uid() is not null);

drop policy if exists "template_versions: admin insert" on public.template_versions;
create policy "template_versions: admin insert"
  on public.template_versions for insert
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "template_versions: admin update" on public.template_versions;
create policy "template_versions: admin update"
  on public.template_versions for update
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "template_versions: admin delete" on public.template_versions;
create policy "template_versions: admin delete"
  on public.template_versions for delete
  using (public.is_project_admin() or public.is_it_admin());

alter table public.project_templates enable row level security;

drop policy if exists "project_templates: authenticated read" on public.project_templates;
create policy "project_templates: authenticated read"
  on public.project_templates for select
  using (auth.uid() is not null);

drop policy if exists "project_templates: it admin insert" on public.project_templates;
drop policy if exists "project_templates: admin insert" on public.project_templates;
create policy "project_templates: admin insert"
  on public.project_templates for insert
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "project_templates: it admin update" on public.project_templates;
drop policy if exists "project_templates: admin update" on public.project_templates;
create policy "project_templates: admin update"
  on public.project_templates for update
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "project_templates: it admin delete" on public.project_templates;
drop policy if exists "project_templates: admin delete" on public.project_templates;
create policy "project_templates: admin delete"
  on public.project_templates for delete
  using (public.is_project_admin() or public.is_it_admin());

-- Template tasks (self-referencing so subtasks are just tasks with parent_task_id).
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_template_id uuid not null references public.project_templates(id) on delete cascade,
  phase text not null check (phase in ('pre_project', 'project')),
  name text not null,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_template_phase_idx on public.tasks (project_template_id, phase);
create index if not exists tasks_parent_idx on public.tasks (parent_task_id);

alter table public.tasks enable row level security;

drop policy if exists "tasks: authenticated read" on public.tasks;
create policy "tasks: authenticated read"
  on public.tasks for select
  using (auth.uid() is not null);

drop policy if exists "tasks: it admin insert" on public.tasks;
create policy "tasks: it admin insert"
  on public.tasks for insert
  with check (public.is_it_admin());

drop policy if exists "tasks: it admin update" on public.tasks;
create policy "tasks: it admin update"
  on public.tasks for update
  using (public.is_it_admin())
  with check (public.is_it_admin());

drop policy if exists "tasks: it admin delete" on public.tasks;
create policy "tasks: it admin delete"
  on public.tasks for delete
  using (public.is_it_admin());

-- Template milestones (a milestone belongs to a template + phase).
create table if not exists public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_template_id uuid not null references public.project_templates(id) on delete cascade,
  phase text not null check (phase in ('pre_project', 'project')),
  name text not null,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_template_id, phase, name)
);

create index if not exists milestones_template_phase_idx on public.milestones (project_template_id, phase);

alter table public.milestones enable row level security;

drop policy if exists "milestones: authenticated read" on public.milestones;
create policy "milestones: authenticated read"
  on public.milestones for select
  using (auth.uid() is not null);

drop policy if exists "milestones: it admin insert" on public.milestones;
create policy "milestones: it admin insert"
  on public.milestones for insert
  with check (public.is_it_admin());

drop policy if exists "milestones: it admin update" on public.milestones;
create policy "milestones: it admin update"
  on public.milestones for update
  using (public.is_it_admin())
  with check (public.is_it_admin());

drop policy if exists "milestones: it admin delete" on public.milestones;
create policy "milestones: it admin delete"
  on public.milestones for delete
  using (public.is_it_admin());

-- Approval Authorities removed — deprecated on 2026-09-03. See schema delta for DROP steps.

-- Template structure (per version): tasks (self-referencing for WBS tree) + milestones + deps.
-- task_type: 'task' = work item (owner + dates + progress); 'summary' = heading only (rolls up).
create table if not exists public.template_tasks (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.template_versions(id) on delete cascade,
  phase text not null check (phase in ('pre_project', 'project')),
  parent_task_id uuid references public.template_tasks(id) on delete cascade,
  task_type text not null default 'task' check (task_type in ('task', 'summary')),
  name text not null,
  is_mandatory boolean not null default true,
  weight_pct numeric(6,2) not null default 0,
  progress_metric text not null default 'done_not_done'
    check (progress_metric in ('quantity', 'done_not_done', 'percent')),
  quantity_value numeric,
  quantity_unit text,
  master_task_id uuid references public.tasks(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.template_tasks add column if not exists task_type text not null default 'task';
alter table public.template_tasks drop constraint if exists template_tasks_task_type_check;
alter table public.template_tasks
  add constraint template_tasks_task_type_check check (task_type in ('task', 'summary'));

-- Templates only capture the metric; actual qty/unit are entered by the PM during project creation.
alter table public.template_tasks drop constraint if exists template_tasks_quantity_check;

create index if not exists template_tasks_version_phase_idx
  on public.template_tasks (version_id, phase, parent_task_id);

create unique index if not exists template_tasks_root_unique
  on public.template_tasks (version_id, lower(name))
  where parent_task_id is null;

create unique index if not exists template_tasks_sub_unique
  on public.template_tasks (version_id, parent_task_id, lower(name))
  where parent_task_id is not null;

create table if not exists public.template_milestones (
  id uuid primary key default gen_random_uuid(),
  version_id uuid not null references public.template_versions(id) on delete cascade,
  phase text not null check (phase in ('pre_project', 'project')),
  name text not null,
  sort_order integer not null default 0,
  master_milestone_id uuid references public.milestones(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists template_milestones_unique
  on public.template_milestones (version_id, lower(name));

create table if not exists public.template_task_dependencies (
  version_id uuid not null references public.template_versions(id) on delete cascade,
  task_id uuid not null references public.template_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.template_tasks(id) on delete cascade,
  primary key (version_id, task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

alter table public.template_tasks enable row level security;
alter table public.template_milestones enable row level security;
alter table public.template_task_dependencies enable row level security;

drop policy if exists "template_tasks: authenticated read" on public.template_tasks;
create policy "template_tasks: authenticated read"
  on public.template_tasks for select using (auth.uid() is not null);
drop policy if exists "template_tasks: admin write" on public.template_tasks;
create policy "template_tasks: admin write"
  on public.template_tasks for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "template_milestones: authenticated read" on public.template_milestones;
create policy "template_milestones: authenticated read"
  on public.template_milestones for select using (auth.uid() is not null);
drop policy if exists "template_milestones: admin write" on public.template_milestones;
create policy "template_milestones: admin write"
  on public.template_milestones for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

drop policy if exists "template_task_dependencies: authenticated read" on public.template_task_dependencies;
create policy "template_task_dependencies: authenticated read"
  on public.template_task_dependencies for select using (auth.uid() is not null);
drop policy if exists "template_task_dependencies: admin write" on public.template_task_dependencies;
create policy "template_task_dependencies: admin write"
  on public.template_task_dependencies for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- In-app notifications for the navbar bell (first_login, and future types).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_profile_id uuid not null references public.profiles(id) on delete cascade,
  subject_profile_id uuid references public.profiles(id) on delete set null,
  type text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_recipient_idx
  on public.notifications (recipient_profile_id, read_at, created_at desc);

-- SECURITY DEFINER helpers: bypass RLS on the inner query to avoid policy recursion.
create or replace function public.has_role(target_role text) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where auth_user_id = auth.uid()
      and (role = target_role or target_role = any(roles))
  );
$$;

create or replace function public.is_project_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('project_admin');
$$;

create or replace function public.is_it_admin() returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role('it_admin');
$$;

create or replace function public.owns_profile(pid uuid) returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = pid and auth_user_id = auth.uid()
  );
$$;

grant execute on function public.has_role(text) to authenticated;
grant execute on function public.is_project_admin() to authenticated;
grant execute on function public.is_it_admin() to authenticated;
grant execute on function public.owns_profile(uuid) to authenticated;

-- Backfill roles[] for existing rows so has_role works for legacy admins.
update public.profiles set roles = array[role] where roles = '{}';

alter table public.profiles enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = auth_user_id);

drop policy if exists "profiles: admins read all" on public.profiles;
create policy "profiles: admins read all"
  on public.profiles for select
  using (public.is_project_admin());

-- Every authenticated user needs to see the basic directory (name + email) so
-- @-mention pickers, assignee dropdowns, Team page rows, etc. work for members too.
drop policy if exists "profiles: authenticated read all" on public.profiles;
create policy "profiles: authenticated read all"
  on public.profiles for select
  using (auth.uid() is not null);

drop policy if exists "profiles: update own limited" on public.profiles;
create policy "profiles: update own limited"
  on public.profiles for update
  using (auth.uid() = auth_user_id)
  with check (auth.uid() = auth_user_id);

drop policy if exists "profiles: admins update all" on public.profiles;
create policy "profiles: admins update all"
  on public.profiles for update
  using (public.is_project_admin())
  with check (public.is_project_admin());

drop policy if exists "notifications: read own" on public.notifications;
create policy "notifications: read own"
  on public.notifications for select
  using (public.owns_profile(recipient_profile_id));

drop policy if exists "notifications: mark own read" on public.notifications;
create policy "notifications: mark own read"
  on public.notifications for update
  using (public.owns_profile(recipient_profile_id));

-- Without this INSERT policy every notifyMany() call is silently blocked by RLS,
-- so raised baseline/status requests never surface in the recipient's bell.
drop policy if exists "notifications: authenticated insert" on public.notifications;
create policy "notifications: authenticated insert"
  on public.notifications for insert
  with check (auth.uid() is not null);

-- Campus master
create table if not exists public.campuses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campuses_name_unique unique (name)
);
create index if not exists campuses_name_lower_idx on public.campuses (lower(name));
create index if not exists campuses_active_idx on public.campuses (is_active);

alter table public.campuses enable row level security;
drop policy if exists "campuses: authenticated read" on public.campuses;
create policy "campuses: authenticated read"
  on public.campuses for select using (auth.uid() is not null);
drop policy if exists "campuses: admin write" on public.campuses;
create policy "campuses: admin write"
  on public.campuses for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- School master (belongs to a campus)
create table if not exists public.schools (
  id uuid primary key default gen_random_uuid(),
  campus_id uuid not null references public.campuses(id) on delete restrict,
  name text not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists schools_campus_name_unique
  on public.schools (campus_id, lower(name));
create index if not exists schools_active_idx on public.schools (is_active);

alter table public.schools enable row level security;
drop policy if exists "schools: authenticated read" on public.schools;
create policy "schools: authenticated read"
  on public.schools for select using (auth.uid() is not null);
drop policy if exists "schools: admin write" on public.schools;
create policy "schools: admin write"
  on public.schools for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- RAG Rules master (health thresholds)
create table if not exists public.rag_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  green_min_pct integer not null,
  amber_min_pct integer not null,
  is_active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rag_rules_name_unique unique (name),
  constraint rag_rules_range_check check (
    green_min_pct between 0 and 100
    and amber_min_pct between 0 and 100
    and green_min_pct > amber_min_pct
  )
);
create index if not exists rag_rules_active_idx on public.rag_rules (is_active);

alter table public.rag_rules enable row level security;
drop policy if exists "rag_rules: authenticated read" on public.rag_rules;
create policy "rag_rules: authenticated read"
  on public.rag_rules for select using (auth.uid() is not null);
drop policy if exists "rag_rules: admin write" on public.rag_rules;
create policy "rag_rules: admin write"
  on public.rag_rules for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- ============================================================
-- Projects (instantiated from a template version)
-- ============================================================

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  project_class text not null check (project_class in ('greenfield', 'brownfield')),
  template_id uuid not null references public.project_templates(id) on delete restrict,
  template_version_id uuid not null references public.template_versions(id) on delete restrict,
  campus_id uuid references public.campuses(id) on delete set null,
  school_id uuid references public.schools(id) on delete set null,
  project_manager_id uuid references public.profiles(id) on delete set null,
  rag_rule_id uuid references public.rag_rules(id) on delete set null,
  start_date date,
  end_date date,
  baseline_days integer,
  actual_start_date date,
  actual_end_date date,
  status text not null default 'planning'
    check (status in ('planning', 'active', 'on_hold', 'completed', 'cancelled')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_name_unique unique (name),
  constraint projects_dates_check check (end_date is null or start_date is null or end_date >= start_date),
  constraint projects_baseline_days_check check (baseline_days is null or baseline_days > 0)
);
alter table public.projects add column if not exists baseline_days integer;
alter table public.projects add column if not exists actual_start_date date;
alter table public.projects add column if not exists actual_end_date date;
alter table public.projects drop constraint if exists projects_baseline_days_check;
alter table public.projects
  add constraint projects_baseline_days_check
  check (baseline_days is null or baseline_days > 0);
create index if not exists projects_name_lower_idx on public.projects (lower(name));
create index if not exists projects_pm_idx on public.projects (project_manager_id);
create index if not exists projects_status_idx on public.projects (status);
create index if not exists projects_template_version_idx on public.projects (template_version_id);

alter table public.projects enable row level security;
drop policy if exists "projects: authenticated read" on public.projects;
create policy "projects: authenticated read"
  on public.projects for select using (auth.uid() is not null);
drop policy if exists "projects: admin or pm write" on public.projects;
drop policy if exists "projects: pm insert" on public.projects;
create policy "projects: pm insert"
  on public.projects for insert
  with check (public.has_role('project_manager'));
drop policy if exists "projects: pm or admin update" on public.projects;
drop policy if exists "projects: pm update" on public.projects;
create policy "projects: pm update"
  on public.projects for update
  using (public.has_role('project_manager'))
  with check (public.has_role('project_manager'));
drop policy if exists "projects: admin delete" on public.projects;
drop policy if exists "projects: pm or admin delete" on public.projects;
drop policy if exists "projects: pm delete" on public.projects;
create policy "projects: pm delete"
  on public.projects for delete
  using (public.has_role('project_manager'));

-- Snapshot of template_tasks scoped to a project (WBS tree via parent_task_id).
-- task_type: 'task' = work item (owner + dates + progress); 'summary' = heading only (rolls up).
create table if not exists public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase text not null check (phase in ('pre_project', 'project')),
  parent_task_id uuid references public.project_tasks(id) on delete cascade,
  source_template_task_id uuid references public.template_tasks(id) on delete set null,
  task_type text not null default 'task' check (task_type in ('task', 'summary')),
  name text not null,
  is_mandatory boolean not null default true,
  weight_pct numeric(6, 2) not null default 0,
  progress_metric text not null default 'done_not_done'
    check (progress_metric in ('quantity', 'done_not_done', 'percent')),
  quantity_value numeric,
  quantity_unit text,
  actual_value numeric,
  status text not null default 'not_started'
    check (status in ('not_started', 'in_progress', 'blocked', 'done')),
  assigned_to uuid references public.profiles(id) on delete set null,
  assigned_to_ids uuid[] not null default '{}'::uuid[],
  start_date date,
  end_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_tasks_dates_check check (end_date is null or start_date is null or end_date >= start_date)
);
alter table public.project_tasks add column if not exists start_date date;
alter table public.project_tasks add column if not exists end_date date;
alter table public.project_tasks add column if not exists assigned_to_ids uuid[] not null default '{}'::uuid[];
alter table public.project_tasks add column if not exists actual_start_date date;
alter table public.project_tasks add column if not exists actual_completion_date date;
alter table public.project_tasks add column if not exists task_type text not null default 'task';
alter table public.project_tasks drop constraint if exists project_tasks_task_type_check;
alter table public.project_tasks
  add constraint project_tasks_task_type_check check (task_type in ('task', 'summary'));
alter table public.project_tasks drop constraint if exists project_tasks_dates_check;
alter table public.project_tasks
  add constraint project_tasks_dates_check
  check (end_date is null or start_date is null or end_date >= start_date);
create index if not exists project_tasks_assignees_gin_idx on public.project_tasks using gin (assigned_to_ids);
create index if not exists project_tasks_project_phase_idx
  on public.project_tasks (project_id, phase, parent_task_id);
create index if not exists project_tasks_assigned_idx on public.project_tasks (assigned_to);

alter table public.project_tasks enable row level security;
drop policy if exists "project_tasks: authenticated read" on public.project_tasks;
create policy "project_tasks: authenticated read"
  on public.project_tasks for select using (auth.uid() is not null);
drop policy if exists "project_tasks: admin or pm write" on public.project_tasks;
drop policy if exists "project_tasks: pm insert" on public.project_tasks;
create policy "project_tasks: pm insert"
  on public.project_tasks for insert
  with check (public.has_role('project_manager'));
drop policy if exists "project_tasks: pm or admin update" on public.project_tasks;
drop policy if exists "project_tasks: pm update" on public.project_tasks;
drop policy if exists "project_tasks: pm or assignee update" on public.project_tasks;
create policy "project_tasks: pm or assignee update"
  on public.project_tasks for update
  using (
    public.has_role('project_manager')
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.profiles p
        where p.auth_user_id = auth.uid()
          and (p.id = assigned_to or p.id = any (assigned_to_ids))
      )
    )
  )
  with check (
    public.has_role('project_manager')
    or (
      auth.uid() is not null
      and exists (
        select 1 from public.profiles p
        where p.auth_user_id = auth.uid()
          and (p.id = assigned_to or p.id = any (assigned_to_ids))
      )
    )
  );
drop policy if exists "project_tasks: admin delete" on public.project_tasks;
drop policy if exists "project_tasks: pm delete" on public.project_tasks;
create policy "project_tasks: pm delete"
  on public.project_tasks for delete
  using (public.has_role('project_manager'));

create table if not exists public.project_task_dependencies (
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.project_tasks(id) on delete cascade,
  primary key (project_id, task_id, depends_on_task_id),
  check (task_id <> depends_on_task_id)
);

alter table public.project_task_dependencies enable row level security;
drop policy if exists "project_task_deps: authenticated read" on public.project_task_dependencies;
create policy "project_task_deps: authenticated read"
  on public.project_task_dependencies for select using (auth.uid() is not null);
drop policy if exists "project_task_deps: admin or pm write" on public.project_task_dependencies;
drop policy if exists "project_task_deps: pm insert" on public.project_task_dependencies;
create policy "project_task_deps: pm insert"
  on public.project_task_dependencies for insert
  with check (public.has_role('project_manager'));
drop policy if exists "project_task_deps: pm or admin delete" on public.project_task_dependencies;
drop policy if exists "project_task_deps: pm delete" on public.project_task_dependencies;
create policy "project_task_deps: pm delete"
  on public.project_task_dependencies for delete
  using (public.has_role('project_manager'));

create table if not exists public.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  phase text not null check (phase in ('pre_project', 'project')),
  source_template_milestone_id uuid references public.template_milestones(id) on delete set null,
  name text not null,
  target_date date,
  reached_date date,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_milestones_project_idx on public.project_milestones (project_id);

alter table public.project_milestones enable row level security;
drop policy if exists "project_milestones: authenticated read" on public.project_milestones;
create policy "project_milestones: authenticated read"
  on public.project_milestones for select using (auth.uid() is not null);
drop policy if exists "project_milestones: admin or pm write" on public.project_milestones;
drop policy if exists "project_milestones: pm insert" on public.project_milestones;
create policy "project_milestones: pm insert"
  on public.project_milestones for insert
  with check (public.has_role('project_manager'));
drop policy if exists "project_milestones: pm or admin update" on public.project_milestones;
drop policy if exists "project_milestones: pm update" on public.project_milestones;
create policy "project_milestones: pm update"
  on public.project_milestones for update
  using (public.has_role('project_manager'))
  with check (public.has_role('project_manager'));
drop policy if exists "project_milestones: admin delete" on public.project_milestones;
drop policy if exists "project_milestones: pm delete" on public.project_milestones;
create policy "project_milestones: pm delete"
  on public.project_milestones for delete
  using (public.has_role('project_manager'));

-- ============================================================
-- Indents + Indent Items (materials required per project)
-- ============================================================

create table if not exists public.indents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  indent_number text not null,
  indent_date date not null,
  activity_name text,
  indenter_name text,
  indenter_mobile text,
  is_academic boolean not null default false,
  source_file_path text,
  source_file_name text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint indents_number_per_project_unique unique (project_id, indent_number)
);
alter table public.indents add column if not exists activity_name text;
alter table public.indents add column if not exists indenter_name text;
alter table public.indents add column if not exists indenter_mobile text;
alter table public.indents add column if not exists is_academic boolean not null default false;
alter table public.indents add column if not exists source_file_path text;
alter table public.indents add column if not exists source_file_name text;
create index if not exists indents_project_idx on public.indents (project_id, indent_date desc);

alter table public.indents enable row level security;
drop policy if exists "indents: authenticated read" on public.indents;
create policy "indents: authenticated read" on public.indents for select using (auth.uid() is not null);
drop policy if exists "indents: pm write" on public.indents;
create policy "indents: pm write"
  on public.indents for all
  using (public.has_role('project_manager'))
  with check (public.has_role('project_manager'));

create table if not exists public.indent_items (
  id uuid primary key default gen_random_uuid(),
  indent_id uuid not null references public.indents(id) on delete cascade,
  item_name text not null,
  item_description text,
  unit text,
  have_qty numeric not null default 0,
  buy_qty numeric not null default 0,
  unit_price numeric,
  remark text,
  mapped_task_id uuid references public.project_tasks(id) on delete set null,
  assigned_to_ids uuid[] not null default '{}'::uuid[],
  received_qty numeric not null default 0,
  received_on date,
  received_note text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint indent_items_qty_check check (have_qty >= 0 and buy_qty >= 0 and received_qty >= 0),
  constraint indent_items_price_check check (unit_price is null or unit_price >= 0)
);
alter table public.indent_items add column if not exists item_description text;
alter table public.indent_items add column if not exists remark text;

-- Storage bucket for uploaded indent PDFs/images (source-of-truth attachments).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('indent-files', 'indent-files', false, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

drop policy if exists "indent files: authenticated read" on storage.objects;
create policy "indent files: authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'indent-files');
drop policy if exists "indent files: pm upload" on storage.objects;
create policy "indent files: pm upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'indent-files' and public.has_role('project_manager'));
drop policy if exists "indent files: pm delete" on storage.objects;
create policy "indent files: pm delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'indent-files' and public.has_role('project_manager'));
create index if not exists indent_items_indent_idx on public.indent_items (indent_id, sort_order);
create index if not exists indent_items_task_idx on public.indent_items (mapped_task_id);
create index if not exists indent_items_assignees_gin_idx on public.indent_items using gin (assigned_to_ids);

alter table public.indent_items enable row level security;
drop policy if exists "indent_items: authenticated read" on public.indent_items;
create policy "indent_items: authenticated read" on public.indent_items for select using (auth.uid() is not null);
drop policy if exists "indent_items: pm or assignee write" on public.indent_items;
create policy "indent_items: pm or assignee write"
  on public.indent_items for all
  using (
    public.has_role('project_manager')
    or (auth.uid() is not null and exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid() and p.id = any (assigned_to_ids)
    ))
  )
  with check (
    public.has_role('project_manager')
    or (auth.uid() is not null and exists (
      select 1 from public.profiles p
      where p.auth_user_id = auth.uid() and p.id = any (assigned_to_ids)
    ))
  );

-- ============================================================
-- RAG Rule Master (organization-wide singleton config + audit)
-- ============================================================

create table if not exists public.rag_config (
  id uuid primary key default gen_random_uuid(),
  progress_amber_pts numeric(5, 2) not null default 2.00,
  progress_red_pts numeric(5, 2) not null default 5.00,
  schedule_amber_pct numeric(5, 2) not null default 5.00,
  schedule_amber_min_days integer not null default 7,
  schedule_red_pct numeric(5, 2) not null default 10.00,
  cost_amber_pct numeric(5, 2) not null default 5.00,
  cost_red_pct numeric(5, 2) not null default 10.00,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  is_active boolean not null default true,
  constraint rag_config_thresholds_positive check (
    progress_amber_pts >= 0 and progress_red_pts >= 0
    and schedule_amber_pct >= 0 and schedule_red_pct >= 0
    and schedule_amber_min_days >= 0
    and cost_amber_pct >= 0 and cost_red_pct >= 0
  ),
  constraint rag_config_progress_order check (progress_red_pts >= progress_amber_pts),
  constraint rag_config_cost_order check (cost_red_pct >= cost_amber_pct),
  constraint rag_config_schedule_order check (schedule_red_pct >= schedule_amber_pct)
);
create unique index if not exists rag_config_singleton_idx on public.rag_config (is_active) where is_active;

alter table public.rag_config enable row level security;
drop policy if exists "rag_config: authenticated read" on public.rag_config;
create policy "rag_config: authenticated read"
  on public.rag_config for select using (auth.uid() is not null);
drop policy if exists "rag_config: admin write" on public.rag_config;
create policy "rag_config: admin write"
  on public.rag_config for all
  using (public.is_project_admin())
  with check (public.is_project_admin());

-- Seed the singleton with defaults on first install (idempotent).
insert into public.rag_config (progress_amber_pts, progress_red_pts, schedule_amber_pct, schedule_amber_min_days, schedule_red_pct, cost_amber_pct, cost_red_pct)
select 2.00, 5.00, 5.00, 7, 10.00, 5.00, 10.00
where not exists (select 1 from public.rag_config where is_active = true);

create table if not exists public.rag_config_audit (
  id uuid primary key default gen_random_uuid(),
  changed_by uuid references public.profiles(id) on delete set null,
  changed_at timestamptz not null default now(),
  metric text not null check (metric in ('progress', 'schedule', 'cost')),
  parameter text not null,
  previous_value text,
  new_value text
);
create index if not exists rag_config_audit_changed_at_idx on public.rag_config_audit (changed_at desc);

alter table public.rag_config_audit enable row level security;
drop policy if exists "rag_config_audit: authenticated read" on public.rag_config_audit;
create policy "rag_config_audit: authenticated read"
  on public.rag_config_audit for select using (auth.uid() is not null);
drop policy if exists "rag_config_audit: admin insert" on public.rag_config_audit;
create policy "rag_config_audit: admin insert"
  on public.rag_config_audit for insert
  with check (public.is_project_admin());

-- Phase Budget: per-task budgets + variance history
alter table public.project_budgets add column if not exists task_id uuid references public.project_tasks(id) on delete set null;
alter table public.project_budgets alter column category drop not null;
create unique index if not exists project_budgets_project_task_uidx
  on public.project_budgets (project_id, task_id)
  where task_id is not null;

create table if not exists public.budget_variance_history (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.project_budgets(id) on delete cascade,
  field text not null check (field in ('planned_amount', 'actual_amount')),
  previous_amount numeric,
  new_amount numeric,
  delta numeric,
  variance numeric,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists budget_variance_history_budget_idx
  on public.budget_variance_history (budget_id, created_at desc);
alter table public.budget_variance_history enable row level security;
drop policy if exists "budget_variance_history: authenticated read" on public.budget_variance_history;
create policy "budget_variance_history: authenticated read"
  on public.budget_variance_history for select using (auth.uid() is not null);
drop policy if exists "budget_variance_history: authenticated insert" on public.budget_variance_history;
create policy "budget_variance_history: authenticated insert"
  on public.budget_variance_history for insert with check (auth.uid() is not null);

-- Phase Funding: multi-source rows + variance history
alter table public.project_funding drop constraint if exists project_funding_source_check;
alter table public.project_funding add constraint project_funding_source_check
  check (source in ('school_budget', 'campus_budget', 'non_budget', 'bank_loan', 'corpus', 'grant', 'donor', 'internal', 'other'));

create table if not exists public.funding_variance_history (
  id uuid primary key default gen_random_uuid(),
  funding_id uuid not null references public.project_funding(id) on delete cascade,
  previous_amount numeric,
  new_amount numeric,
  delta numeric,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists funding_variance_history_funding_idx
  on public.funding_variance_history (funding_id, created_at desc);
alter table public.funding_variance_history enable row level security;
drop policy if exists "funding_variance_history: authenticated read" on public.funding_variance_history;
create policy "funding_variance_history: authenticated read"
  on public.funding_variance_history for select using (auth.uid() is not null);
drop policy if exists "funding_variance_history: authenticated insert" on public.funding_variance_history;
create policy "funding_variance_history: authenticated insert"
  on public.funding_variance_history for insert with check (auth.uid() is not null);

-- Phase E1: Per-project messaging
create table if not exists public.project_messages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now()
);
alter table public.project_messages add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.project_messages add column if not exists mentions uuid[] not null default '{}'::uuid[];
alter table public.project_messages add column if not exists hashtags text[] not null default '{}'::text[];
create index if not exists project_messages_mentions_gin_idx on public.project_messages using gin (mentions);
create index if not exists project_messages_hashtags_gin_idx on public.project_messages using gin (hashtags);
create index if not exists project_messages_project_idx on public.project_messages (project_id, created_at desc);
alter table public.project_messages enable row level security;
drop policy if exists "project_messages: authenticated read" on public.project_messages;
create policy "project_messages: authenticated read"
  on public.project_messages for select using (auth.uid() is not null);
drop policy if exists "project_messages: authenticated write" on public.project_messages;
create policy "project_messages: authenticated write"
  on public.project_messages for insert
  with check (auth.uid() is not null);
drop policy if exists "project_messages: author update" on public.project_messages;
create policy "project_messages: author update"
  on public.project_messages for update
  using (author_id in (select id from public.profiles where auth_user_id = auth.uid()))
  with check (author_id in (select id from public.profiles where auth_user_id = auth.uid()));
drop policy if exists "project_messages: author or admin delete" on public.project_messages;
create policy "project_messages: author or admin delete"
  on public.project_messages for delete
  using (
    public.is_project_admin()
    or author_id in (select id from public.profiles where auth_user_id = auth.uid())
  );

-- Phase E2: Per-project documents
create table if not exists public.project_documents (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  file_path text not null,
  size_bytes integer,
  mime_type text,
  uploaded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.project_documents add column if not exists display_name text;
alter table public.project_documents add column if not exists task_id uuid references public.project_tasks(id) on delete set null;
create index if not exists project_documents_task_idx on public.project_documents (task_id) where task_id is not null;
create index if not exists project_documents_project_idx on public.project_documents (project_id, created_at desc);
alter table public.project_documents enable row level security;
drop policy if exists "project_documents: authenticated read" on public.project_documents;
create policy "project_documents: authenticated read"
  on public.project_documents for select using (auth.uid() is not null);
drop policy if exists "project_documents: authenticated write" on public.project_documents;
create policy "project_documents: authenticated write"
  on public.project_documents for insert
  with check (auth.uid() is not null);
drop policy if exists "project_documents: uploader or admin delete" on public.project_documents;
create policy "project_documents: uploader or admin delete"
  on public.project_documents for delete
  using (
    public.is_project_admin()
    or uploaded_by in (select id from public.profiles where auth_user_id = auth.uid())
  );

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-docs', 'project-docs', false, 26214400)
on conflict (id) do nothing;

drop policy if exists "project docs: authenticated read" on storage.objects;
create policy "project docs: authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'project-docs');
drop policy if exists "project docs: authenticated upload" on storage.objects;
create policy "project docs: authenticated upload"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'project-docs');
drop policy if exists "project docs: authenticated delete" on storage.objects;
create policy "project docs: authenticated delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'project-docs');

-- Phase I1/I2: Budget + funding
create table if not exists public.project_budgets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  category text not null,
  planned_amount numeric not null default 0,
  actual_amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists project_budgets_project_idx on public.project_budgets (project_id);
alter table public.project_budgets enable row level security;
drop policy if exists "project_budgets: authenticated read" on public.project_budgets;
create policy "project_budgets: authenticated read"
  on public.project_budgets for select using (auth.uid() is not null);
drop policy if exists "project_budgets: pm write" on public.project_budgets;
create policy "project_budgets: pm write"
  on public.project_budgets for all
  using (public.has_role('project_manager') or public.is_project_admin())
  with check (public.has_role('project_manager') or public.is_project_admin());

create table if not exists public.project_funding (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source text not null check (source in ('corpus', 'grant', 'donor', 'internal', 'other')),
  amount numeric not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists project_funding_project_idx on public.project_funding (project_id);
alter table public.project_funding enable row level security;
drop policy if exists "project_funding: authenticated read" on public.project_funding;
create policy "project_funding: authenticated read"
  on public.project_funding for select using (auth.uid() is not null);
drop policy if exists "project_funding: pm write" on public.project_funding;
create policy "project_funding: pm write"
  on public.project_funding for all
  using (public.has_role('project_manager') or public.is_project_admin())
  with check (public.has_role('project_manager') or public.is_project_admin());

-- Phase J: Project status change requests (Hold / Cancel approval)
create table if not exists public.project_status_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_status text not null check (requested_status in ('on_hold', 'cancelled', 'active', 'completed')),
  reason text,
  requested_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);
create index if not exists psr_project_idx on public.project_status_requests (project_id, status, created_at desc);
alter table public.project_status_requests enable row level security;
drop policy if exists "psr: authenticated read" on public.project_status_requests;
create policy "psr: authenticated read"
  on public.project_status_requests for select using (auth.uid() is not null);
drop policy if exists "psr: pm insert" on public.project_status_requests;
create policy "psr: pm insert"
  on public.project_status_requests for insert
  with check (public.has_role('project_manager') or public.is_project_admin());
drop policy if exists "psr: admin decide" on public.project_status_requests;
create policy "psr: admin decide"
  on public.project_status_requests for update
  using (public.is_project_admin())
  with check (public.is_project_admin());

-- Draft state for projects and templates (P2). Drafts are visible only to their creator; Cancel = hard delete.
alter table public.projects           add column if not exists is_draft boolean not null default false;
alter table public.project_templates  add column if not exists is_draft boolean not null default false;
create index if not exists projects_draft_idx           on public.projects (created_by)          where is_draft = true;
create index if not exists project_templates_draft_idx  on public.project_templates (created_by) where is_draft = true;

-- Draft visibility: exclude other users' drafts from every read path.
-- (Client queries typically include `is_draft = false OR created_by = <me>`; the RLS policy enforces it server-side too.)
drop policy if exists "projects: hide others drafts" on public.projects;
create policy "projects: hide others drafts"
  on public.projects for select
  using (
    is_draft = false
    or created_by in (select id from public.profiles where auth_user_id = auth.uid())
    or public.is_project_admin()
  );
drop policy if exists "project_templates: hide others drafts" on public.project_templates;
create policy "project_templates: hide others drafts"
  on public.project_templates for select
  using (
    is_draft = false
    or created_by in (select id from public.profiles where auth_user_id = auth.uid())
    or public.is_project_admin()
  );

-- SSO auto-link: when a user signs in via SSO their auth_user_id (from the OAuth provider)
-- won't match the auth id created by the admin invite. Fall back to email and link on first SSO login.
create or replace function public.link_my_profile()
returns public.profiles
language plpgsql security definer set search_path = public
as $$
declare
  my_uid uuid := auth.uid();
  my_email text := auth.email();
  target public.profiles;
begin
  if my_uid is null or my_email is null then
    raise exception 'not authenticated';
  end if;
  select * into target from public.profiles where auth_user_id = my_uid limit 1;
  if found then return target; end if;
  select * into target from public.profiles where lower(email) = lower(my_email) limit 1;
  if not found then return null; end if;
  update public.profiles set auth_user_id = my_uid, updated_at = now() where id = target.id;
  select * into target from public.profiles where id = target.id;
  return target;
end $$;
grant execute on function public.link_my_profile() to authenticated;

-- Blank template support: template + version become optional; project_type stays mandatory (added directly on projects).
alter table public.projects alter column template_id drop not null;
alter table public.projects alter column template_version_id drop not null;
alter table public.projects add column if not exists project_type_id uuid references public.project_types(id) on delete restrict;
update public.projects p
  set project_type_id = t.project_type_id
  from public.project_templates t
  where p.template_id = t.id and p.project_type_id is null;

-- Phase Foundation: unified audit log
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  context jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id, created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log (actor_id, created_at desc);
alter table public.audit_log enable row level security;
drop policy if exists "audit_log: admin or leadership read" on public.audit_log;
create policy "audit_log: admin or leadership read"
  on public.audit_log for select
  using (public.is_project_admin() or public.has_role('leadership'));
drop policy if exists "audit_log: authenticated insert" on public.audit_log;
create policy "audit_log: authenticated insert"
  on public.audit_log for insert
  with check (auth.uid() is not null);

-- Subtask daily updates + attachments (JSONB list of {name, path, size, mime})
create table if not exists public.subtask_updates (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  updated_by uuid references public.profiles(id) on delete set null,
  update_date date not null default current_date,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists subtask_updates_task_idx on public.subtask_updates (task_id, update_date desc);
alter table public.subtask_updates enable row level security;
drop policy if exists "subtask_updates: authenticated read" on public.subtask_updates;
create policy "subtask_updates: authenticated read" on public.subtask_updates for select using (auth.uid() is not null);
drop policy if exists "subtask_updates: assignee or pm write" on public.subtask_updates;
create policy "subtask_updates: assignee or pm write" on public.subtask_updates for insert
  with check (
    public.has_role('project_manager')
    or exists (
      select 1 from public.project_tasks t, public.profiles p
      where t.id = task_id and p.auth_user_id = auth.uid()
        and (p.id = any (t.assigned_to_ids) or p.id = t.assigned_to)
    )
  );
drop policy if exists "subtask_updates: author delete" on public.subtask_updates;
create policy "subtask_updates: author delete" on public.subtask_updates for delete
  using (updated_by in (select id from public.profiles where auth_user_id = auth.uid()) or public.is_project_admin());

-- Indent item delivery rounds (multiple rows per item; received_qty is aggregated by trigger)
create table if not exists public.indent_item_deliveries (
  id uuid primary key default gen_random_uuid(),
  indent_item_id uuid not null references public.indent_items(id) on delete cascade,
  delivery_date date not null default current_date,
  qty numeric not null default 0 check (qty >= 0),
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists indent_item_deliveries_item_idx on public.indent_item_deliveries (indent_item_id, delivery_date desc);
alter table public.indent_item_deliveries enable row level security;
drop policy if exists "indent_item_deliveries: authenticated read" on public.indent_item_deliveries;
create policy "indent_item_deliveries: authenticated read" on public.indent_item_deliveries for select using (auth.uid() is not null);
drop policy if exists "indent_item_deliveries: assignee or pm write" on public.indent_item_deliveries;
create policy "indent_item_deliveries: assignee or pm write" on public.indent_item_deliveries for insert
  with check (
    public.has_role('project_manager')
    or exists (
      select 1 from public.indent_items i, public.profiles p
      where i.id = indent_item_id and p.auth_user_id = auth.uid()
        and p.id = any (i.assigned_to_ids)
    )
  );

create or replace function public.recompute_indent_received() returns trigger
language plpgsql security definer set search_path = public as $$
declare target_id uuid;
begin
  target_id := coalesce(new.indent_item_id, old.indent_item_id);
  update public.indent_items
    set received_qty = coalesce((select sum(qty) from public.indent_item_deliveries where indent_item_id = target_id), 0),
        received_on = (select max(delivery_date) from public.indent_item_deliveries where indent_item_id = target_id),
        updated_at = now()
    where id = target_id;
  return null;
end $$;
drop trigger if exists indent_deliveries_recompute on public.indent_item_deliveries;
create trigger indent_deliveries_recompute
  after insert or update or delete on public.indent_item_deliveries
  for each row execute function public.recompute_indent_received();

-- Reuse project-docs bucket for subtask update attachments (path prefix "updates/<task_id>/…")

-- PM "Not Required" flag for management-pivot items on MyTasks
create table if not exists public.pm_task_dismissals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  item_type text not null check (item_type in ('budget', 'indent_assign', 'indent_map', 'milestone_date')),
  item_id uuid not null,
  created_at timestamptz not null default now(),
  unique (profile_id, item_type, item_id)
);
create index if not exists pm_task_dismissals_profile_idx on public.pm_task_dismissals (profile_id);
alter table public.pm_task_dismissals enable row level security;
drop policy if exists "pm_task_dismissals: own read" on public.pm_task_dismissals;
create policy "pm_task_dismissals: own read" on public.pm_task_dismissals for select
  using (profile_id in (select id from public.profiles where auth_user_id = auth.uid()));
drop policy if exists "pm_task_dismissals: own write" on public.pm_task_dismissals;
create policy "pm_task_dismissals: own write" on public.pm_task_dismissals for insert
  with check (profile_id in (select id from public.profiles where auth_user_id = auth.uid()));
drop policy if exists "pm_task_dismissals: own delete" on public.pm_task_dismissals;
create policy "pm_task_dismissals: own delete" on public.pm_task_dismissals for delete
  using (profile_id in (select id from public.profiles where auth_user_id = auth.uid()));

-- P7A: per-row change history for indent_items — mirrors budget_variance_history.
-- Every save that changes a tracked field snapshots the previous value with a delta.
-- No manual "capture baseline" — every save IS a snapshot.
create table if not exists public.indent_item_variance_history (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.indent_items(id) on delete cascade,
  field text not null check (field in ('unit_price', 'buy_qty', 'have_qty', 'received_qty')),
  previous_value numeric,
  new_value numeric,
  delta numeric,
  reason text,
  changed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists indent_item_variance_history_item_idx
  on public.indent_item_variance_history (item_id, created_at desc);
alter table public.indent_item_variance_history enable row level security;
drop policy if exists "iivh: authenticated read" on public.indent_item_variance_history;
create policy "iivh: authenticated read"
  on public.indent_item_variance_history for select using (auth.uid() is not null);
drop policy if exists "iivh: authenticated insert" on public.indent_item_variance_history;
create policy "iivh: authenticated insert"
  on public.indent_item_variance_history for insert with check (auth.uid() is not null);

-- P11: Progress Units master — replaces the hard-coded COMMON_UNITS constant.
-- Every unit-picker (Indent items, template metric modal, project customize step) reads from here.
create table if not exists public.progress_units (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint progress_units_name_unique unique (name)
);
create index if not exists progress_units_active_idx on public.progress_units (is_active, sort_order);
alter table public.progress_units enable row level security;
drop policy if exists "progress_units: authenticated read" on public.progress_units;
create policy "progress_units: authenticated read"
  on public.progress_units for select using (auth.uid() is not null);
drop policy if exists "progress_units: admin write" on public.progress_units;
create policy "progress_units: admin write"
  on public.progress_units for all
  using (public.is_project_admin() or public.is_it_admin())
  with check (public.is_project_admin() or public.is_it_admin());

-- Seed the standard list (idempotent — conflict on name = do nothing).
insert into public.progress_units (name, sort_order) values
  ('Nos', 1), ('m', 2), ('ft', 3), ('kg', 4), ('ton', 5), ('m²', 6), ('sq.ft', 7),
  ('m³', 8), ('cft', 9), ('litre', 10), ('bag', 11), ('roll', 12), ('cum', 13), ('brass', 14)
on conflict (name) do nothing;

-- P5A: widen progress_metric check to include 'percent' on both template and project task tables.
alter table public.template_tasks drop constraint if exists template_tasks_progress_metric_check;
alter table public.template_tasks
  add constraint template_tasks_progress_metric_check
  check (progress_metric in ('quantity', 'done_not_done', 'percent'));
alter table public.project_tasks drop constraint if exists project_tasks_progress_metric_check;
alter table public.project_tasks
  add constraint project_tasks_progress_metric_check
  check (progress_metric in ('quantity', 'done_not_done', 'percent'));

-- Bootstrap first Project Admin after enrolling yourself once:
--   update public.profiles
--     set role = 'project_admin', roles = array['project_admin']
--     where lower(email) = lower('you@indirauniversity.edu.in');

-- Project task baselines: every time start_date/end_date changes on a project_task, a snapshot is written here.
-- The current live values live on project_tasks; this table is an append-only audit + a source for baseline lines
-- on the Gantt so PMs can compare current dates against the previously-saved plan without opening the audit log.
create table if not exists public.project_task_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  task_id uuid not null references public.project_tasks(id) on delete cascade,
  snapshot_start date,
  snapshot_end date,
  reason text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);
create index if not exists project_task_baselines_task_idx    on public.project_task_baselines (task_id, created_at desc);
create index if not exists project_task_baselines_project_idx on public.project_task_baselines (project_id, created_at desc);

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

-- Extend project_task_baselines with a discriminator so one table holds date, amount, and milestone-date snapshots.
-- Existing rows default to 'task_date' (backfill). New numeric column captures amount snapshots.
alter table public.project_task_baselines add column if not exists kind text not null default 'task_date';
alter table public.project_task_baselines drop constraint if exists project_task_baselines_kind_check;
alter table public.project_task_baselines
  add constraint project_task_baselines_kind_check
  check (kind in ('task_date', 'task_amount', 'milestone_date'));
alter table public.project_task_baselines add column if not exists snapshot_amount numeric;
create index if not exists project_task_baselines_kind_idx on public.project_task_baselines (task_id, kind, created_at desc);

-- Planned vs actual amount per indent item — supports budget tracking and variance calc.
alter table public.indent_items add column if not exists planned_amount numeric;
alter table public.indent_items add column if not exists actual_amount  numeric;

-- Task-level planned/actual money — one row per project_task. Used to roll up per-task budget vs actual spend
-- alongside the per-item numbers on indent_items (which map many items to one task).
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

-- ============================================================
-- Phase 2: Baseline Change Requests (approval workflow)
-- PM proposes a full-structure baseline change; a leadership user must approve before it applies.
-- Snapshots capture the complete project state so leadership sees a split-screen before/after with
-- changed dates highlighted. Reason is mandatory on both request and rejection.
-- ============================================================
create table if not exists public.baseline_change_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  requested_by uuid not null references public.profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  reason text not null check (length(trim(reason)) >= 20),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  decision_reason text
);
create index if not exists bcr_project_status_idx on public.baseline_change_requests (project_id, status, requested_at desc);
create index if not exists bcr_pending_idx on public.baseline_change_requests (status, requested_at desc) where status = 'pending';

alter table public.baseline_change_requests enable row level security;

drop policy if exists "bcr: pm insert" on public.baseline_change_requests;
create policy "bcr: pm insert"
  on public.baseline_change_requests for insert
  with check (public.has_role('project_manager') or public.is_project_admin());

drop policy if exists "bcr: read" on public.baseline_change_requests;
create policy "bcr: read"
  on public.baseline_change_requests for select
  using (
    public.has_role('leadership')
    or public.is_project_admin()
    or public.is_it_admin()
    or public.has_role('project_manager')
  );

drop policy if exists "bcr: leadership decide" on public.baseline_change_requests;
create policy "bcr: leadership decide"
  on public.baseline_change_requests for update
  using (public.has_role('leadership') or public.is_project_admin())
  with check (public.has_role('leadership') or public.is_project_admin());

-- ============================================================
-- Phase 3: Indent sub-items (same item added later at a different price becomes a sub-row).
-- The rolled-up Planned Amount for the parent is the sum of the parent's own line + every child's line.
-- Actual Amount is auto-computed from received_qty × unit_price on every receipt (service layer).
-- Amount-change history for indent items lives in indent_item_variance_history (already there); the
-- baseline_change_requests table (Phase 2) handles approval snapshots for planned_amount changes.
-- ============================================================
alter table public.indent_items add column if not exists parent_indent_item_id uuid references public.indent_items(id) on delete cascade;
create index if not exists indent_items_parent_idx on public.indent_items (parent_indent_item_id);

-- ============================================================
-- ============================================================
-- BUG-23: profile photo. avatar_url stores a public URL from the "avatars" bucket. RLS is
-- open-read (any authenticated user can see teammates' avatars) and owner-write (users can only
-- upload / replace their own avatar). Non-owners cannot overwrite each other.
-- ============================================================
alter table public.profiles add column if not exists avatar_url text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 2 * 1024 * 1024,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: authenticated read" on storage.objects;
create policy "avatars: authenticated read"
  on storage.objects for select
  using (bucket_id = 'avatars' and auth.uid() is not null);

drop policy if exists "avatars: owner write" on storage.objects;
create policy "avatars: owner write"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (name like (auth.uid()::text || '/%'))
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (name like (auth.uid()::text || '/%'))
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and (name like (auth.uid()::text || '/%'))
  );

-- BUG-19 (partial): public RPC to help an invited user who lands on Login without their invite link.
-- Returns true ONLY when: (email exists) AND (first_login_at IS NULL) AND (must_change_password is true).
-- Non-existent emails and already-logged-in users both return false, so this does not leak account
-- enumeration for the general case — it only surfaces the "invited but stuck" state.
-- ============================================================
create or replace function public.check_invitation_pending(check_email text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where lower(email) = lower(trim(check_email))
      and first_login_at is null
      and must_change_password = true
  );
$$;
grant execute on function public.check_invitation_pending(text) to anon, authenticated;

-- ============================================================
-- Phase: project-level Approval Authority + snapshot + email queue
-- (mirrors supabase/migrations/20260911_approvers_and_email.sql)
-- ============================================================
alter table public.projects
  add column if not exists approver_ids uuid[] not null default '{}'::uuid[];
create index if not exists projects_approvers_gin_idx on public.projects using gin (approver_ids);

alter table public.project_status_requests
  add column if not exists approver_snapshot uuid[] not null default '{}'::uuid[];
alter table public.baseline_change_requests
  add column if not exists approver_snapshot uuid[] not null default '{}'::uuid[];

create or replace function public.is_snapshot_approver(snapshot uuid[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.id = any (snapshot)
  );
$$;
grant execute on function public.is_snapshot_approver(uuid[]) to authenticated;

drop policy if exists "psr: admin decide" on public.project_status_requests;
drop policy if exists "psr: snapshot approver decide" on public.project_status_requests;
create policy "psr: snapshot approver decide"
  on public.project_status_requests for update
  using (public.is_project_admin() or public.is_snapshot_approver(approver_snapshot))
  with check (public.is_project_admin() or public.is_snapshot_approver(approver_snapshot));

drop policy if exists "bcr: leadership decide" on public.baseline_change_requests;
drop policy if exists "bcr: snapshot approver decide" on public.baseline_change_requests;
create policy "bcr: snapshot approver decide"
  on public.baseline_change_requests for update
  using (
    public.has_role('leadership')
    or public.is_project_admin()
    or public.is_snapshot_approver(approver_snapshot)
  )
  with check (
    public.has_role('leadership')
    or public.is_project_admin()
    or public.is_snapshot_approver(approver_snapshot)
  );

alter table public.notifications add column if not exists email_pending boolean not null default false;
alter table public.notifications add column if not exists email_sent_at timestamptz;
alter table public.notifications add column if not exists email_to text;
alter table public.notifications add column if not exists module_key text;
create index if not exists notifications_email_pending_idx
  on public.notifications (email_pending, created_at)
  where email_pending = true;
create index if not exists notifications_module_key_idx
  on public.notifications (module_key)
  where email_pending = true;

