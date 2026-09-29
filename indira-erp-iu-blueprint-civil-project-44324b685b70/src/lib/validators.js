export function isNonEmpty(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

export function isEmail(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export function isTenDigitPhone(v) {
  if (typeof v !== 'string') return false;
  return /^\d{10}$/.test(v.trim());
}

export function digitsOnly(v) {
  return (v ?? '').replace(/\D+/g, '');
}

export function validate(rules, values) {
  const errors = {};
  for (const [field, checks] of Object.entries(rules)) {
    for (const { test, message } of checks) {
      if (!test(values[field], values)) {
        errors[field] = message;
        break;
      }
    }
  }
  return errors;
}
