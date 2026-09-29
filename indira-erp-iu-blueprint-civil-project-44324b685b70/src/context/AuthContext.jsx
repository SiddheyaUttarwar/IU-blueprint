import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient.js';
import { initSession } from '../services/session.js';
import { getMyProfile } from '../services/profiles.js';

const AuthContext = createContext(null);

const NOT_ENROLLED = 'User is not Enrolled In the system.';
const NEEDS_PASSWORD_FIRST = 'Please set your password first using the invite link we sent to your email. After that, you can sign in with SSO whenever you like.';
// BUG-20: only accounts on this domain may complete SSO. Tenant membership isn't enough because
// the tenant is multi-domain — the account picker will happily surface iccs.ac.in and indiraedu.com
// identities. We enforce this after the OAuth callback: identities from other domains are signed
// out with a message. Email/password login is unaffected (any active enrolled account can use it).
const SSO_ALLOWED_DOMAIN = 'indirauniversity.edu.in';
const SSO_DOMAIN_BLOCKED = `SSO is restricted to @${SSO_ALLOWED_DOMAIN} accounts. Please sign in with your indirauniversity.edu.in address, or use email + password.`;
const ACTIVE_ROLE_KEY = 'iu-blueprint.activeRole';

function readStoredRole() {
  if (typeof window === 'undefined') return null;
  try { return window.localStorage.getItem(ACTIVE_ROLE_KEY); } catch { return null; }
}

function writeStoredRole(role) {
  if (typeof window === 'undefined') return;
  try {
    if (role) window.localStorage.setItem(ACTIVE_ROLE_KEY, role);
    else window.localStorage.removeItem(ACTIVE_ROLE_KEY);
  } catch { /* ignore */ }
}

function resolveAssignedRoles(profile) {
  if (!profile) return [];
  const list = new Set(profile.roles ?? []);
  if (profile.role) list.add(profile.role);
  return [...list];
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [enrollmentError, setEnrollmentError] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeRole, setActiveRoleState] = useState(null);

  const assignedRoles = useMemo(() => resolveAssignedRoles(profile), [profile]);

  useEffect(() => {
    if (!profile) return;
    const stored = readStoredRole();
    if (stored && assignedRoles.includes(stored)) {
      setActiveRoleState(stored);
    } else {
      setActiveRoleState(profile.role ?? assignedRoles[0] ?? null);
    }
  }, [profile, assignedRoles]);

  const setActiveRole = useCallback((role) => {
    if (!assignedRoles.includes(role)) return;
    setActiveRoleState(role);
    writeStoredRole(role);
  }, [assignedRoles]);

  const refreshProfile = useCallback(async () => {
    const p = await getMyProfile();
    setProfile(p);
    return p;
  }, []);

  const hasRole = useCallback((role) => assignedRoles.includes(role), [assignedRoles]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }
    let mounted = true;

    function isPasswordFlow() {
      if (typeof window === 'undefined') return false;
      const p = window.location.pathname;
      return p === '/set-password' || p === '/reset-password';
    }

    async function handle(nextSession) {
      if (!mounted) return;
      if (!nextSession) {
        setSession(null);
        setProfile(null);
        setActiveRoleState(null);
        setLoading(false);
        return;
      }
      try {
        const provider = nextSession.user?.app_metadata?.provider;
        const isSsoSession = provider && provider !== 'email';
        // BUG-20: reject SSO identities not on the allowed domain, BEFORE we even look at the
        // profile — an unknown iccs.ac.in identity would otherwise fall through to NOT_ENROLLED,
        // which is a less-clear message than "SSO is restricted to indirauniversity.edu.in".
        if (isSsoSession) {
          const identityEmail = String(nextSession.user?.email ?? '').toLowerCase();
          if (!identityEmail.endsWith(`@${SSO_ALLOWED_DOMAIN}`)) {
            setEnrollmentError(SSO_DOMAIN_BLOCKED);
            await supabase.auth.signOut();
            return;
          }
        }
        const profileRow = await getMyProfile();
        if (!mounted) return;
        if (!profileRow) {
          if (isPasswordFlow()) {
            setSession(nextSession);
            setLoading(false);
            return;
          }
          setEnrollmentError(NOT_ENROLLED);
          await supabase.auth.signOut();
          return;
        }
        // SSO pre-password gate: an SSO login is only allowed *after* the user has completed
        // the invite → set-password step. This keeps the password as a mandatory first credential.
        if (isSsoSession && profileRow.must_change_password && !isPasswordFlow()) {
          setEnrollmentError(NEEDS_PASSWORD_FIRST);
          await supabase.auth.signOut();
          return;
        }
        setSession(nextSession);
        setProfile(profileRow);
        if (!profileRow.first_login_at) {
          initSession().catch((err) => console.warn('session-init (non-fatal):', err?.message ?? err));
        }
      } catch (err) {
        console.error('profile check failed', err);
        if (isPasswordFlow()) {
          setSession(nextSession);
          setLoading(false);
          return;
        }
        setEnrollmentError(NOT_ENROLLED);
        await supabase.auth.signOut();
      } finally {
        if (mounted) setLoading(false);
      }
    }

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      handle(nextSession);
    });

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const value = {
    session,
    user: session?.user ?? null,
    profile,
    assignedRoles,
    activeRole,
    setActiveRole,
    hasRole,
    isAdmin: activeRole === 'project_admin',
    isItAdmin: activeRole === 'it_admin',
    isProjectManager: activeRole === 'project_manager',
    isLeadership: activeRole === 'leadership',
    isMember: activeRole === 'member',
    canAdmin: assignedRoles.includes('project_admin'),
    canItAdmin: assignedRoles.includes('it_admin'),
    canProjectManager: assignedRoles.includes('project_manager'),
    canLeadership: assignedRoles.includes('leadership'),
    loading,
    enrollmentError,
    clearEnrollmentError: () => setEnrollmentError(''),
    refreshProfile,
    signOut: () => supabase?.auth.signOut(),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
