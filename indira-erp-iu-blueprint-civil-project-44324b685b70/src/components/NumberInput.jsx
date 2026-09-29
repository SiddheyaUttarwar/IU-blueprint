import { useState } from 'react';

// Numeric input with client-side validation. Blocks non-numeric key presses,
// shows inline error on blur / invalid input. Value is passed to onChange as a string
// (parent decides parseFloat/parseInt).
export default function NumberInput({
  value, onChange, min = 0, max, allowDecimal = true, allowNegative = false,
  disabled, required, placeholder, className = 'tpl-input tpl-input--num', ...rest
}) {
  const [touched, setTouched] = useState(false);

  const strValue = value === null || value === undefined ? '' : String(value);
  const invalid = touched && !isValid(strValue, { min, max, allowDecimal, allowNegative, required });

  function handleKeyDown(e) {
    const ok = [
      'Backspace', 'Delete', 'Tab', 'Enter', 'Escape', 'Home', 'End',
      'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
    ];
    if (ok.includes(e.key)) return;
    if (e.ctrlKey || e.metaKey) return; // allow copy/paste/select-all
    if (/^[0-9]$/.test(e.key)) return;
    if (allowDecimal && e.key === '.' && !strValue.includes('.')) return;
    if (allowNegative && e.key === '-' && strValue === '') return;
    e.preventDefault();
  }

  function handleChange(e) {
    const v = e.target.value;
    if (v === '' || isNumericShape(v, { allowDecimal, allowNegative })) {
      onChange(v);
    }
  }

  return (
    <>
      <input
        type="text"
        inputMode={allowDecimal ? 'decimal' : 'numeric'}
        className={className + (invalid ? ' is-invalid' : '')}
        value={strValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => setTouched(true)}
        onPaste={(e) => {
          const p = e.clipboardData.getData('text');
          if (!isNumericShape(p, { allowDecimal, allowNegative })) e.preventDefault();
        }}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        {...rest}
      />
      {invalid && (
        <span className="form-hint form-hint--error">
          {errorFor(strValue, { min, max, required })}
        </span>
      )}
    </>
  );
}

function isNumericShape(v, { allowDecimal, allowNegative }) {
  if (allowNegative && allowDecimal) return /^-?\d*\.?\d*$/.test(v);
  if (allowNegative) return /^-?\d*$/.test(v);
  if (allowDecimal) return /^\d*\.?\d*$/.test(v);
  return /^\d*$/.test(v);
}

function isValid(v, { min, max, allowDecimal, allowNegative, required }) {
  if (v === '') return !required;
  if (!isNumericShape(v, { allowDecimal, allowNegative })) return false;
  const n = Number(v);
  if (!Number.isFinite(n)) return false;
  if (min != null && n < min) return false;
  if (max != null && n > max) return false;
  return true;
}

function errorFor(v, { min, max, required }) {
  if (v === '' && required) return 'Required.';
  const n = Number(v);
  if (!Number.isFinite(n)) return 'Enter a valid number.';
  if (min != null && n < min) return `Must be at least ${min}.`;
  if (max != null && n > max) return `Must be at most ${max}.`;
  return 'Invalid.';
}
