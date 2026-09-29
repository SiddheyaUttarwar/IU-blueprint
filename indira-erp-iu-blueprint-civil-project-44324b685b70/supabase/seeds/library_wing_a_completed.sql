-- ============================================================================
-- Dummy completed-project scenario: "Library - New Wing A"
--
-- Self-contained: applies the required schema delta (baseline kind, indent
-- amount cols, project_task_amounts table) BEFORE seeding so it works without
-- having to run the full schema.sql first.
--
-- Populates:
--   * RAG rule ("Standard Delivery") and attaches to the project.
--   * Project marked completed with realistic actual_start/end dates.
--   * All project_tasks marked done with actual dates + actual_value.
--   * project_task_baselines seeded with initial_plan (task_date), two mid-project
--     date-shift snapshots on the first three root tasks with real reasons,
--     and one task_amount baseline per root task.
--   * project_task_amounts (planned + actual) for every root task.
--   * One indent with 5 fully-received items (planned_amount + actual_amount).
--   * 4 project messages · 3 project_documents metadata rows · milestones marked reached.
--
-- Prerequisite:
--   * The project "Library - New Wing A" must already exist (created via the
--     PM Create-Project flow), otherwise the DO block returns early with a NOTICE.
--
-- Re-runnable: deletes prior seed rows before inserting so running it multiple
-- times leaves the same end state.
-- ============================================================================

-- ---------- Schema delta (safe on repeat) ----------
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

alter table public.project_task_baselines add column if not exists kind text not null default 'task_date';
alter table public.project_task_baselines drop constraint if exists project_task_baselines_kind_check;
alter table public.project_task_baselines
  add constraint project_task_baselines_kind_check
  check (kind in ('task_date', 'task_amount', 'milestone_date'));
alter table public.project_task_baselines add column if not exists snapshot_amount numeric;
create index if not exists project_task_baselines_kind_idx on public.project_task_baselines (task_id, kind, created_at desc);

alter table public.project_task_baselines add column if not exists milestone_id uuid references public.project_milestones(id) on delete cascade;
alter table public.project_task_baselines alter column task_id drop not null;
alter table public.project_task_baselines drop constraint if exists project_task_baselines_target_check;
alter table public.project_task_baselines
  add constraint project_task_baselines_target_check
  check ((task_id is not null) <> (milestone_id is not null));
create index if not exists project_task_baselines_milestone_idx on public.project_task_baselines (milestone_id, created_at desc) where milestone_id is not null;

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

alter table public.indent_items add column if not exists planned_amount numeric;
alter table public.indent_items add column if not exists actual_amount  numeric;

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

-- ---------- Seed data ----------
do $$
declare
  proj_id  uuid;
  pm_id    uuid;
  rag_id   uuid;
  ind_id   uuid;
  now_ts   timestamptz := now();
  actual_start date := current_date - interval '120 days';
  actual_end   date := current_date - interval '10 days';
  seed_ts_early timestamptz := now() - interval '150 days';
  seed_ts_mid   timestamptz := now() -  interval '80 days';
begin
  -- 1. Locate the project + its PM.
  select p.id, p.project_manager_id
    into proj_id, pm_id
    from public.projects p
   where lower(p.name) = lower('Library - New Wing A')
   limit 1;

  if proj_id is null then
    raise notice 'Seed skipped: project "Library - New Wing A" not found. Create it first via the UI.';
    return;
  end if;

  -- 2. Upsert the dummy RAG rule and attach to the project.
  insert into public.rag_rules (name, description, green_min_pct, amber_min_pct, is_active)
  values ('Standard Delivery',
          'Default civil-project rule: Green ≥ 80%, Amber ≥ 60%, else Red.',
          80, 60, true)
     on conflict (name) do update set description = excluded.description, updated_at = now()
  returning id into rag_id;

  update public.projects
     set rag_rule_id = rag_id,
         actual_start_date = actual_start,
         actual_end_date   = actual_end,
         status = 'completed',
         updated_at = now_ts
   where id = proj_id;

  -- 3. Wipe any prior seed data so re-runs are clean.
  delete from public.project_task_baselines where project_id = proj_id;
  delete from public.project_task_amounts
   where task_id in (select id from public.project_tasks where project_id = proj_id);
  delete from public.indent_items
   where indent_id in (select id from public.indents where project_id = proj_id);
  delete from public.indents          where project_id = proj_id;
  delete from public.project_messages where project_id = proj_id;
  delete from public.project_documents where project_id = proj_id;

  -- 4. Mark every task done with realistic actual dates + actual_value.
  update public.project_tasks pt
     set status = 'done',
         actual_start_date =
           coalesce(pt.actual_start_date, greatest(actual_start, coalesce(pt.start_date, actual_start) - interval '2 days')::date),
         actual_completion_date =
           coalesce(pt.actual_completion_date, least(actual_end, coalesce(pt.end_date, actual_end) + interval '3 days')::date),
         actual_value = case
           when pt.progress_metric = 'percent'  then 100
           when pt.progress_metric = 'quantity' then coalesce(pt.quantity_value, pt.actual_value)
           else pt.actual_value
         end,
         updated_at = now_ts
   where pt.project_id = proj_id;

  -- 5. Seed initial_plan baselines (kind='task_date') for every task with dates.
  insert into public.project_task_baselines
        (project_id, task_id, kind, snapshot_start, snapshot_end, reason, created_at)
  select proj_id, id, 'task_date', start_date, end_date, 'initial_plan', seed_ts_early
    from public.project_tasks
   where project_id = proj_id
     and (start_date is not null or end_date is not null);

  -- 6. Simulate two mid-project date shifts on the first three ROOT tasks.
  --    Each row here represents "this was the plan RIGHT BEFORE a subsequent revision".
  with roots as (
    select id, sort_order, row_number() over (order by sort_order) as rn
      from public.project_tasks
     where project_id = proj_id and parent_task_id is null
  )
  insert into public.project_task_baselines
        (project_id, task_id, kind, snapshot_start, snapshot_end, reason, created_at)
  select proj_id, r.id, 'task_date',
         (actual_start + interval '5 days')::date,
         (actual_start + interval '30 days')::date,
         'Weather delay — monsoon spillover',
         seed_ts_mid
    from roots r
   where r.rn <= 3;

  with roots as (
    select id, sort_order, row_number() over (order by sort_order) as rn
      from public.project_tasks
     where project_id = proj_id and parent_task_id is null
  )
  insert into public.project_task_baselines
        (project_id, task_id, kind, snapshot_start, snapshot_end, reason, created_at)
  select proj_id, r.id, 'task_date',
         (actual_start + interval '10 days')::date,
         (actual_start + interval '35 days')::date,
         'Material supplier switch — rebar spec change',
         seed_ts_mid + interval '15 days'
    from roots r
   where r.rn <= 3;

  -- 7. Seed task-level planned + actual amounts and one prior-amount baseline per root.
  with roots as (
    select id, row_number() over (order by sort_order) as rn
      from public.project_tasks
     where project_id = proj_id and parent_task_id is null
  )
  insert into public.project_task_amounts
        (task_id, planned_amount, actual_amount, updated_by, updated_at)
  select id,
         (500000 + rn * 125000)::numeric,
         (500000 + rn * 125000 + (rn * 12500))::numeric,
         pm_id,
         now_ts
    from roots
     on conflict (task_id) do update
        set planned_amount = excluded.planned_amount,
            actual_amount  = excluded.actual_amount,
            updated_by     = excluded.updated_by,
            updated_at     = excluded.updated_at;

  with roots as (
    select id, row_number() over (order by sort_order) as rn
      from public.project_tasks
     where project_id = proj_id and parent_task_id is null
  )
  insert into public.project_task_baselines
        (project_id, task_id, kind, snapshot_amount, reason, created_at)
  select proj_id, id, 'task_amount',
         (475000 + rn * 125000)::numeric,
         'Original quotation before rate revision',
         seed_ts_early + interval '10 days'
    from roots;

  -- 8. Seed one indent with 5 fully-received items.
  insert into public.indents
        (project_id, indent_number, indent_date, activity_name, indenter_name, indenter_mobile, is_academic, created_by)
  values (proj_id, 'IN-LWA-001', current_date - interval '95 days',
          'Civil works — foundation + structure', 'Ramesh K.', '9800011122', false, pm_id)
  returning id into ind_id;

  insert into public.indent_items
        (indent_id, item_name, item_description, unit,
         have_qty, buy_qty, unit_price,
         planned_amount, actual_amount,
         received_qty, received_on, sort_order)
  values
    (ind_id, 'Cement OPC 53',   'Grade 53 (Ultratech)', 'bags',
       0,   500,  420,   210000, 205000,   500, current_date - interval '80 days', 1),
    (ind_id, 'Steel TMT 12mm',  'Fe500, primary rebar', 'kg',
       100, 3000, 68,    197200, 215600,   3000, current_date - interval '70 days', 2),
    (ind_id, 'Bricks Class-A',  'Standard clay bricks', 'nos',
       500, 20000, 8,    156000, 172000,   20000, current_date - interval '65 days', 3),
    (ind_id, 'Sand River',      'Zone II fine aggregate','cu.ft',
       0,   800,  55,     44000,  47500,    800, current_date - interval '55 days', 4),
    (ind_id, 'Gravel 20mm',     'Coarse aggregate',      'cu.ft',
       0,   400,  62,     24800,  25200,    400, current_date - interval '50 days', 5);

  -- 9. Project messages — PM narration across the timeline.
  insert into public.project_messages (project_id, author_id, body, created_at)
  values
    (proj_id, pm_id, 'Site handed over. Materials arriving next week. #kickoff',
       now_ts - interval '118 days'),
    (proj_id, pm_id, 'Weather delay confirmed — pushed foundation by 20d. Baseline updated with reason. #delay',
       now_ts - interval '92 days'),
    (proj_id, pm_id, 'Structural inspection cleared. Finishing starts Monday. #milestone',
       now_ts - interval '35 days'),
    (proj_id, pm_id, 'Punch-list closed. Ready for handover. Cost variance +8% vs baseline. #handover',
       now_ts - interval '12 days');

  -- 10. Documents (metadata only; file blobs not seeded).
  insert into public.project_documents
        (project_id, name, display_name, file_path, mime_type, size_bytes, uploaded_by, created_at)
  values
    (proj_id, 'Kickoff-Notes.pdf',   'Kickoff Notes',      'seed/kickoff.pdf',     'application/pdf',   184320, pm_id, now_ts - interval '120 days'),
    (proj_id, 'Site-Layout.jpg',     'Site Layout Photo',  'seed/site-layout.jpg', 'image/jpeg',        512000, pm_id, now_ts - interval '115 days'),
    (proj_id, 'Handover-Report.pdf', 'Handover Report',    'seed/handover.pdf',    'application/pdf',   258048, pm_id, now_ts - interval '10 days');

  -- 11. Mark milestones reached (approximate around target_date). Milestone(s) show a delayed
  --     reached_date to simulate the site-feasibility slip cascading into the milestone date.
  update public.project_milestones
     set target_date  = coalesce(target_date, actual_start + interval '30 days')::date,
         reached_date = coalesce(target_date, actual_start + interval '30 days')::date + interval '15 days'
   where project_id = proj_id;

  -- 12. Milestone baseline (kind='milestone_date') — captures the ORIGINAL target date
  --     before the site-feasibility delay pushed everything out. Renders as a ghost bar on the Gantt.
  delete from public.project_task_baselines
   where project_id = proj_id and kind = 'milestone_date';
  insert into public.project_task_baselines
        (project_id, task_id, milestone_id, kind, snapshot_start, snapshot_end, reason, created_at)
  select proj_id, null, m.id, 'milestone_date',
         m.target_date - interval '15 days',
         m.target_date - interval '15 days',
         'Site Feasibility Report was delayed — milestone target pushed by 15 days',
         seed_ts_mid + interval '10 days'
    from public.project_milestones m
   where m.project_id = proj_id;

  -- 13. Sample assignee daily updates (subtask_updates) on the first 5 leaf tasks.
  --     These populate the "Updates" eye-popover on ProjectDetail rows.
  delete from public.subtask_updates
   where task_id in (select id from public.project_tasks where project_id = proj_id);
  with leaves as (
    select pt.id, pt.name, pt.actual_start_date, pt.actual_completion_date,
           row_number() over (order by pt.sort_order) as rn
      from public.project_tasks pt
     where pt.project_id = proj_id
       and not exists (select 1 from public.project_tasks c where c.parent_task_id = pt.id)
     order by pt.sort_order
     limit 5
  )
  insert into public.subtask_updates (task_id, updated_by, update_date, notes, created_at)
  select l.id, pm_id, l.actual_start_date + interval '2 days',
         'Started on site. Materials on hand. Kickoff done with the team.',
         now_ts - interval '80 days'
    from leaves l
  union all
  select l.id, pm_id, l.actual_start_date + interval '5 days',
         'Progress ~40%. On schedule. Awaiting inspection sign-off for next stage.',
         now_ts - interval '65 days'
    from leaves l
  union all
  select l.id, pm_id, l.actual_completion_date - interval '3 days',
         'Wrapping up. Punch-list items being closed today.',
         now_ts - interval '30 days'
    from leaves l
  union all
  select l.id, pm_id, l.actual_completion_date,
         'Task complete. Handed over to the next stage. Sign-off pending PM approval.',
         now_ts - interval '15 days'
    from leaves l;

  raise notice 'Seeded completed-project scenario for "%": %', 'Library - New Wing A', proj_id;
end $$;
