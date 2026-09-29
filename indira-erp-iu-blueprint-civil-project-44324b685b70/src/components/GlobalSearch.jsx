import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { globalSearch } from '../services/search.js';
import { IconSearch } from './Icons.jsx';

const TYPE_ORDER = ['User', 'Project', 'Project Task', 'Indent Item', 'Template', 'Task', 'Milestone', 'Approval Group'];

function groupByType(items) {
  const map = new Map();
  for (const it of items) {
    if (!map.has(it.type)) map.set(it.type, []);
    map.get(it.type).push(it);
  }
  return TYPE_ORDER.filter((t) => map.has(t)).map((t) => ({ type: t, items: map.get(t) }));
}

export default function GlobalSearch() {
  const { isItAdmin } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();

  const trimmed = useMemo(() => query.trim(), [query]);

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  useEffect(() => {
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await globalSearch(trimmed, { isItAdmin });
        if (!cancelled) setResults(rows);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [trimmed, isItAdmin]);

  const groups = useMemo(() => groupByType(results), [results]);

  function pick(r) {
    setOpen(false);
    setQuery('');
    navigate(r.to);
  }

  return (
    <div className="global-search" ref={ref}>
      <span className="global-search__icon"><IconSearch /></span>
      <input
        type="search"
        className="global-search__input"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search users, templates, tasks, milestones…"
        aria-label="Global search"
      />
      {open && trimmed.length >= 2 && (
        <div className="global-search__dropdown" role="listbox">
          {busy && <div className="global-search__empty">Searching…</div>}
          {!busy && results.length === 0 && <div className="global-search__empty">No results.</div>}
          {!busy && groups.map((g) => (
            <div key={g.type} className="global-search__group">
              <div className="global-search__group-title">
                {g.type} <span className="global-search__count">{g.items.length}{g.items.length >= 15 ? '+' : ''}</span>
              </div>
              <ul className="global-search__list">
                {g.items.map((r) => (
                  <li key={`${r.type}-${r.id}`}>
                    <button
                      type="button"
                      className="global-search__item"
                      onClick={() => pick(r)}
                      role="option"
                    >
                      <span className="global-search__label">{r.label}</span>
                      {r.sublabel && <span className="global-search__sublabel">{r.sublabel}</span>}
                    </button>
                  </li>
                ))}
                {g.items.length >= 15 && (
                  <li className="global-search__hint">Showing top 15 · refine your search for more</li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
