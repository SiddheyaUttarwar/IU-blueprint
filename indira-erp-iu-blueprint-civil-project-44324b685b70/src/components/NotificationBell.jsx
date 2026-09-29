import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { countUnread, listMyNotifications, markAllRead, markRead, ensureMilestoneAlerts } from '../services/notifications.js';
import { supabase } from '../lib/supabaseClient.js';
import { IconBell } from './Icons.jsx';

// Extract "#msg=<uuid>" and "#project=<uuid>" markers from notification body
// and build the deep-link URL. Used for mentions in project messages.
function parseDeepLink(message) {
  if (!message) return null;
  const projMatch = message.match(/#project=([\w-]+)/);
  const msgMatch = message.match(/#msg=([\w-]+)/);
  if (!projMatch) return null;
  return msgMatch ? `/projects/${projMatch[1]}#msg-${msgMatch[1]}` : `/projects/${projMatch[1]}`;
}
function displayText(message) {
  if (!message) return '';
  return message.replace(/#msg=[\w-]+/g, '').replace(/#project=[\w-]+/g, '').trim();
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function NotificationBell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!profile?.id) return;
    ensureMilestoneAlerts(profile.id).catch(() => {}).finally(() => {
      countUnread(profile.id).then(setUnread).catch(() => {});
    });
    // Realtime — bump the badge as soon as a row is inserted for this user.
    // Requires `alter publication supabase_realtime add table public.notifications` (done in migration).
    const channel = supabase
      .channel(`notif-${profile.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `recipient_profile_id=eq.${profile.id}` },
        (payload) => {
          setUnread((u) => u + 1);
          setItems((prev) => [payload.new, ...prev].slice(0, 20));
        },
      )
      .subscribe();
    // Periodic re-poll safety net (30s) in case the realtime channel drops.
    const poll = setInterval(() => {
      countUnread(profile.id).then(setUnread).catch(() => {});
    }, 30000);
    return () => {
      supabase.removeChannel(channel);
      clearInterval(poll);
    };
  }, [profile?.id]);

  useEffect(() => {
    function onClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || !profile?.id) return;
    setLoading(true);
    try {
      const rows = await listMyNotifications(profile.id);
      setItems(rows);
      await markAllRead(profile.id);
      setUnread(0);
    } finally {
      setLoading(false);
    }
  }

  if (!profile) return null;

  return (
    <div className="bell" ref={dropdownRef}>
      <button
        type="button"
        className="bell__button"
        onClick={toggle}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <IconBell />
        {unread > 0 && <span className="bell__badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell__dropdown" role="menu">
          <div className="bell__dropdown-header">Notifications</div>
          {loading ? (
            <div className="bell__empty">Loading…</div>
          ) : items.length === 0 ? (
            <div className="bell__empty">No notifications yet.</div>
          ) : (
            <ul className="bell__list">
              {(() => {
                // BUG-21: collapse duplicates emitted by upstream side-effects (e.g. two rows for
                // the same first-login event). Same recipient + type + message + minute window collapse to one.
                const seen = new Set();
                const deduped = [];
                for (const n of items) {
                  const minute = n.created_at ? String(n.created_at).slice(0, 16) : '';
                  const key = `${n.type}::${n.message}::${minute}`;
                  if (seen.has(key)) continue;
                  seen.add(key);
                  deduped.push(n);
                }
                return deduped;
              })().map((n) => {
                const link = parseDeepLink(n.message);
                const text = displayText(n.message);
                const onClick = link ? async () => {
                  try { if (!n.read_at) await markRead(n.id); } catch { /* ignore */ }
                  setOpen(false);
                  navigate(link);
                } : undefined;
                const iso = n.created_at ? new Date(n.created_at).toISOString() : undefined;
                const absolute = n.created_at ? new Date(n.created_at).toLocaleString() : '';
                return (
                  <li
                    key={n.id}
                    className={`bell__item${n.read_at ? '' : ' is-unread'}${link ? ' bell__item--linkable' : ''}`}
                    onClick={onClick}
                    role={link ? 'button' : undefined}
                  >
                    <div className="bell__item-message">{text}</div>
                    {/* BUG-22: absolute timestamp available via title tooltip AND <time datetime> for machine parsing. */}
                    <time className="bell__item-time" dateTime={iso} title={absolute}>{timeAgo(n.created_at)} · {absolute}</time>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
