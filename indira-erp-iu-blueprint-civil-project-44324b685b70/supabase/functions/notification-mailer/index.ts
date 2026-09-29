// Notification mailer — permanent auto-delivery for in-app + email notifications.
// Sends via plain SMTP (denomailer). Works with any provider: Google Workspace / Gmail,
// Microsoft 365 / Outlook, your own mail server, AWS SES SMTP, SendGrid SMTP, etc.
//
// Two entry paths:
//   POST { notification_id, secret }        ← fired by the Postgres AFTER INSERT trigger
//   GET  ?sweep=1                           ← fired by pg_cron every 5 minutes as fallback
//
// Env vars (set with `supabase functions secrets set …` OR in Dashboard → Secrets):
//   NOTIFICATION_WEBHOOK_SECRET   must match app_settings.notification_webhook_secret
//   SMTP_HOST                     e.g. smtp.gmail.com  |  smtp.office365.com  |  mail.indiraedu.com
//   SMTP_PORT                     usually 587 (STARTTLS) or 465 (implicit TLS)
//   SMTP_USER                     full email of the sending mailbox
//   SMTP_PASS                     app password / mailbox password
//   SMTP_TLS                      'starttls' (587) | 'implicit' (465). Defaults to 'starttls'.
//   MAIL_FROM                     e.g. "Indira BluePrint <no-reply@indiraedu.com>"

import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { adminClient } from '../_shared/supabaseAdmin.ts';

const SWEEP_BATCH = 100;

type NotificationRow = {
  id: string;
  type: string;
  message: string;
  email_to: string | null;
  email_pending: boolean;
  email_sent_at: string | null;
  created_at: string | null;
  subject_profile_id: string | null;
};

type EmailContext = {
  authorName: string | null;
  projectName: string | null;
};

async function enrichNotification(supa: ReturnType<typeof adminClient>, n: NotificationRow): Promise<EmailContext> {
  let authorName: string | null = null;
  let projectName: string | null = null;
  if (n.subject_profile_id) {
    const { data } = await supa.from('profiles')
      .select('first_name, last_name')
      .eq('id', n.subject_profile_id).maybeSingle();
    if (data) {
      const full = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim();
      authorName = full || null;
    }
  }
  const projMatch = String(n.message ?? '').match(/#project=([\w-]+)/);
  if (projMatch) {
    const { data } = await supa.from('projects')
      .select('name').eq('id', projMatch[1]).maybeSingle();
    projectName = data?.name ?? null;
  }
  return { authorName, projectName };
}

// #msg=<uuid> and #project=<uuid> markers are used by the in-app bell to build a deep link.
// Strip them from human-facing email text and turn them into a real clickable URL using APP_URL.
function extractDeepLink(message: string): string | null {
  const appUrl = (Deno.env.get('APP_URL') ?? '').replace(/\/$/, '');
  if (!appUrl) return null;
  const projMatch = message.match(/#project=([\w-]+)/);
  if (!projMatch) return null;
  const msgMatch = message.match(/#msg=([\w-]+)/);
  return msgMatch
    ? `${appUrl}/projects/${projMatch[1]}#msg-${msgMatch[1]}`
    : `${appUrl}/projects/${projMatch[1]}`;
}

function stripMarkers(message: string): string {
  return message.replace(/#msg=[\w-]+/g, '').replace(/#project=[\w-]+/g, '').trim();
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata',
    });
  } catch { return iso; }
}

function subjectForType(type: string, ctx: EmailContext): string {
  const suffix = ctx.projectName ? ` — ${ctx.projectName}` : '';
  switch (type) {
    case 'status_request_pending':  return `[BluePrint] Approval needed — project status change${suffix}`;
    case 'status_request_approved': return `[BluePrint] Your status request was approved${suffix}`;
    case 'status_request_rejected': return `[BluePrint] Your status request was rejected${suffix}`;
    case 'baseline_pending':        return `[BluePrint] Approval needed — baseline change${suffix}`;
    case 'baseline_pending_receipt':return `[BluePrint] Your baseline change is awaiting approval${suffix}`;
    case 'baseline_approved':       return `[BluePrint] Your baseline change was approved${suffix}`;
    case 'baseline_rejected':       return `[BluePrint] Your baseline change was rejected${suffix}`;
    case 'baseline_dates_changed':  return `[BluePrint] Task dates updated${suffix}`;
    case 'message_mention':         return `[BluePrint] You were mentioned${suffix}`;
    case 'message_posted':          return `[BluePrint] New message${suffix}`;
    case 'task_assigned':           return `[BluePrint] Task assigned${suffix}`;
    case 'task_update':             return `[BluePrint] Task update${suffix}`;
    case 'project_started':         return `[BluePrint] Project started${suffix}`;
    case 'indent_delivery':         return `[BluePrint] Delivery logged${suffix}`;
    case 'indent_item_added':       return `[BluePrint] New indent item${suffix}`;
    case 'document_uploaded':       return `[BluePrint] New document${suffix}`;
    case 'funding_change':          return `[BluePrint] Funding changed${suffix}`;
    case 'budget_change':           return `[BluePrint] Budget changed${suffix}`;
    case 'milestone_soon':          return `[BluePrint] Milestone approaching${suffix}`;
    default:                        return `[BluePrint] Notification${suffix}`;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlBody(message: string, headline: string, createdAt: string | null, ctx: EmailContext): string {
  const cleaned = stripMarkers(String(message ?? ''));
  const safe = esc(cleaned).replace(/\n/g, '<br>');
  const link = extractDeepLink(String(message ?? ''));
  const when = fmtDate(createdAt);
  const metaBits: string[] = [];
  if (ctx.authorName) metaBits.push(`By <b>${esc(ctx.authorName)}</b>`);
  if (when) metaBits.push(esc(when));
  const metaLine = metaBits.length
    ? `<p style="color:#6b7d8f; font-size:12px; margin:0 0 12px;">${metaBits.join(' · ')}</p>`
    : '';
  const projectRow = ctx.projectName
    ? `<p style="margin:4px 0 8px; color:#155685; font-size:14px;"><b>Project:</b> ${esc(ctx.projectName)}</p>`
    : '';
  const button = link
    ? `<p style="margin:18px 0;"><a href="${esc(link)}" style="display:inline-block; padding:10px 18px; background:#155685; color:#fff; text-decoration:none; border-radius:4px; font-weight:600;">View in BluePrint →</a></p>`
    : '';
  return `<!doctype html>
<html><body style="font-family:Segoe UI, Arial, sans-serif; color:#1c2b3a; line-height:1.5;">
  <h2 style="color:#155685; margin:0 0 8px;">${esc(headline)}</h2>
  ${projectRow}
  ${metaLine}
  <div style="padding:14px; background:#f5f7fa; border-left:4px solid #6d5eea; border-radius:4px; white-space:pre-wrap;">
    ${safe}
  </div>
  ${button}
  <p style="color:#6b7d8f; font-size:12px; margin-top:16px;">
    You are receiving this because you follow this project on Indira BluePrint.
  </p>
</body></html>`;
}

function textBody(message: string, createdAt: string | null, ctx: EmailContext, link: string | null): string {
  const cleaned = stripMarkers(String(message ?? ''));
  const lines: string[] = [];
  if (ctx.projectName) lines.push(`Project: ${ctx.projectName}`);
  if (ctx.authorName) lines.push(`By: ${ctx.authorName}`);
  const when = fmtDate(createdAt);
  if (when) lines.push(`When: ${when}`);
  if (lines.length) lines.push('');
  lines.push(cleaned);
  if (link) { lines.push(''); lines.push(`View in BluePrint: ${link}`); }
  return lines.join('\n');
}

// Reuse one SMTP connection across a single function invocation.
let cachedClient: SMTPClient | null = null;
function getSmtpClient(): SMTPClient {
  if (cachedClient) return cachedClient;
  const host = Deno.env.get('SMTP_HOST');
  const port = Number(Deno.env.get('SMTP_PORT') ?? '587');
  const user = Deno.env.get('SMTP_USER');
  const pass = Deno.env.get('SMTP_PASS');
  const tls = (Deno.env.get('SMTP_TLS') ?? 'starttls').toLowerCase();
  if (!host || !user || !pass) throw new Error('SMTP_HOST / SMTP_USER / SMTP_PASS not set');
  cachedClient = new SMTPClient({
    connection: {
      hostname: host,
      port,
      // implicit TLS (465) vs STARTTLS (587)
      tls: tls === 'implicit',
      auth: { username: user, password: pass },
    },
  });
  return cachedClient;
}

async function sendSmtp(to: string, subject: string, text: string, html: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const from = Deno.env.get('MAIL_FROM') ?? Deno.env.get('SMTP_USER') ?? '';
  if (!from) return { ok: false, error: 'MAIL_FROM not set' };
  try {
    const client = getSmtpClient();
    await client.send({ from, to, subject, content: text, html });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function deliver(supa: ReturnType<typeof adminClient>, n: NotificationRow): Promise<boolean> {
  if (!n.email_to || n.email_sent_at) return false;
  const ctx = await enrichNotification(supa, n);
  const subject = subjectForType(n.type, ctx);
  const headline = subject.replace('[BluePrint] ', '');
  const link = extractDeepLink(n.message);
  const text = textBody(n.message, n.created_at, ctx, link);
  const html = htmlBody(n.message, headline, n.created_at, ctx);
  const result = await sendSmtp(n.email_to, subject, text, html);
  if (!result.ok) {
    console.error(`[notification-mailer] send failed for ${n.id}: ${result.error}`);
    return false;
  }
  const { error } = await supa
    .from('notifications')
    .update({ email_pending: false, email_sent_at: new Date().toISOString() })
    .eq('id', n.id)
    .is('email_sent_at', null); // idempotent — only clear if still unsent
  if (error) console.error(`[notification-mailer] mark-sent failed for ${n.id}: ${error.message}`);
  return true;
}

async function handleTrigger(supa: ReturnType<typeof adminClient>, notificationId: string) {
  const { data, error } = await supa
    .from('notifications')
    .select('id, type, message, email_to, email_pending, email_sent_at, created_at, subject_profile_id')
    .eq('id', notificationId)
    .single();
  if (error || !data) return { sent: 0, error: error?.message ?? 'not found' };
  const ok = await deliver(supa, data as NotificationRow);
  return { sent: ok ? 1 : 0 };
}

async function handleSweep(supa: ReturnType<typeof adminClient>) {
  const { data, error } = await supa
    .from('notifications')
    .select('id, type, message, email_to, email_pending, email_sent_at, created_at, subject_profile_id')
    .eq('email_pending', true)
    .is('email_sent_at', null)
    .not('email_to', 'is', null)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: true })
    .limit(SWEEP_BATCH);
  if (error) return { sent: 0, error: error.message };
  let sent = 0;
  for (const row of (data ?? [])) {
    const ok = await deliver(supa, row as NotificationRow);
    if (ok) sent += 1;
  }
  return { sent, checked: data?.length ?? 0 };
}

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supa = adminClient();
    const url = new URL(req.url);
    const wantSweep = req.method === 'GET' || url.searchParams.get('sweep') === '1';

    if (req.method === 'POST' && !wantSweep) {
      const body = await req.json().catch(() => ({}));
      const expected = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET') ?? '';
      if (expected && body?.secret !== expected) {
        return new Response(JSON.stringify({ ok: false, error: 'invalid secret' }), {
          status: 401, headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
      if (!body?.notification_id) {
        return new Response(JSON.stringify({ ok: false, error: 'notification_id required' }), {
          status: 400, headers: { ...corsHeaders, 'content-type': 'application/json' },
        });
      }
      const res = await handleTrigger(supa, body.notification_id);
      try { await cachedClient?.close(); } catch { /* ignore */ }
      cachedClient = null;
      return new Response(JSON.stringify({ ok: true, ...res }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      });
    }

    const res = await handleSweep(supa);
    try { await cachedClient?.close(); } catch { /* ignore */ }
    cachedClient = null;
    return new Response(JSON.stringify({ ok: true, ...res }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }
}

Deno.serve(handler);
