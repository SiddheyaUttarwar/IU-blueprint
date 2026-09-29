import { useEffect, useMemo, useState } from 'react';
import JSZip from 'jszip';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { listDocuments, uploadDocument, getDocumentSignedUrl, deleteDocument } from '../services/projectDocuments.js';
import { getProjectStructure } from '../services/projects.js';
import { IconPlus, IconTrash } from './Icons.jsx';

const ACCEPT_MIME = '.pdf,.doc,.docx,.xls,.xlsx,image/*';

function fmtName(a) {
  if (!a) return 'Someone';
  const full = `${a.first_name ?? ''} ${a.last_name ?? ''}`.trim();
  return full || a.email || 'Someone';
}
function fmtSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function fmtWhen(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString();
}
function typeBadge(mime) {
  if (!mime) return 'File';
  if (mime.startsWith('image/')) return 'Image';
  if (mime === 'application/pdf') return 'PDF';
  if (mime.includes('spreadsheet') || mime.includes('excel')) return 'Excel';
  if (mime.includes('word') || mime.includes('officedocument.wordprocessing')) return 'Word';
  return 'File';
}

export default function DocumentsSection({ project }) {
  const { profile, isAdmin } = useAuth();
  const toast = useToast();
  const [docs, setDocs] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // { file, displayName, taskId }
  const [selected, setSelected] = useState(new Set());
  const [zipping, setZipping] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rows, s] = await Promise.all([
          listDocuments(project.id),
          getProjectStructure(project.id).catch(() => ({ tasks: [] })),
        ]);
        if (cancelled) return;
        setDocs(rows);
        setTasks(s.tasks ?? []);
      } catch (err) {
        if (!cancelled) toast.error(err.message || 'Failed to load documents.');
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [project.id, toast]);

  const taskOptions = useMemo(() => tasks.map((t) => ({ id: t.id, name: t.name, isSub: !!t.parent_task_id })), [tasks]);

  function onFilePicked(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setModal({ file, displayName: file.name.replace(/\.[^.]+$/, ''), taskId: '' });
    e.target.value = '';
  }

  async function commitUpload(e) {
    e?.preventDefault();
    if (!modal) return;
    setBusy(true);
    try {
      const created = await uploadDocument(project.id, modal.file, profile?.id, {
        displayName: modal.displayName,
        taskId: modal.taskId || null,
      });
      setDocs((prev) => [created, ...prev]);
      setModal(null);
      toast.success('Document uploaded.');
    } catch (err) { toast.error(err.message || 'Upload failed.'); }
    finally { setBusy(false); }
  }

  async function openDoc(d) {
    try {
      const url = await getDocumentSignedUrl(d.file_path, 300);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) { toast.error(err.message || 'Could not open.'); }
  }

  async function downloadSingle(d) {
    try {
      const url = await getDocumentSignedUrl(d.file_path, 300);
      if (!url) throw new Error('Could not resolve URL.');
      const resp = await fetch(url);
      const blob = await resp.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = d.display_name || d.name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (err) { toast.error(err.message || 'Download failed.'); }
  }

  function toggleSel(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function selectAll(check) {
    setSelected(check ? new Set(docs.map((d) => d.id)) : new Set());
  }

  async function downloadZip() {
    const list = docs.filter((d) => selected.has(d.id));
    if (!list.length) return;
    setZipping(true);
    try {
      const zip = new JSZip();
      const used = new Set();
      for (const d of list) {
        const url = await getDocumentSignedUrl(d.file_path, 300);
        if (!url) continue;
        const resp = await fetch(url);
        const buf = await resp.arrayBuffer();
        let name = d.display_name || d.name;
        // Ensure unique filenames inside the zip
        let candidate = name; let i = 2;
        while (used.has(candidate)) { candidate = `${name.replace(/(\.[^.]+)?$/, `_${i}$1`)}`; i++; }
        used.add(candidate);
        zip.file(candidate, buf);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${project.name.replace(/[^\w-]+/g, '_')}-documents.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      toast.success(`Downloaded ${list.length} file${list.length === 1 ? '' : 's'} as ZIP.`);
      setSelected(new Set());
    } catch (err) { toast.error(err.message || 'ZIP failed.'); }
    finally { setZipping(false); }
  }

  async function remove(d) {
    if (!window.confirm(`Delete "${d.display_name || d.name}"?`)) return;
    try {
      await deleteDocument(d);
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
    } catch (err) { toast.error(err.message || 'Failed to delete.'); }
  }

  return (
    <section className="card" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h3 className="masters-section__title" style={{ marginTop: 0 }}>Documents</h3>
          <div className="form-hint">Images / PDF / Excel / Word — up to 25 MB per file. Optionally link to a task.</div>
        </div>
        <label className="btn-primary btn-primary--sm" style={{ cursor: busy ? 'not-allowed' : 'pointer' }}>
          <IconPlus /> {busy ? 'Uploading…' : 'Upload'}
          <input type="file" style={{ display: 'none' }} accept={ACCEPT_MIME} disabled={busy} onChange={onFilePicked} />
        </label>
      </div>

      {loading ? (
        <div className="masters-users__empty">Loading…</div>
      ) : docs.length === 0 ? (
        <div className="masters-users__empty">No documents yet.</div>
      ) : (
        <>
          {selected.size > 0 && (
            <div className="docs-selection-bar">
              <span>{selected.size} selected</span>
              <button type="button" className="btn-primary btn-primary--sm" disabled={zipping} onClick={downloadZip}>
                {zipping ? 'Zipping…' : `Download selected as ZIP`}
              </button>
              <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          )}
          <div className="docs-table">
            <div className="docs-table__row docs-table__row--head">
              <div><input type="checkbox" checked={docs.length > 0 && selected.size === docs.length} onChange={(e) => selectAll(e.target.checked)} aria-label="Select all" /></div>
              <div>Name</div><div>Type</div><div>Linked task</div><div>Uploader</div><div>Date</div><div>Size</div><div />
            </div>
            {docs.map((d) => {
              const mine = d.uploaded_by && d.uploaded_by === profile?.id;
              return (
                <div key={d.id} className="docs-table__row">
                  <div><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleSel(d.id)} aria-label={`Select ${d.display_name || d.name}`} /></div>
                  <div><button type="button" className="docs-list__name" onClick={() => openDoc(d)}>{d.display_name || d.name}</button></div>
                  <div><span className="doc-type-badge">{typeBadge(d.mime_type)}</span></div>
                  <div>{d.task?.name ? <span className="form-hint">{d.task.parent_task_id ? '↳ ' : ''}{d.task.name}</span> : <span className="form-hint">—</span>}</div>
                  <div className="form-hint">{fmtName(d.uploader)}</div>
                  <div className="form-hint">{fmtWhen(d.created_at)}</div>
                  <div className="form-hint">{fmtSize(d.size_bytes)}</div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn-secondary btn-secondary--sm" style={{ padding: '2px 8px' }} onClick={() => downloadSingle(d)}>Download</button>
                    {(mine || isAdmin) && (
                      <button type="button" className="icon-btn icon-btn--danger" onClick={() => remove(d)} aria-label="Delete"><IconTrash /></button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {modal && (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>Upload document</h3>
            <div className="form-hint" style={{ marginBottom: 8 }}>File: <b>{modal.file.name}</b> · {fmtSize(modal.file.size)}</div>
            <form onSubmit={commitUpload}>
              <label className="login-field">
                <span>Display name</span>
                <input type="text" value={modal.displayName} onChange={(e) => setModal({ ...modal, displayName: e.target.value })} maxLength={200} autoFocus />
              </label>
              <label className="login-field">
                <span>Link to task (optional)</span>
                <select value={modal.taskId} onChange={(e) => setModal({ ...modal, taskId: e.target.value })}>
                  <option value="">— none —</option>
                  {taskOptions.map((t) => (
                    <option key={t.id} value={t.id}>{t.isSub ? '  → ' : ''}{t.name}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button type="button" className="btn-secondary btn-secondary--sm" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary btn-primary--sm" disabled={busy}>{busy ? 'Uploading…' : 'Upload'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
