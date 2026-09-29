import { useState } from 'react';

export default function DependencyPicker({ aboveTasks, selected, onToggle, disabled }) {
  const [open, setOpen] = useState(false);
  const selectedSet = new Set(selected);
  if (aboveTasks.length === 0) return <span className="tpl-deps-empty">—</span>;
  const count = selected.length;
  return (
    <div className="dep-picker">
      <button
        type="button"
        className={`dep-btn dep-btn--compact${count ? ' has-deps' : ''}`}
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-expanded={open}
        title={count ? `${count} dependenc${count === 1 ? 'y' : 'ies'}` : 'Link a dependency'}
      >
        {count > 0 ? `Deps · ${count}` : '+ Dep'}
      </button>
      {open && !disabled && (
        <div className="dep-picker__panel" role="menu">
          {aboveTasks.map((o) => {
            const on = selectedSet.has(o.tmp_id);
            return (
              <button
                key={o.tmp_id}
                type="button"
                className={`dep-chip${on ? ' is-on' : ''}`}
                onClick={() => onToggle(o.tmp_id)}
                title={`Toggle dependency on "${o.name || '(unnamed)'}"`}
              >
                {o.name || '(unnamed)'}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
