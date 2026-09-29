-- ============================================================================
-- Demo dataset — five projects, each exercising a different lifecycle state
-- so the Dashboard / Projects list / RAG engine light up with real variety.
--
-- The five scenarios (name prefix "DEMO — " so the seed is re-runnable):
--   1. Completed on Track ......... All green, actual dates ≤ plan, actual ≤ budget
--   2. Active — In Flight ......... Some tasks done, some in progress, some not started
--   3. Baseline Changed + Completed  Approved baseline_change_request in history + ghost bars
--   4. Completed Late (Red) ....... Actual finish 45 days past planned, schedule RAG = red
--   5. Completed Over Budget ...... Actual amount 40 % > planned → cost RAG = red
--
-- Idempotent: deletes any row whose name starts with "DEMO — " before re-inserting.
-- Prerequisite: at least one active project_type, one profile, one campus/school
-- (any will do). Campus / school are optional and looked up leniently.
-- ============================================================================

do $$
declare
  v_type_id   uuid;
  v_campus_id uuid;
  v_school_id uuid;
  v_pm_id     uuid;
  v_tmpl_id   uuid;
  v_ver_id    uuid;

  v_p1 uuid := 'a1111111-0000-0000-0000-000000000001'::uuid;
  v_p2 uuid := 'a2222222-0000-0000-0000-000000000002'::uuid;
  v_p3 uuid := 'a3333333-0000-0000-0000-000000000003'::uuid;
  v_p4 uuid := 'a4444444-0000-0000-0000-000000000004'::uuid;
  v_p5 uuid := 'a5555555-0000-0000-0000-000000000005'::uuid;

  v_root_a uuid; v_root_b uuid;
  v_sub_a1 uuid; v_sub_a2 uuid;
  v_sub_b1 uuid; v_sub_b2 uuid;
  v_ind    uuid;
begin
  select id into v_type_id   from public.project_types where is_active order by created_at limit 1;
  select id into v_campus_id from public.campuses     where is_active order by created_at limit 1;
  select id into v_school_id from public.schools      where is_active and (v_campus_id is null or campus_id = v_campus_id) order by created_at limit 1;
  select id into v_pm_id     from public.profiles     where 'project_manager' = any(coalesce(roles, array[role])) or role = 'project_manager' order by created_at limit 1;
  if v_pm_id is null then select id into v_pm_id from public.profiles order by created_at limit 1; end if;
  if v_type_id is null then raise notice 'Seed skipped — no active project_types found. Add one in Masters → Project Type first.'; return; end if;
  if v_pm_id   is null then raise notice 'Seed skipped — no profiles found.';               return; end if;

  -- Wipe prior demo rows (cascades take care of tasks / amounts / baselines / indents / template).
  delete from public.projects          where name like 'DEMO — %';
  delete from public.project_templates where name = 'DEMO — Demo Template';

  -- ---- Demo template + v1 --------------------------------------------------
  -- Every demo project links to this template so Projects / Dashboard show a
  -- real "Project Template" name (and the v1 version pill) — not em-dashes.
  insert into public.project_templates (name, project_type_id, description, created_by)
  values ('DEMO — Demo Template', v_type_id, 'Auto-created by demo_five_states.sql for the 5-state demo projects.', v_pm_id)
  returning id into v_tmpl_id;
  insert into public.template_versions (template_id, version_no, is_locked, created_by)
  values (v_tmpl_id, 1, false, v_pm_id)
  returning id into v_ver_id;

  -- ===========================================================================
  -- 1) DEMO — Completed on Track
  --    Planned + actual align; both dates and budget under target.
  -- ===========================================================================
  insert into public.projects (id, name, description, project_class, template_id, template_version_id, project_type_id, campus_id, school_id, project_manager_id, start_date, end_date, actual_start_date, actual_end_date, status, is_draft, created_by)
  values (v_p1, 'DEMO — Completed on Track', 'Delivered inside baseline, under budget. All-green demo.',
          'greenfield', v_tmpl_id, v_ver_id, v_type_id, v_campus_id, v_school_id, v_pm_id,
          '2026-04-01', '2026-06-30', '2026-04-01', '2026-06-28', 'completed', false, v_pm_id);

  v_root_a := gen_random_uuid(); v_root_b := gen_random_uuid();
  v_sub_a1 := gen_random_uuid(); v_sub_a2 := gen_random_uuid();
  v_sub_b1 := gen_random_uuid(); v_sub_b2 := gen_random_uuid();

  insert into public.project_tasks (id, project_id, parent_task_id, phase, task_type, name, is_mandatory, weight_pct, progress_metric, start_date, end_date, actual_start_date, actual_completion_date, status, sort_order) values
    (v_root_a, v_p1, null, 'project', 'summary', 'Site Preparation',    true, 50, 'done_not_done', '2026-04-01', '2026-05-10', '2026-04-01', '2026-05-08', 'done', 1),
    (v_sub_a1, v_p1, v_root_a, 'project', 'task', 'Survey',              true, 50, 'done_not_done', '2026-04-01', '2026-04-20', '2026-04-01', '2026-04-19', 'done', 2),
    (v_sub_a2, v_p1, v_root_a, 'project', 'task', 'Ground Clearing',     true, 50, 'done_not_done', '2026-04-21', '2026-05-10', '2026-04-21', '2026-05-08', 'done', 3),
    (v_root_b, v_p1, null, 'project', 'summary', 'Foundation & Framing', true, 50, 'done_not_done', '2026-05-11', '2026-06-30', '2026-05-11', '2026-06-28', 'done', 4),
    (v_sub_b1, v_p1, v_root_b, 'project', 'task', 'Foundation Pour',     true, 50, 'done_not_done', '2026-05-11', '2026-06-05', '2026-05-11', '2026-06-04', 'done', 5),
    (v_sub_b2, v_p1, v_root_b, 'project', 'task', 'Frame Erection',      true, 50, 'done_not_done', '2026-06-06', '2026-06-30', '2026-06-06', '2026-06-28', 'done', 6);

  insert into public.project_task_amounts (task_id, planned_amount, actual_amount, updated_by) values
    (v_sub_a1, 100000, 95000, v_pm_id),
    (v_sub_a2, 120000, 118000, v_pm_id),
    (v_sub_b1, 180000, 175000, v_pm_id),
    (v_sub_b2, 100000, 92000, v_pm_id);
  -- Total planned 500k, actual 480k → 4 % under budget.

  insert into public.indents (id, project_id, indent_number, indent_date, activity_name, created_by)
    values (gen_random_uuid(), v_p1, 'DEMO-P1-01', '2026-04-05', 'Site Prep — materials', v_pm_id)
    returning id into v_ind;
  insert into public.indent_items (indent_id, item_name, unit, buy_qty, unit_price, received_qty, sort_order, planned_amount, actual_amount) values
    (v_ind, 'Cement bags',   'bags', 200, 420, 200, 1, 84000, 84000),
    (v_ind, 'Steel rods',    'kg',  1500, 68, 1500, 2, 102000, 102000),
    (v_ind, 'Bricks class-A','nos', 5000, 8,  5000, 3, 40000, 40000);

  -- ===========================================================================
  -- 2) DEMO — Active In Flight
  --    Project has started; some subtasks done, some in progress, some pending.
  -- ===========================================================================
  insert into public.projects (id, name, description, project_class, template_id, template_version_id, project_type_id, campus_id, school_id, project_manager_id, start_date, end_date, actual_start_date, actual_end_date, status, is_draft, created_by)
  values (v_p2, 'DEMO — Active In Flight', 'Mid-execution: partial progress across tasks.',
          'greenfield', v_tmpl_id, v_ver_id, v_type_id, v_campus_id, v_school_id, v_pm_id,
          '2026-08-01', '2026-12-31', '2026-08-01', null, 'active', false, v_pm_id);

  v_root_a := gen_random_uuid(); v_root_b := gen_random_uuid();
  v_sub_a1 := gen_random_uuid(); v_sub_a2 := gen_random_uuid();
  v_sub_b1 := gen_random_uuid(); v_sub_b2 := gen_random_uuid();

  insert into public.project_tasks (id, project_id, parent_task_id, phase, task_type, name, is_mandatory, weight_pct, progress_metric, start_date, end_date, actual_start_date, actual_completion_date, status, actual_value, sort_order) values
    (v_root_a, v_p2, null, 'project', 'summary', 'Design & Approvals', true, 40, 'done_not_done', '2026-08-01', '2026-09-30', '2026-08-01', '2026-09-25', 'done',       null, 1),
    (v_sub_a1, v_p2, v_root_a, 'project', 'task', 'Architect Drawings',true, 60, 'done_not_done', '2026-08-01', '2026-09-05', '2026-08-01', '2026-09-02', 'done',       null, 2),
    (v_sub_a2, v_p2, v_root_a, 'project', 'task', 'Local Permits',     true, 40, 'done_not_done', '2026-09-06', '2026-09-30', '2026-09-06', '2026-09-25', 'done',       null, 3),
    (v_root_b, v_p2, null, 'project', 'summary', 'Construction',       true, 60, 'percent',       '2026-10-01', '2026-12-31', '2026-10-01', null,         'in_progress', null, 4),
    (v_sub_b1, v_p2, v_root_b, 'project', 'task', 'Wall Construction', true, 50, 'percent',       '2026-10-01', '2026-11-15', '2026-10-01', null,         'in_progress', 45,  5),
    (v_sub_b2, v_p2, v_root_b, 'project', 'task', 'Roofing',           true, 50, 'done_not_done', '2026-11-16', '2026-12-31', null,         null,         'not_started', null, 6);

  insert into public.project_task_amounts (task_id, planned_amount, actual_amount, updated_by) values
    (v_sub_a1, 80000,  78000,  v_pm_id),
    (v_sub_a2, 40000,  38000,  v_pm_id),
    (v_sub_b1, 250000, 110000, v_pm_id),  -- ~45 % spent, matches 45 % progress
    (v_sub_b2, 180000, null,   v_pm_id);

  insert into public.indents (id, project_id, indent_number, indent_date, activity_name, created_by)
    values (gen_random_uuid(), v_p2, 'DEMO-P2-01', '2026-09-15', 'Construction materials', v_pm_id)
    returning id into v_ind;
  insert into public.indent_items (indent_id, item_name, unit, buy_qty, unit_price, received_qty, sort_order, planned_amount, actual_amount) values
    (v_ind, 'Cement bags', 'bags', 500, 420, 220, 1, 210000, 92400),
    (v_ind, 'TMT steel',   'kg',  3000, 68,  1400, 2, 204000, 95200);

  -- ===========================================================================
  -- 3) DEMO — Baseline Changed
  --    An approved baseline_change_request extended the plan; ghost bar snapshots
  --    capture the pre-approval dates.
  -- ===========================================================================
  insert into public.projects (id, name, description, project_class, template_id, template_version_id, project_type_id, campus_id, school_id, project_manager_id, start_date, end_date, actual_start_date, actual_end_date, status, is_draft, created_by)
  values (v_p3, 'DEMO — Baseline Changed', 'PM shifted the plan mid-project after leadership approval. Ghost bars visible.',
          'brownfield', v_tmpl_id, v_ver_id, v_type_id, v_campus_id, v_school_id, v_pm_id,
          '2026-05-01', '2026-09-15', '2026-05-01', '2026-09-14', 'completed', false, v_pm_id);

  v_root_a := gen_random_uuid(); v_root_b := gen_random_uuid();
  v_sub_a1 := gen_random_uuid(); v_sub_a2 := gen_random_uuid();
  v_sub_b1 := gen_random_uuid(); v_sub_b2 := gen_random_uuid();

  insert into public.project_tasks (id, project_id, parent_task_id, phase, task_type, name, is_mandatory, weight_pct, progress_metric, start_date, end_date, actual_start_date, actual_completion_date, status, sort_order) values
    (v_root_a, v_p3, null, 'project', 'summary', 'Demolition',            true, 50, 'done_not_done', '2026-05-01', '2026-06-30', '2026-05-01', '2026-06-28', 'done', 1),
    (v_sub_a1, v_p3, v_root_a, 'project', 'task', 'Structural Assessment', true, 50, 'done_not_done', '2026-05-01', '2026-05-31', '2026-05-01', '2026-05-30', 'done', 2),
    (v_sub_a2, v_p3, v_root_a, 'project', 'task', 'Controlled Demolition', true, 50, 'done_not_done', '2026-06-01', '2026-06-30', '2026-06-01', '2026-06-28', 'done', 3),
    (v_root_b, v_p3, null, 'project', 'summary', 'Rebuild',                true, 50, 'done_not_done', '2026-07-01', '2026-09-15', '2026-07-01', '2026-09-14', 'done', 4),
    (v_sub_b1, v_p3, v_root_b, 'project', 'task', 'New Foundation',        true, 50, 'done_not_done', '2026-07-01', '2026-08-10', '2026-07-01', '2026-08-08', 'done', 5),
    (v_sub_b2, v_p3, v_root_b, 'project', 'task', 'Superstructure',        true, 50, 'done_not_done', '2026-08-11', '2026-09-15', '2026-08-11', '2026-09-14', 'done', 6);

  -- Ghost bars — the pre-approval plan had Rebuild ending 2026-07-31 (later moved to 2026-09-15).
  insert into public.project_task_baselines (project_id, task_id, kind, snapshot_start, snapshot_end, reason, created_by, created_at) values
    (v_p3, v_sub_b1, 'task_date', '2026-07-01', '2026-07-15', 'Original baseline',                                    v_pm_id, '2026-05-01 09:00+00'),
    (v_p3, v_sub_b2, 'task_date', '2026-07-16', '2026-07-31', 'Original baseline',                                    v_pm_id, '2026-05-01 09:00+00'),
    (v_p3, v_sub_b1, 'task_date', '2026-07-01', '2026-08-10', 'Extended after materials delay (approved by leadership)', v_pm_id, '2026-07-08 15:00+00'),
    (v_p3, v_sub_b2, 'task_date', '2026-08-11', '2026-09-15', 'Extended after materials delay (approved by leadership)', v_pm_id, '2026-07-08 15:00+00');

  -- Approved baseline_change_request row so it appears in the approvals log.
  insert into public.baseline_change_requests (project_id, requested_by, requested_at, reason, before_snapshot, after_snapshot, status, decided_by, decided_at, decision_reason)
  values (v_p3, v_pm_id, '2026-07-05 12:00+00',
          'Materials delay from supplier — need 45 more days on Rebuild to keep quality standards.',
          jsonb_build_object(
            'project', jsonb_build_object('name', 'DEMO — Baseline Changed', 'start_date', '2026-05-01', 'end_date', '2026-07-31'),
            'tasks', jsonb_build_array(
              jsonb_build_object('id', v_sub_b1, 'name', 'New Foundation',  'start_date', '2026-07-01', 'end_date', '2026-07-15'),
              jsonb_build_object('id', v_sub_b2, 'name', 'Superstructure', 'start_date', '2026-07-16', 'end_date', '2026-07-31')),
            'milestones', jsonb_build_array()),
          jsonb_build_object(
            'project', jsonb_build_object('name', 'DEMO — Baseline Changed', 'start_date', '2026-05-01', 'end_date', '2026-09-15'),
            'tasks', jsonb_build_array(
              jsonb_build_object('id', v_sub_b1, 'name', 'New Foundation',  'start_date', '2026-07-01', 'end_date', '2026-08-10'),
              jsonb_build_object('id', v_sub_b2, 'name', 'Superstructure', 'start_date', '2026-08-11', 'end_date', '2026-09-15')),
            'milestones', jsonb_build_array()),
          'approved', v_pm_id, '2026-07-08 15:00+00', 'Approved — supplier delay verified.');

  insert into public.project_task_amounts (task_id, planned_amount, actual_amount, updated_by) values
    (v_sub_a1, 90000,  88000,  v_pm_id),
    (v_sub_a2, 130000, 132000, v_pm_id),
    (v_sub_b1, 260000, 275000, v_pm_id),  -- some overrun offset by savings elsewhere
    (v_sub_b2, 220000, 210000, v_pm_id);

  -- ===========================================================================
  -- 4) DEMO — Completed Late (Red)
  --    Project finished 45 days after the planned end — schedule slip = red.
  -- ===========================================================================
  insert into public.projects (id, name, description, project_class, template_id, template_version_id, project_type_id, campus_id, school_id, project_manager_id, start_date, end_date, actual_start_date, actual_end_date, status, is_draft, created_by)
  values (v_p4, 'DEMO — Completed Late (Red)', 'Delivered 45 days past baseline; schedule RAG red.',
          'greenfield', v_tmpl_id, v_ver_id, v_type_id, v_campus_id, v_school_id, v_pm_id,
          '2026-03-01', '2026-05-31', '2026-03-05', '2026-07-15', 'completed', false, v_pm_id);

  v_root_a := gen_random_uuid(); v_root_b := gen_random_uuid();
  v_sub_a1 := gen_random_uuid(); v_sub_a2 := gen_random_uuid();
  v_sub_b1 := gen_random_uuid(); v_sub_b2 := gen_random_uuid();

  insert into public.project_tasks (id, project_id, parent_task_id, phase, task_type, name, is_mandatory, weight_pct, progress_metric, start_date, end_date, actual_start_date, actual_completion_date, status, sort_order) values
    (v_root_a, v_p4, null, 'project', 'summary', 'Pre-construction',   true, 40, 'done_not_done', '2026-03-01', '2026-03-31', '2026-03-05', '2026-04-15', 'done', 1),
    (v_sub_a1, v_p4, v_root_a, 'project', 'task', 'Site Survey',        true, 50, 'done_not_done', '2026-03-01', '2026-03-15', '2026-03-05', '2026-03-25', 'done', 2),
    (v_sub_a2, v_p4, v_root_a, 'project', 'task', 'Permit Applications',true, 50, 'done_not_done', '2026-03-16', '2026-03-31', '2026-03-26', '2026-04-15', 'done', 3),
    (v_root_b, v_p4, null, 'project', 'summary', 'Construction',        true, 60, 'done_not_done', '2026-04-01', '2026-05-31', '2026-04-16', '2026-07-15', 'done', 4),
    (v_sub_b1, v_p4, v_root_b, 'project', 'task', 'Foundation',         true, 50, 'done_not_done', '2026-04-01', '2026-04-25', '2026-04-16', '2026-05-30', 'done', 5),
    (v_sub_b2, v_p4, v_root_b, 'project', 'task', 'Superstructure',     true, 50, 'done_not_done', '2026-04-26', '2026-05-31', '2026-06-01', '2026-07-15', 'done', 6);

  insert into public.project_task_amounts (task_id, planned_amount, actual_amount, updated_by) values
    (v_sub_a1, 60000,  62000,  v_pm_id),
    (v_sub_a2, 40000,  40000,  v_pm_id),
    (v_sub_b1, 180000, 180000, v_pm_id),
    (v_sub_b2, 220000, 220000, v_pm_id);

  -- ===========================================================================
  -- 5) DEMO — Completed Over Budget
  --    Actual amount 40 % above plan → cost RAG red. Schedule fine.
  -- ===========================================================================
  insert into public.projects (id, name, description, project_class, template_id, template_version_id, project_type_id, campus_id, school_id, project_manager_id, start_date, end_date, actual_start_date, actual_end_date, status, is_draft, created_by)
  values (v_p5, 'DEMO — Completed Over Budget', 'Finished on time but 40 % over budget. Cost RAG red.',
          'brownfield', v_tmpl_id, v_ver_id, v_type_id, v_campus_id, v_school_id, v_pm_id,
          '2026-06-01', '2026-08-31', '2026-06-01', '2026-08-29', 'completed', false, v_pm_id);

  v_root_a := gen_random_uuid(); v_root_b := gen_random_uuid();
  v_sub_a1 := gen_random_uuid(); v_sub_a2 := gen_random_uuid();
  v_sub_b1 := gen_random_uuid(); v_sub_b2 := gen_random_uuid();

  insert into public.project_tasks (id, project_id, parent_task_id, phase, task_type, name, is_mandatory, weight_pct, progress_metric, start_date, end_date, actual_start_date, actual_completion_date, status, sort_order) values
    (v_root_a, v_p5, null, 'project', 'summary', 'Refurbishment Prep',   true, 50, 'done_not_done', '2026-06-01', '2026-07-15', '2026-06-01', '2026-07-14', 'done', 1),
    (v_sub_a1, v_p5, v_root_a, 'project', 'task', 'Stripping & Cleanup',  true, 50, 'done_not_done', '2026-06-01', '2026-06-25', '2026-06-01', '2026-06-25', 'done', 2),
    (v_sub_a2, v_p5, v_root_a, 'project', 'task', 'Reinforcement Survey', true, 50, 'done_not_done', '2026-06-26', '2026-07-15', '2026-06-26', '2026-07-14', 'done', 3),
    (v_root_b, v_p5, null, 'project', 'summary', 'Finishing',             true, 50, 'done_not_done', '2026-07-16', '2026-08-31', '2026-07-16', '2026-08-29', 'done', 4),
    (v_sub_b1, v_p5, v_root_b, 'project', 'task', 'Plumbing & Electrical',true, 50, 'done_not_done', '2026-07-16', '2026-08-10', '2026-07-16', '2026-08-09', 'done', 5),
    (v_sub_b2, v_p5, v_root_b, 'project', 'task', 'Interior Finishing',   true, 50, 'done_not_done', '2026-08-11', '2026-08-31', '2026-08-11', '2026-08-29', 'done', 6);

  insert into public.project_task_amounts (task_id, planned_amount, actual_amount, updated_by) values
    (v_sub_a1, 80000,  110000, v_pm_id),   -- +37 %
    (v_sub_a2, 60000,   85000, v_pm_id),   -- +42 %
    (v_sub_b1, 180000, 260000, v_pm_id),   -- +44 %
    (v_sub_b2, 180000, 245000, v_pm_id);   -- +36 %
  -- Total planned 500k, actual 700k → 40 % overrun.

  insert into public.indents (id, project_id, indent_number, indent_date, activity_name, created_by)
    values (gen_random_uuid(), v_p5, 'DEMO-P5-01', '2026-07-01', 'Refurb materials', v_pm_id)
    returning id into v_ind;
  insert into public.indent_items (indent_id, item_name, unit, buy_qty, unit_price, received_qty, sort_order, planned_amount, actual_amount) values
    (v_ind, 'Copper wiring',   'm',   800, 220, 800, 1, 176000, 220000),
    (v_ind, 'PVC pipes',       'm',   400, 180, 400, 2,  72000,  96000),
    (v_ind, 'Interior paint',  'ltr', 300, 550, 300, 3, 165000, 210000);

  -- ===========================================================================
  -- Enrichment — populate the collaboration surface for every DEMO project:
  -- assignees on leaf tasks, dependencies, daily updates, messages, documents,
  -- notifications, and a pending baseline_change_request on the Active project.
  -- Joins by project name keep the block independent of per-project variables.
  -- ===========================================================================
  declare
    v_member_id uuid;
    v_lead_id   uuid;
    v_p2_id     uuid;
  begin
    select id into v_member_id from public.profiles
      where 'member' = any(coalesce(roles, array[role])) or role = 'member'
      order by created_at limit 1;
    if v_member_id is null then v_member_id := v_pm_id; end if;
    select id into v_lead_id from public.profiles
      where 'leadership' = any(coalesce(roles, array[role])) or role = 'leadership'
      order by created_at limit 1;
    if v_lead_id is null then v_lead_id := v_pm_id; end if;

    -- 1) Assign every leaf task on every DEMO project to a member + PM watcher.
    update public.project_tasks pt
       set assigned_to = v_member_id,
           assigned_to_ids = array[v_member_id, v_pm_id]::uuid[]
      from public.projects p
     where pt.project_id = p.id
       and p.name like 'DEMO — %'
       and pt.task_type <> 'summary';

    -- 2) Dependencies — sibling chain: each leaf task depends on the previous leaf
    --    under the same parent, ordered by sort_order. Cheap, deterministic.
    insert into public.project_task_dependencies (project_id, task_id, depends_on_task_id)
    select cur.project_id, cur.id, prev.id
      from public.project_tasks cur
      join public.project_tasks prev
        on prev.project_id = cur.project_id
       and prev.parent_task_id = cur.parent_task_id
       and prev.sort_order < cur.sort_order
      join public.projects p on p.id = cur.project_id
     where p.name like 'DEMO — %'
       and cur.task_type <> 'summary'
       and prev.task_type <> 'summary'
       and prev.sort_order = (
         select max(prev2.sort_order) from public.project_tasks prev2
          where prev2.project_id = cur.project_id
            and prev2.parent_task_id = cur.parent_task_id
            and prev2.sort_order < cur.sort_order
            and prev2.task_type <> 'summary'
       )
    on conflict (project_id, task_id, depends_on_task_id) do nothing;

    -- 3) Daily updates — one per done/in_progress leaf task, dated near completion.
    insert into public.subtask_updates (task_id, updated_by, update_date, notes)
    select pt.id, v_member_id,
           coalesce(pt.actual_completion_date, pt.actual_start_date, pt.start_date),
           case when pt.status = 'done'
                then 'Completed on ' || to_char(coalesce(pt.actual_completion_date, current_date), 'DD Mon YYYY') || '. No issues.'
                else 'Progress at ' || coalesce(pt.actual_value::text, '0') || '%. On track.'
           end
      from public.project_tasks pt
      join public.projects p on p.id = pt.project_id
     where p.name like 'DEMO — %'
       and pt.task_type <> 'summary'
       and pt.status in ('done', 'in_progress');

    -- 4) Messages — three per project, staggered timestamps around start/mid/end.
    insert into public.project_messages (project_id, author_id, body, created_at)
    select p.id, v_pm_id,
           'Kickoff — team introduced, timelines agreed. Ready to start.',
           coalesce(p.actual_start_date, p.start_date)::timestamptz + interval '2 hours'
      from public.projects p where p.name like 'DEMO — %';
    insert into public.project_messages (project_id, author_id, body, created_at)
    select p.id, v_member_id,
           'Mid-project checkpoint: on schedule, no blockers to flag.',
           coalesce(p.actual_start_date, p.start_date)::timestamptz + interval '20 days'
      from public.projects p where p.name like 'DEMO — %';
    insert into public.project_messages (project_id, author_id, body, created_at)
    select p.id, v_pm_id,
           case when p.status = 'completed' then 'Delivered. Handover documents shared with leadership.'
                else 'Weekly summary — refer to attached daily updates.' end,
           coalesce(p.actual_end_date, current_date)::timestamptz - interval '1 day'
      from public.projects p where p.name like 'DEMO — %';

    -- 5) Documents — two metadata rows per project (file itself lives in storage
    --    normally; the seed puts placeholder paths so the tab isn't empty).
    insert into public.project_documents (project_id, name, display_name, file_path, mime_type, size_bytes, uploaded_by)
    select p.id, 'kickoff-notes.pdf',       'Kickoff Notes',          p.id::text || '/kickoff-notes.pdf',       'application/pdf', 184320, v_pm_id
      from public.projects p where p.name like 'DEMO — %';
    insert into public.project_documents (project_id, name, display_name, file_path, mime_type, size_bytes, uploaded_by)
    select p.id, 'site-photos-week1.zip',   'Site Photos — Week 1',   p.id::text || '/site-photos-week1.zip',   'application/zip', 2560000, v_member_id
      from public.projects p where p.name like 'DEMO — %';

    -- 6) Notifications — a small mix per project so the bell has something to show.
    --    project_started (PM), task_assigned (member), message_posted (team).
    insert into public.notifications (recipient_profile_id, subject_profile_id, type, message, created_at)
    select v_pm_id, v_pm_id, 'project_started',
           'Project "' || p.name || '" has started.' || E'\n#project=' || p.id::text,
           coalesce(p.actual_start_date, p.start_date)::timestamptz + interval '3 hours'
      from public.projects p where p.name like 'DEMO — %' and p.actual_start_date is not null;
    insert into public.notifications (recipient_profile_id, subject_profile_id, type, message, created_at)
    select v_member_id, v_pm_id, 'task_assigned',
           'You were assigned to a task in "' || p.name || '".' || E'\n#project=' || p.id::text,
           coalesce(p.actual_start_date, p.start_date)::timestamptz + interval '4 hours'
      from public.projects p where p.name like 'DEMO — %';
    insert into public.notifications (recipient_profile_id, subject_profile_id, type, message, created_at)
    select v_pm_id, v_lead_id, 'baseline_approved',
           'Your baseline change request has been approved and applied.' || E'\n#project=' || v_p3::text,
           '2026-07-08 15:00+00';

    -- 7) Pending baseline_change_request on the Active project so the queue isn't empty.
    select v_p2 into v_p2_id;
    insert into public.baseline_change_requests
      (project_id, requested_by, requested_at, reason, before_snapshot, after_snapshot, status)
    values
      (v_p2_id, v_pm_id, current_timestamp - interval '2 days',
       'Wall Construction slower than planned due to labour availability — request 15 more days on the current subtask.',
       jsonb_build_object(
         'project', jsonb_build_object('name', 'DEMO — Active In Flight', 'start_date', '2026-08-01', 'end_date', '2026-12-31'),
         'tasks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'start_date', start_date, 'end_date', end_date)), '[]'::jsonb)
                     from public.project_tasks where project_id = v_p2_id and task_type <> 'summary'),
         'milestones', jsonb_build_array()),
       jsonb_build_object(
         'project', jsonb_build_object('name', 'DEMO — Active In Flight', 'start_date', '2026-08-01', 'end_date', '2027-01-15'),
         'tasks', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', id, 'name', name,
                     'start_date', start_date,
                     'end_date', case when name = 'Wall Construction' then (end_date + interval '15 days')::date
                                      when name = 'Roofing'           then (end_date + interval '15 days')::date
                                      else end_date end)), '[]'::jsonb)
                     from public.project_tasks where project_id = v_p2_id and task_type <> 'summary'),
         'milestones', jsonb_build_array()),
       'pending');
  end;

  raise notice 'Seeded 1 demo template + 5 demo projects with assignments, dependencies, updates, messages, documents, notifications and a pending baseline request. Re-run this file any time to reset them.';
end
$$ language plpgsql;
