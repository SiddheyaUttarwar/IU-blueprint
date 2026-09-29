import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

// Syncfusion-style multi-select with checkboxes.
// Panel is rendered via a portal with position: fixed so it never gets clipped by ancestor
// overflow: auto/hidden (which was cramping the assignee dropdown inside the customize table).
export default function MultiSelectCheckbox({
  options = [],
  selected = [],
  onChange,
  placeholder = 'Select…',
  searchable = true,
  selectAll = true,
  disabled = false,
  maxHeight = 260,
  emptyText = 'No options.',
  buttonClassName = '',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState(null);
  const btnRef = useRef(null);
  const panelRef = useRef(null);
  const inputRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    function reposition() {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) });
    }
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open]);

  useEffect(() => {
    function onDown(e) {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (panelRef.current && panelRef.current.contains(e.target)) return;
      setOpen(false);
    }
    if (open) {
      document.addEventListener('mousedown', onDown);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => String(o.label ?? '').toLowerCase().includes(q));
  }, [options, query]);

  const selSet = useMemo(() => new Set(selected), [selected]);
  const allFilteredSelected = filtered.length > 0 && filtered.every((o) => selSet.has(o.id));

  function toggle(id) {
    const next = selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id];
    onChange?.(next);
  }
  function toggleSelectAll() {
    if (allFilteredSelected) {
      const rm = new Set(filtered.map((o) => o.id));
      onChange?.(selected.filter((x) => !rm.has(x)));
    } else {
      const add = filtered.map((o) => o.id).filter((id) => !selSet.has(id));
      onChange?.([...selected, ...add]);
    }
  }

  const buttonLabel = (() => {
    if (selected.length === 0) return placeholder;
    if (selected.length === 1) {
      const one = options.find((o) => o.id === selected[0]);
      return one ? one.label : `${selected.length} selected`;
    }
    return `${selected.length} selected`;
  })();

  const panel = open && !disabled && rect ? createPortal(
    <div
      ref={panelRef}
      className="ms-checkbox__panel"
      role="listbox"
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        maxHeight,
      }}
    >
      {searchable && (
        <div className="ms-checkbox__search">
          <input
            ref={inputRef}
            type="text"
            className="ms-checkbox__search-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
          />
        </div>
      )}
      <div className="ms-checkbox__list">
        {selectAll && filtered.length > 0 && (
          <label className="ms-checkbox__row ms-checkbox__row--all">
            <input type="checkbox" checked={allFilteredSelected} onChange={toggleSelectAll} />
            <span>Select All</span>
          </label>
        )}
        {filtered.length === 0 ? (
          <div className="ms-checkbox__empty">{query ? 'No matches.' : emptyText}</div>
        ) : (
          filtered.map((o) => {
            const on = selSet.has(o.id);
            return (
              <label key={o.id} className={`ms-checkbox__row${on ? ' is-on' : ''}`}>
                <input type="checkbox" checked={on} onChange={() => toggle(o.id)} />
                <span className="ms-checkbox__row-label">{o.label}</span>
                {o.hint && <span className="ms-checkbox__hint">{o.hint}</span>}
              </label>
            );
          })
        )}
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`ms-checkbox${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className={`ms-checkbox__btn ${buttonClassName}`.trim()}
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={`ms-checkbox__label${selected.length ? '' : ' ms-checkbox__label--placeholder'}`}>
          {buttonLabel}
        </span>
        <span className="ms-checkbox__caret" aria-hidden="true">▾</span>
      </button>
      {panel}
    </div>
  );
}
