import { useEffect, useMemo } from 'react';

function formatName(p) {
  if (!p) return '';
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return full || p.email || '';
}

export default function VersionsListModal({ open, template, onCancel, onSelect }) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) { if (e.key === 'Escape') onCancel(); }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const sorted = useMemo(() => {
    const list = template?.all_versions ?? [];
    return [...list].sort((a, b) => b.version_no - a.version_no);
  }, [template]);

  if (!open || !template) return null;

  const latestId = sorted[0]?.id;
  const lastEditedId = [...sorted].sort(
    (a, b) => new Date(b.updated_at ?? 0) - new Date(a.updated_at ?? 0),
  )[0]?.id;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="vl-title">
      <div className="modal">
        <div className="modal__header">
          <h3 id="vl-title" className="modal__title">Versions of {template.name}</h3>
          <button type="button" className="modal__close" onClick={onCancel} aria-label="Close">×</button>
        </div>
        <div className="modal__body">
          {sorted.length === 0 ? (
            <div className="masters-users__empty">No versions yet.</div>
          ) : (
            <ul className="versions-list">
              {sorted.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    className="versions-list__row"
                    onClick={() => onSelect(v)}
                  >
                    <div className="versions-list__main">
                      <span className="version-pill">v{v.version_no}</span>
                      {v.id === latestId && <span className="versions-badge versions-badge--latest">Latest</span>}
                      {v.id === lastEditedId && v.id !== latestId && (
                        <span className="versions-badge versions-badge--recent">Most recent edit</span>
                      )}
                    </div>
                    <div className="versions-list__meta">
                      {v.updated_at
                        ? <>Updated {new Date(v.updated_at).toLocaleString()}
                          {formatName(v.updated_by_profile) && <> by {formatName(v.updated_by_profile)}</>}</>
                        : <>Created {new Date(v.created_at).toLocaleString()}</>}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal__footer">
          <button type="button" className="btn-secondary" onClick={onCancel}>Close</button>
        </div>
      </div>
    </div>
  );
}
