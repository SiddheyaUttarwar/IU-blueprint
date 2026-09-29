import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { IconUser, IconHelp, IconSignOut, IconMoon, IconSun, IconKey, IconChevron } from './Icons.jsx';

const ROLE_LABELS = {
  project_admin: 'Project Admin',
  leadership: 'Leadership',
  it_admin: 'IT Admin',
  project_manager: 'Project Manager',
  member: 'Member',
};

export default function ProfileMenu() {
  const { user, profile, activeRole, signOut } = useAuth();
  const { isDark, toggle: toggleTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);
  const navigate = useNavigate();

  const email = user?.email ?? '';
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || email;
  const subtitle = ROLE_LABELS[activeRole] ?? ROLE_LABELS[profile?.role] ?? '';
  const initial = (displayName[0] ?? '?').toUpperCase();

  useEffect(() => {
    function onClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  function go(path) {
    setOpen(false);
    navigate(path);
  }

  return (
    <div className="profile-menu" ref={menuRef}>
      <button
        type="button"
        className="profile-menu__trigger profile-menu__trigger--wide"
        onClick={() => setOpen((v) => !v)}
        aria-label="Open profile menu"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="navbar__avatar">
          {profile?.avatar_url
            ? <img src={profile.avatar_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
            : initial}
        </span>
        <span className="profile-menu__identity">
          <span className="profile-menu__trigger-name">{displayName}</span>
          {subtitle && <span className="profile-menu__trigger-role">{subtitle}</span>}
        </span>
        <span className={`profile-menu__caret${open ? ' is-open' : ''}`}><IconChevron /></span>
      </button>
      {open && (
        <div className="profile-menu__dropdown" role="menu">
          <div className="profile-menu__header">
            <div className="profile-menu__name">{displayName}</div>
            <div className="profile-menu__email">{email}</div>
          </div>
          <button type="button" className="profile-menu__item" onClick={() => go('/profile')} role="menuitem">
            <IconUser /> <span>My Profile</span>
          </button>
          <button type="button" className="profile-menu__item" onClick={toggleTheme} role="menuitem" aria-pressed={isDark}>
            {isDark ? <IconSun /> : <IconMoon />} <span>{isDark ? 'Light mode' : 'Dark mode'}</span>
          </button>
          <button type="button" className="profile-menu__item" onClick={() => go('/help')} role="menuitem">
            <IconHelp /> <span>Help</span>
          </button>
          <button type="button" className="profile-menu__item" onClick={() => go('/change-password')} role="menuitem">
            <IconKey /> <span>Change password</span>
          </button>
          <div className="profile-menu__divider" />
          <button
            type="button"
            className="profile-menu__item profile-menu__item--danger"
            onClick={() => { setOpen(false); signOut(); }}
            role="menuitem"
          >
            <IconSignOut /> <span>Sign out</span>
          </button>
        </div>
      )}
    </div>
  );
}
