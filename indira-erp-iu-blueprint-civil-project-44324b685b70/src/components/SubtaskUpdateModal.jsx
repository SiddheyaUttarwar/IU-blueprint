import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listUpdates, addUpdate, uploadUpdateAttachment, getAttachmentSignedUrl } from '../services/subtaskUpdates.js';

const MAX_FILES = 5;
const MAX_FILE_MB = 10;

function fmtName(p) {
  if (!p) return 'Someone';
  return `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || p.email || 'Someone';
}
function fmtDate(d) { return d ? new Date(d).toLocaleDateString() : ''; }

export default function SubtaskUpdateModal({ subtask, parentTaskName, projectName, onClose, onSaved }) {
  const { profile } = useAuth();
  const toast = useToast();
  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [updateDate, setUpdateDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listUpdates(subtask.id);
        if (!cancelled) setHistory(rows);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load history.');
      } finally { if (!cancelled) setLoadingHistory(false); }
    })();
    return () => { cancelled = true; };
  }, [subtask.id, toast]);

  function onFilesPicked(e) {
    const picked = Array.from(e.target.files ?? []);
    const combined = [...files, ...picked].slice(0, MAX_FILES);
    const oversize = combined.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (oversize) { toast.error(`"${oversize.name}" exceeds ${MAX_FILE_MB} MB.`); return; }
    setFiles(combined);
    e.target.value = '';
  }

  function removeFile(i) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function openAttachment(att) {
    try {
      const url = await getAttachmentSignedUrl(att.path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) { toast.error(err.message || 'Failed to open.'); }
  }

  async function submit(e) {
    e.preventDefault();
    if (!notes.trim() && files.length === 0) { toast.error('Add a note or an attachment.'); return; }
    setBusy(true);
    try {
      const uploaded = [];
      for (const f of files) uploaded.push(await uploadUpdateAttachment(subtask.id, f));
      const saved = await addUpdate(subtask.id, profile?.id, { updateDate, notes, attachments: uploaded });
      setHistory((prev) => [saved, ...prev]);
      setNotes(''); setFiles([]);
      toast.success('Update saved.');
      onSaved?.(saved);
    } catch (err) { toast.error(err.message || 'Failed to save update.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal-card modal-card--wide">
        <h3 style={{ marginTop: 0 }}>Log daily update — {subtask.name}</h3>
        <div className="update-chip-row">
          <span className="badge-admin">{projectName}</span>
          {parentTaskName && <span className="form-hint">↳ {parentTaskName}</span>}
        </div>

        <form onSubmit={submit}>
          <label className="login-field">
            <span>Update date</span>
            <input type="date" value={updateDate} onChange={(e) => setUpdateDate(e.target.value)} required max={new Date().toISOString().slice(0, 10)} />
          </label>
          <label className="login-field">
            <span>What did you do today?</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
          </label>

          <div className="login-field">
            <span>Attachments <em className="form-hint">(optional · PDF / images / sheets · up to {MAX_FILES} files, {MAX_FILE_MB} MB each)</em></span>
            <label className="btn-secondary btn-secondary--sm" style={{ display: 'inline-flex', gap: 4, cursor: 'pointer', width: 'fit-content' }}>
              Attach files
              <input type="file" multiple style={{ display: 'none' }} onChange={onFilesPicked} disabled={busy || files.length >= MAX_FILES} accept=".pdf,image/*,.xls,.xlsx,.doc,.docx" />
            </label>
            {files.length > 0 && (
              <ul className="update-files">
                {files.map((f, i) => (
                  <li key={i}>
                    {f.name} <span className="form-hint">({Math.round(f.size / 1024)} KB)</span>
                    <button type="button" className="icon-btn" onClick={() => removeFile(i)} aria-label="Remove">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="update-history">
            <div className="update-history__title">Your update history</div>
            {loadingHistory ? <div className="form-hint">Loading…</div>
              : history.length === 0 ? <div className="form-hint">No prior updates yet.</div>
              : (
                <ul>
                  {history.map((u) => (
                    <li key={u.id} className="update-history__row">
                      <div>
                        <b>{fmtDate(u.update_date)}</b> · <span className="form-hint">{fmtName(u.author)}</span>
                        {u.notes && <div>{u.notes}</div>}
                        {Array.isArray(u.attachments) && u.attachments.length > 0 && (
                          <div className="form-hint">
                            {u.attachments.map((a, i) => (
                              <button type="button" key={i} className="update-attach-link" onClick={() => openAttachment(a)}>{a.name}</button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
          </div>

          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="btn-secondary btn-secondary--sm" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>{busy ? 'Saving…' : 'Save update'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
