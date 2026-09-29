import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { IconChevron } from './Icons.jsx';

const ROLE_LABELS = {
  project_admin: 'Project Admin',
  leadership: 'Leadership',
  it_admin: 'IT Admin',
  project_manager: 'Project Manager',
  member: 'Member',
};

export default function RoleSwitcher() {
  const { assignedRoles, activeRole, setActiveRole } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  function handleRoleChange(r) {
    if (r === activeRole) { setOpen(false); return; }
    setActiveRole(r);
    setOpen(false);
    navigate('/');
  }

  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (!assignedRoles?.length) return null;
  const label = ROLE_LABELS[activeRole] ?? ROLE_LABELS[assignedRoles[0]];

  if (assignedRoles.length < 2) {
    return <span className="role-switcher__static" aria-label={`Current role: ${label}`}>{label}</span>;
  }

  return (
    <div className="role-switcher" ref={ref}>
      <button
        type="button"
        className="role-switcher__trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span>{label}</span>
        <IconChevron />
      </button>
      {open && (
        <ul className="role-switcher__list" role="listbox">
          {assignedRoles.map((r) => (
            <li key={r}>
              <button
                type="button"
                className={`role-switcher__option${r === activeRole ? ' is-active' : ''}`}
                role="option"
                aria-selected={r === activeRole}
                onClick={() => handleRoleChange(r)}
              >
                {ROLE_LABELS[r] ?? r}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
