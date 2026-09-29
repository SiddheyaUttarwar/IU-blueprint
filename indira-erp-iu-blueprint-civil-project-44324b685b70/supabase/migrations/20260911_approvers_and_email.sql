-- Phase: project-level Approval Authority + snapshot at request time + email queue on notifications.
-- Idempotent: safe to re-run.

-- 1) Approver list per project — chosen by the PM at project creation.
alter table public.projects
  add column if not exists approver_ids uuid[] not null default '{}'::uuid[];
create index if not exists projects_approvers_gin_idx on public.projects using gin (approver_ids);

-- 2) Snapshot of approvers at the moment a request is raised.
-- Later changes to the project's approver_ids do NOT affect pending requests: a snapshot approver
-- who was removed from the project after raising still has to complete their pending approval.
alter table public.project_status_requests
  add column if not exists approver_snapshot uuid[] not null default '{}'::uuid[];
alter table public.baseline_change_requests
  add column if not exists approver_snapshot uuid[] not null default '{}'::uuid[];

-- 3) SECURITY DEFINER helper — is the caller in the snapshot?
-- Called inside RLS policies on the same table it selects from → must be DEFINER to avoid 42P17.
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

-- 4) Any snapshot approver may decide a status request (any-one-approves).
drop policy if exists "psr: admin decide" on public.project_status_requests;
drop policy if exists "psr: snapshot approver decide" on public.project_status_requests;
create policy "psr: snapshot approver decide"
  on public.project_status_requests for update
  using (public.is_project_admin() or public.is_snapshot_approver(approver_snapshot))
  with check (public.is_project_admin() or public.is_snapshot_approver(approver_snapshot));

-- 5) Any snapshot approver may decide a baseline-change request.
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

-- 6) Email queue on notifications. A worker picks up rows where email_pending = true and clears the flag.
alter table public.notifications add column if not exists email_pending boolean not null default false;
alter table public.notifications add column if not exists email_sent_at timestamptz;
alter table public.notifications add column if not exists email_to text;
create index if not exists notifications_email_pending_idx
  on public.notifications (email_pending, created_at)
  where email_pending = true;

-- 7) Notifications INSERT policy — without it RLS silently blocked every notifyMany() call,
-- so raised baseline / status requests produced no in-app or email notifications.
drop policy if exists "notifications: authenticated insert" on public.notifications;
create policy "notifications: authenticated insert"
  on public.notifications for insert
  with check (auth.uid() is not null);
