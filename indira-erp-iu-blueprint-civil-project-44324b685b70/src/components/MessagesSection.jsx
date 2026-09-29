import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listMessages, postMessage, deleteMessage, uploadMessageAttachment, getMessageAttachmentUrl } from '../services/projectMessages.js';
import { listProfiles } from '../services/profiles.js';
import { getProjectStructure } from '../services/projects.js';
import { IconTrash } from './Icons.jsx';

const MAX_ATTACHMENTS = 10;
const MAX_FILE_MB = 2;
const ACCEPT = '.pdf,image/jpeg,image/png';
const HASHTAG_RE = /#([a-zA-Z][a-zA-Z0-9_-]{1,30})(?!\S)/g;

function fmtAuthor(a) {
  if (!a) return 'Someone';
  const full = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();
  return full || a.email || 'Someone';
}
function fmtWhen(d) {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}
function isImage(mime) { return mime?.startsWith('image/'); }

function extractHashtags(body) {
  const set = new Set();
  for (const m of body.matchAll(HASHTAG_RE)) set.add(m[1].toLowerCase());
  return Array.from(set);
}

function extractMentions(body, profiles) {
  const matches = new Set();
  const norm = (s) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  // Token is a single word after '@' — no whitespace inside. norm() strips '@' so we compare without it.
  const tokenRe = /@([a-zA-Z][a-zA-Z0-9._-]{0,40})/g;
  const typedTokens = new Set();
  for (const m of body.matchAll(tokenRe)) typedTokens.add(norm(m[1]));
  if (typedTokens.size === 0) return [];
  for (const p of profiles) {
    const first = (p.first_name ?? '').trim();
    const last = (p.last_name ?? '').trim();
    const full = `${first} ${last}`.trim();
    const emailPrefix = (p.email ?? '').split('@')[0];
    const initialLast = first && last ? `${first[0]}${last}` : '';
    const candidates = [full, first, last, emailPrefix, initialLast].filter(Boolean).map(norm);
    for (const cand of candidates) {
      for (const t of typedTokens) {
        if (t.startsWith(cand) || cand.startsWith(t)) { matches.add(p.id); break; }
      }
      if (matches.has(p.id)) break;
    }
  }
  return Array.from(matches);
}

// Render body with three chip types: task/milestone (*[Name]), user (@Name), hashtag (#tag).
// Known task chips become clickable links that jump to the task row via onJumpTo.
function renderBody(body, onTag, taskByName, onJumpTo) {
  // *[Task Name]  → task/subtask/milestone reference (clickable to jump)
  // @Name         → member mention
  // #hashtag      → free-form hashtag
  const parts = body.split(/(\*\[[^\]]{1,80}\]|#\[[^\]]{1,80}\]|@[a-zA-Z][a-zA-Z0-9._-]+(?:\s[A-Z][a-zA-Z0-9._-]+)?|#[a-zA-Z][a-zA-Z0-9_-]{1,30})/g);
  return parts.map((p, i) => {
    if (!p) return null;
    // Task/subtask/milestone reference — either *[Name] (new) or legacy #[Name].
    if ((p.startsWith('*[') || p.startsWith('#[')) && p.endsWith(']')) {
      const name = p.slice(2, -1);
      const target = taskByName?.get(name.toLowerCase());
      if (target && onJumpTo) {
        return (
          <button
            key={i} type="button" className="msg-taskref is-known is-link"
            onClick={() => onJumpTo(target)}
            title={`Jump to "${name}"`}
          >*{name}</button>
        );
      }
      return <span key={i} className="msg-taskref" title="No matching item in this project">*{name}</span>;
    }
    if (p.startsWith('#')) return <span key={i} className="msg-hashtag" onClick={() => onTag?.(p.slice(1).toLowerCase())}>{p}</span>;
    if (p.startsWith('@')) return <span key={i} className="msg-mention">{p}</span>;
    return <span key={i}>{p}</span>;
  });
}

export default function MessagesSection({ project, onJumpToTask }) {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const [messages, setMessages] = useState([]);
  const [participants, setParticipants] = useState([]);
  const [items, setItems] = useState([]); // { id, name, kind: 'task'|'subtask'|'milestone' }
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [hashtagFilter, setHashtagFilter] = useState(null);
  // Trigger state for inline picker
  const [picker, setPicker] = useState(null); // { kind: '@'|'#', query, startIndex, activeIndex }
  const textareaRef = useRef(null);

  const isCompleted = project?.status === 'completed';

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rows, profs, struct] = await Promise.all([
          listMessages(project.id),
          listProfiles().catch(() => []),
          getProjectStructure(project.id).catch(() => ({ tasks: [], milestones: [] })),
        ]);
        if (cancelled) return;
        setMessages(rows);
        setParticipants(profs);
        const list = [];
        for (const t of (struct.tasks ?? [])) list.push({ id: t.id, name: t.name, kind: t.parent_task_id ? 'subtask' : 'task' });
        for (const m of (struct.milestones ?? [])) list.push({ id: m.id, name: m.name, kind: 'milestone' });
        setItems(list);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load messages.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [project.id, toast]);

  useEffect(() => {
    if (!location.hash?.startsWith('#msg-')) return;
    if (messages.length === 0) return;
    const id = location.hash.slice(5);
    const el = document.getElementById(`msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('msg-highlight');
      const t = setTimeout(() => el.classList.remove('msg-highlight'), 2500);
      return () => clearTimeout(t);
    }
  }, [location.hash, messages]);

  const hashtagCloud = useMemo(() => {
    const counts = new Map();
    for (const m of messages) for (const tag of (m.hashtags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 20);
  }, [messages]);

  const filteredMessages = useMemo(() => {
    if (!hashtagFilter) return messages;
    return messages.filter((m) => (m.hashtags ?? []).includes(hashtagFilter));
  }, [messages, hashtagFilter]);

  // Name → item metadata for deep-link jumps. Skip milestones (jump-to only for tasks/subtasks).
  const taskByName = useMemo(() => {
    const m = new Map();
    for (const it of items) if (it.kind !== 'milestone') m.set(it.name.toLowerCase(), { id: it.id, kind: it.kind });
    return m;
  }, [items]);

  // ------- Inline picker logic ---------------------------------------------
  // Triggers: '@' → project members, '*' → project tasks/subtasks/milestones, '#' → free-form hashtag (no picker).
  function detectTrigger(text, cursor) {
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = text[i];
      if (ch === '@' || ch === '*') {
        const prev = i === 0 ? ' ' : text[i - 1];
        if (/\s|^/.test(prev)) {
          const query = text.slice(i + 1, cursor);
          if (!/\s/.test(query)) return { kind: ch, query, startIndex: i };
        }
        return null;
      }
      if (/\s/.test(ch)) return null;
    }
    return null;
  }

  function handleTextareaChange(e) {
    const val = e.target.value;
    setBody(val);
    const cursor = e.target.selectionStart ?? val.length;
    const trig = detectTrigger(val, cursor);
    if (trig) setPicker({ ...trig, activeIndex: 0 });
    else setPicker(null);
  }
  function handleTextareaKeyDown(e) {
    if (!picker) return;
    const options = pickerOptions();
    if (!options.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setPicker((p) => ({ ...p, activeIndex: (p.activeIndex + 1) % options.length })); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setPicker((p) => ({ ...p, activeIndex: (p.activeIndex - 1 + options.length) % options.length })); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertPicked(options[picker.activeIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); setPicker(null); }
  }

  function pickerOptions() {
    if (!picker) return [];
    const q = picker.query.toLowerCase();
    if (picker.kind === '@') {
      return participants.filter((p) => {
        const label = fmtAuthor(p).toLowerCase();
        const email = (p.email ?? '').toLowerCase();
        return label.includes(q) || email.includes(q);
      }).slice(0, 8);
    }
    // '*' — project-scoped tasks/subtasks/milestones
    return items.filter((it) => it.name.toLowerCase().includes(q)).slice(0, 8);
  }

  function insertPicked(option) {
    if (!picker) return;
    setBody((prev) => {
      const before = prev.slice(0, picker.startIndex);
      const after = prev.slice(picker.startIndex + 1 + picker.query.length);
      const insert = picker.kind === '@'
        ? `@${fmtAuthor(option).replace(/\s+/g, '')} `
        : `*[${option.name}] `;
      return `${before}${insert}${after}`;
    });
    setPicker(null);
    setTimeout(() => textareaRef.current?.focus(), 0);
  }

  function onFilesPicked(e) {
    const picked = Array.from(e.target.files ?? []);
    if (pendingFiles.length + picked.length > MAX_ATTACHMENTS) {
      toast.error(`Max ${MAX_ATTACHMENTS} attachments per message.`); return;
    }
    const oversized = picked.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (oversized) { toast.error(`"${oversized.name}" exceeds ${MAX_FILE_MB} MB.`); return; }
    const wrongType = picked.find((f) => !['application/pdf', 'image/jpeg', 'image/png'].includes(f.type));
    if (wrongType) { toast.error(`"${wrongType.name}" is not PDF / JPG / PNG.`); return; }
    setPendingFiles((prev) => [...prev, ...picked]);
    e.target.value = '';
  }
  function removePendingFile(i) { setPendingFiles((prev) => prev.filter((_, idx) => idx !== i)); }

  async function send(e) {
    e.preventDefault();
    if (isCompleted) { toast.error('Project is completed — messages are read-only.'); return; }
    if (!body.trim() && pendingFiles.length === 0) return;
    setBusy(true);
    try {
      const uploaded = [];
      for (const f of pendingFiles) uploaded.push(await uploadMessageAttachment(project.id, f));
      const mentions = extractMentions(body, participants);
      const hashtags = extractHashtags(body);
      const created = await postMessage(project.id, profile?.id, body, {
        attachments: uploaded, mentions, hashtags,
      });
      setMessages((prev) => [created, ...prev]);
      setBody(''); setPendingFiles([]); setPicker(null);
    } catch (err) { toast.error(err.message || 'Failed to send.'); }
    finally { setBusy(false); }
  }

  async function remove(m) {
    if (!window.confirm('Delete this message?')) return;
    try {
      await deleteMessage(m.id);
      setMessages((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) { toast.error(err.message || 'Failed to delete.'); }
  }
  async function openAttachment(a) {
    try {
      const url = await getMessageAttachmentUrl(a.path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) { toast.error(err.message || 'Failed to open.'); }
  }

  const maxCount = hashtagCloud[0]?.[1] ?? 1;
  const options = pickerOptions();

  return (
    <section className="msg-shell" style={{ marginTop: 16 }}>
      <div className="card msg-main">
        {loading ? (
          <div className="msg-empty"><div className="msg-empty__icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </div><div>Loading…</div></div>
        ) : filteredMessages.length === 0 ? (
          <div className="msg-empty">
            <div className="msg-empty__icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
            </div>
            <div>{hashtagFilter ? `No messages with #${hashtagFilter}.` : 'No messages yet. Start the conversation.'}</div>
          </div>
        ) : (
          <ul className="msg-list">
            {filteredMessages.map((m) => {
              const mine = m.author_id && m.author_id === profile?.id;
              return (
                <li key={m.id} id={`msg-${m.id}`} className="msg-list__item">
                  <div className="msg-list__meta">
                    <b>{fmtAuthor(m.author)}</b>
                    <span className="form-hint"> · {fmtWhen(m.created_at)}</span>
                    {(m.mentions ?? []).length > 0 && (
                      <span className="msg-mention-count">Mentions: {m.mentions.length}</span>
                    )}
                    {(mine || isAdmin) && !isCompleted && (
                      <button type="button" className="icon-btn icon-btn--danger msg-list__del" onClick={() => remove(m)} aria-label="Delete message">
                        <IconTrash />
                      </button>
                    )}
                  </div>
                  <div className="msg-list__body">{renderBody(m.body, setHashtagFilter, taskByName, onJumpToTask)}</div>
                  {(m.attachments ?? []).length > 0 && (
                    <ul className="msg-attachments">
                      {(m.attachments ?? []).map((a, i) => (
                        <li key={i}>
                          <button type="button" className="msg-attach-link" onClick={() => openAttachment(a)}>
                            {isImage(a.mime) ? 'Image' : 'File'}: {a.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="msg-compose-wrap">
          <form onSubmit={send} className="msg-compose">
            <div style={{ position: 'relative' }}>
              <textarea
                ref={textareaRef}
                value={body}
                onChange={handleTextareaChange}
                onKeyDown={handleTextareaKeyDown}
                onBlur={() => setTimeout(() => setPicker(null), 150)}
                placeholder="Write a message… @ tag a user, * link a task/milestone, # add a hashtag"
                rows={2}
                maxLength={4000}
                className="msg-textarea"
                disabled={isCompleted}
              />
              {picker && options.length > 0 && (
                <div className="inline-picker" role="listbox">
                  <div className="inline-picker__hint">
                    {picker.kind === '@' ? 'Tag user' : 'Link task / milestone'}
                    {picker.query && <span className="form-hint"> · matching &ldquo;{picker.query}&rdquo;</span>}
                  </div>
                  {options.map((o, i) => (
                    <button
                      type="button"
                      key={picker.kind === '@' ? o.id : `${o.kind}-${o.id}`}
                      className={`inline-picker__item${i === picker.activeIndex ? ' is-active' : ''}`}
                      onMouseDown={(e) => { e.preventDefault(); insertPicked(o); }}
                      onMouseEnter={() => setPicker((p) => p && { ...p, activeIndex: i })}
                    >
                      {picker.kind === '@' ? (
                        <>
                          <span className="inline-picker__label">{fmtAuthor(o)}</span>
                          <span className="inline-picker__meta">{o.email}</span>
                        </>
                      ) : (
                        <>
                          <span className={`inline-picker__kind inline-picker__kind--${o.kind}`}>{o.kind}</span>
                          <span className="inline-picker__label">{o.name}</span>
                        </>
                      )}
                    </button>
                  ))}
                  <div className="inline-picker__foot">↑ ↓ to navigate · Enter to insert · Esc to close</div>
                </div>
              )}
            </div>
            <div className="msg-compose__bar">
              <div className="msg-compose__left">
                <label className={`msg-attach-btn${isCompleted ? ' is-disabled' : ''}`} title="Attach files">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>Attach</span>
                  <input type="file" multiple accept={ACCEPT} onChange={onFilesPicked} style={{ display: 'none' }} disabled={isCompleted} />
                </label>
                <span className="form-hint">PDF / JPG / PNG · max {MAX_ATTACHMENTS} · {MAX_FILE_MB} MB each</span>
              </div>
              <button type="submit" className="btn-primary btn-primary--sm msg-send-btn" disabled={busy || isCompleted || (!body.trim() && pendingFiles.length === 0)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                <span>{busy ? 'Sending…' : 'Send'}</span>
              </button>
            </div>
            {pendingFiles.length > 0 && (
              <ul className="msg-attach-preview">
                {pendingFiles.map((f, i) => (
                  <li key={i}>
                    {isImage(f.type) ? 'Image' : 'File'}: {f.name}
                    <button type="button" className="icon-btn" onClick={() => removePendingFile(i)} aria-label="Remove">×</button>
                  </li>
                ))}
              </ul>
            )}
          </form>
        </div>
      </div>

      <aside className="msg-side">
        <div className="card msg-side__card">
          <div className="msg-side__title">
            <span aria-hidden="true">#</span> Hashtag cloud
          </div>
          {hashtagCloud.length === 0 ? (
            <div className="form-hint">No hashtags yet — start a message with #foundation or similar.</div>
          ) : (
            <>
              {hashtagFilter && (
                <div className="hashtag-filter-note">
                  Filtered by <b>#{hashtagFilter}</b>
                  <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setHashtagFilter(null)}>Clear</button>
                </div>
              )}
              <div className="msg-side__cloud">
                {hashtagCloud.map(([tag, count]) => {
                  const size = 11 + Math.round((count / maxCount) * 10);
                  return (
                    <button
                      key={tag} type="button"
                      className={`hashtag-cloud__tag${hashtagFilter === tag ? ' is-active' : ''}`}
                      style={{ fontSize: size }}
                      onClick={() => setHashtagFilter(hashtagFilter === tag ? null : tag)}
                      title={`${count} mention${count === 1 ? '' : 's'}`}
                    >#{tag}</button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </aside>
    </section>
  );
}
