import { NavLink } from 'react-router-dom';
import {
  IconDashboard, IconProjects, IconTasks, IconSettings, IconMasters,
} from './Icons.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';

// Per role-access spec (P12): each item is gated by activeRole.
// Dashboard + Projects: everyone. My Tasks: Member only (they post updates).
// Masters: Project Admin + IT Admin only. Settings: everyone.
// Approvals stays hidden from the sidebar for every role.

export default function Sidebar() {
  const { isAdmin, isItAdmin, isMember, isLeadership, isProjectManager } = useAuth();
  const { mobileOpen, closeMobile } = useSidebar();
  const showMasters = isAdmin || isItAdmin;
  // Leadership sees approvals inside My Tasks; PM sees own submissions via Baseline Approvals link.
  const showMyTasks = isMember || isLeadership;
  const showBaselineApprovals = isProjectManager;

  const NAV_ITEMS = [
    { to: '/', label: 'Dashboard', icon: IconDashboard, end: true, show: true },
    { to: '/projects', label: 'Projects', icon: IconProjects, show: true },
    { to: '/my-tasks', label: 'My Tasks', icon: IconTasks, show: showMyTasks },
    { to: '/baseline-approvals', label: 'Baseline Approvals', icon: IconTasks, show: showBaselineApprovals },
    { to: '/settings', label: 'Settings', icon: IconSettings, show: true },
  ].filter((n) => n.show);

  return (
    <>
      {/* Backdrop appears only when the mobile drawer is open. Tap to close. */}
      {mobileOpen && (
        <div className="sidebar__backdrop" onClick={closeMobile} aria-hidden="true" />
      )}
      <aside className={`sidebar${mobileOpen ? ' is-mobile-open' : ''}`}>
        <div className="sidebar__brand">
          <img src="/logo.png" alt="Indira BluePrint logo" className="sidebar__logo" />
          <span className="sidebar__brand-text">Indira BluePrint</span>
        </div>
        <nav className="sidebar__nav">
          {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={label}
              onClick={closeMobile}
              className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
            >
              <Icon />
              <span>{label}</span>
            </NavLink>
          ))}

          {showMasters && (
            <NavLink
              to="/masters"
              title="Masters"
              onClick={closeMobile}
              className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
            >
              <IconMasters />
              <span>Masters</span>
            </NavLink>
          )}
        </nav>
      </aside>
    </>
  );
}
