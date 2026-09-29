import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ToastContext = createContext(null);
const DEFAULT_DURATION = 4000;
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((message, opts = {}) => {
    const id = nextId++;
    const kind = opts.kind ?? 'success';
    const duration = opts.duration ?? DEFAULT_DURATION;
    setToasts((all) => [...all, { id, message, kind }]);
    if (duration > 0) setTimeout(() => remove(id), duration);
    return id;
  }, [remove]);

  const success = useCallback((m, o) => push(m, { ...o, kind: 'success' }), [push]);
  const error = useCallback((m, o) => push(m, { ...o, kind: 'error' }), [push]);
  const info = useCallback((m, o) => push(m, { ...o, kind: 'info' }), [push]);

  // Stable across renders: consumers destructuring { error } / { success } / etc.
  // won't cause useEffect loops. `toasts` is intentionally excluded — only the
  // provider's <ToastRail /> reads it locally.
  const value = useMemo(() => ({
    toast: push, success, error, info, remove,
  }), [push, success, error, info, remove]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastRail toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function ToastRail({ toasts, onDismiss }) {
  useEffect(() => {}, [toasts]);
  return (
    <div className="toast-rail" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} role="status" className={`toast toast--${t.kind}`}>
          <span className="toast__message">{t.message}</span>
          <button type="button" className="toast__close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
