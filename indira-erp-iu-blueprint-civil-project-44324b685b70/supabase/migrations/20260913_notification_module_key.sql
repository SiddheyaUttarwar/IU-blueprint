-- Adds notifications.module_key so we can trace which notification_modules a row belongs to.
-- Populated client-side by src/lib/notify.js via its TYPE_TO_MODULE map. Nullable so pre-existing
-- rows keep working; a null value means "unmapped type" (still delivered — gating is a no-op).
-- Idempotent: safe to re-run.

alter table public.notifications
  add column if not exists module_key text;

create index if not exists notifications_module_key_idx
  on public.notifications (module_key)
  where email_pending = true;
