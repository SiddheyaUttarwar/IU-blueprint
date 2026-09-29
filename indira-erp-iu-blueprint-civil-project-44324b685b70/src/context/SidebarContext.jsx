import { createContext, useContext, useEffect, useState } from 'react';

const SidebarContext = createContext(null);
const KEY = 'iu-blueprint.sidebarCollapsed';

// `collapsed` = desktop-only rail-mode (icons only). `mobileOpen` = whether the off-canvas
// drawer is showing on ≤900px viewports. Persist only the desktop preference — mobileOpen
// always starts closed on each page load.
export function SidebarProvider({ children }) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { window.localStorage.setItem(KEY, collapsed ? '1' : '0'); } catch { /* ignore */ }
  }, [collapsed]);

  // Lock body scroll while the drawer is open so touch-scrolling doesn't bleed through.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (mobileOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
    document.body.style.overflow = '';
  }, [mobileOpen]);

  // Auto-close drawer when the window grows past mobile breakpoint (rotate to landscape / resize).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 901px)');
    const onChange = (e) => { if (e.matches) setMobileOpen(false); };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const value = {
    collapsed,
    toggle: () => {
      // Desktop toggle collapses the rail; on mobile, the same button opens/closes the drawer.
      if (typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches) {
        setMobileOpen((v) => !v);
      } else {
        setCollapsed((v) => !v);
      }
    },
    setCollapsed,
    mobileOpen,
    setMobileOpen,
    closeMobile: () => setMobileOpen(false),
  };

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) throw new Error('useSidebar must be used within SidebarProvider');
  return ctx;
}
