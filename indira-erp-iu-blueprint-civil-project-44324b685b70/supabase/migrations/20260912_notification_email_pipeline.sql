-- Permanent notification pipeline:
--   1. app_settings: holds the mailer webhook URL + shared secret + Resend API key
--   2. AFTER INSERT trigger on notifications → net.http_post(webhook_url) for rows with email_pending
--   3. pg_cron sweep every 5 min → replays any rows with email_pending=true & email_sent_at is null
--   4. Adds notifications to supabase_realtime publication so the bell updates instantly
--
-- Idempotent: safe to re-run.

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

-- ----------------------------------------------------------------------------
-- 1) app_settings — plain key/value table. Populate the mailer URL & secret AFTER
--    deploying the notification-mailer Edge Function:
--       insert into public.app_settings (key, value) values
--         ('notification_webhook_url', 'https://<project-ref>.functions.supabase.co/notification-mailer'),
--         ('notification_webhook_secret', '<generated>');
--    The Resend API key + MAIL_FROM go in the Edge Function secrets, not here.
-- ----------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
drop policy if exists "app_settings: admin read" on public.app_settings;
create policy "app_settings: admin read"
  on public.app_settings for select
  using (public.is_project_admin());
drop policy if exists "app_settings: admin write" on public.app_settings;
create policy "app_settings: admin write"
  on public.app_settings for all
  using (public.is_project_admin())
  with check (public.is_project_admin());

insert into public.app_settings (key, value) values
  ('notification_webhook_url', ''),
  ('notification_webhook_secret', '')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- 2) AFTER INSERT trigger — fires ONLY when email_pending = true & email_to is set.
--    Reads webhook URL from app_settings, POSTs { notification_id, secret } to it.
--    Runs SECURITY DEFINER so any authenticated user's insert can call net.http_post.
-- ----------------------------------------------------------------------------
create or replace function public.enqueue_notification_email()
returns trigger
language plpgsql
security definer set search_path = public, extensions, net
as $$
declare
  webhook_url text;
  webhook_secret text;
begin
  if new.email_pending is not true then return new; end if;
  if new.email_to is null or length(trim(new.email_to)) = 0 then return new; end if;
  select value into webhook_url from public.app_settings where key = 'notification_webhook_url';
  select value into webhook_secret from public.app_settings where key = 'notification_webhook_secret';
  if webhook_url is null or webhook_url = '' then return new; end if;
  perform net.http_post(
    url := webhook_url,
    body := jsonb_build_object(
      'notification_id', new.id::text,
      'secret', coalesce(webhook_secret, '')
    ),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  -- Never let a mailer failure block the notification insert.
  raise warning 'enqueue_notification_email failed for %: %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_enqueue_notification_email on public.notifications;
create trigger trg_enqueue_notification_email
  after insert on public.notifications
  for each row execute function public.enqueue_notification_email();

-- ----------------------------------------------------------------------------
-- 3) pg_cron fallback sweep. Every 5 min, ping the mailer for any rows still
--    pending & unsent from the last 24h. The mailer itself is idempotent.
-- ----------------------------------------------------------------------------
create or replace function public.sweep_pending_notification_emails()
returns void
language plpgsql
security definer set search_path = public, extensions, net
as $$
declare
  webhook_url text;
  webhook_secret text;
  n record;
begin
  select value into webhook_url from public.app_settings where key = 'notification_webhook_url';
  select value into webhook_secret from public.app_settings where key = 'notification_webhook_secret';
  if webhook_url is null or webhook_url = '' then return; end if;
  for n in
    select id from public.notifications
    where email_pending = true
      and email_sent_at is null
      and email_to is not null
      and created_at > now() - interval '24 hours'
    order by created_at asc
    limit 200
  loop
    perform net.http_post(
      url := webhook_url,
      body := jsonb_build_object('notification_id', n.id::text, 'secret', coalesce(webhook_secret, '')),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 5000
    );
  end loop;
end;
$$;

-- Schedule sweep every 5 min (idempotent: cron.schedule dedupes by name).
select cron.schedule(
  'notif_email_sweep',
  '*/5 * * * *',
  $$select public.sweep_pending_notification_emails();$$
)
where not exists (select 1 from cron.job where jobname = 'notif_email_sweep');

-- ----------------------------------------------------------------------------
-- 4) Realtime — add notifications table to the supabase_realtime publication so
--    the NotificationBell can subscribe to INSERT events and update instantly.
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end$$;
