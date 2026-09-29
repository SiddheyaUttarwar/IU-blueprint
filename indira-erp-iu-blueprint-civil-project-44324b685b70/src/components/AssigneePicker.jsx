import MultiSelectCheckbox from './MultiSelectCheckbox.jsx';

function fmt(p) {
  if (!p) return '';
  const full = `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim();
  return full || p.email || '';
}

// Backwards-compatible wrapper: preserves the (profiles, selected, onToggle, disabled) API but
// renders the shared Syncfusion-style multi-select with search + Select All + checkboxes.
export default function AssigneePicker({ profiles = [], selected = [], onToggle, onChange, disabled }) {
  function handleChange(next) {
    if (onChange) { onChange(next); return; }
    if (!onToggle) return;
    const prevSet = new Set(selected);
    const nextSet = new Set(next);
    for (const id of nextSet) if (!prevSet.has(id)) onToggle(id);
    for (const id of prevSet) if (!nextSet.has(id)) onToggle(id);
  }
  return (
    <MultiSelectCheckbox
      options={profiles.map((p) => ({ id: p.id, label: fmt(p), hint: p.email }))}
      selected={selected}
      onChange={handleChange}
      placeholder="+ Assign users"
      disabled={disabled}
      emptyText="No users available."
    />
  );
}
