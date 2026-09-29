import { useLocation } from 'react-router-dom';
import NotificationBell from './NotificationBell.jsx';
import ProfileMenu from './ProfileMenu.jsx';
import RoleSwitcher from './RoleSwitcher.jsx';
import GlobalSearch from './GlobalSearch.jsx';
import { IconMenu } from './Icons.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';

const TITLES = {
  '/': 'Dashboard',
  '/projects': 'Projects',
  '/projects/new/manual': 'Create Project',
  '/projects/new/bulk': 'Create Project (Bulk Import)',
  '/tasks': 'Tasks',
  '/team': 'Team',
  '/my-tasks': 'My Tasks',
  '/baseline-approvals': 'Baseline Approvals',
  '/approvals': 'Approvals',
  '/settings': 'Settings',
  '/change-password': 'Change Password',
  '/profile': 'Edit Profile',
  '/help': 'Help',
  '/masters': 'Masters',
  '/masters/users': 'Masters — Users',
  '/masters/project-templates': 'Masters — Project Templates',
  '/masters/campus': 'Masters — Campus',
  '/masters/school': 'Masters — School',
  '/masters/rag-rules': 'Masters — RAG Rules',
  '/masters/progress-units': 'Masters — Progress Units',
  '/masters/location-tags': 'Masters — Location Tags',
  '/masters/notification-modules': 'Masters — Notification Modules',
  '/masters/approval-authority': 'Masters — Approval Authority',
  '/masters/project-type': 'Masters — Project Type',
  '/masters/it/project-type': 'Masters — Project Type',
  '/masters/it/project-template': 'Masters — Project Template',
  '/masters/it/task': 'Masters — Task',
  '/masters/it/milestone': 'Masters — Milestone',
};

function titleForPath(pathname) {
  if (TITLES[pathname]) return TITLES[pathname];
  // Dynamic routes that don't match a static map entry (BUG-12 fix).
  if (/^\/projects\/[^/]+\/kanban$/.test(pathname)) return 'Project — Kanban';
  if (/^\/projects\/[^/]+\/gantt$/.test(pathname)) return 'Project — Gantt';
  if (/^\/projects\/[^/]+$/.test(pathname)) return 'Project Detail';
  if (/^\/masters\/project-templates\/[^/]+\/build$/.test(pathname)) return 'Masters — Build Structure';
  return 'Indira BluePrint';
}

export default function Navbar() {
  const { pathname } = useLocation();
  const { collapsed, toggle } = useSidebar();
  const title = titleForPath(pathname);

  return (
    <header className="navbar">
      <div className="navbar__left">
        <button
          type="button"
          className="navbar__toggle"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
        >
          <IconMenu />
        </button>
        <h1 className="navbar__title">{title}</h1>
      </div>
      <div className="navbar__center">
        <GlobalSearch />
      </div>
      <div className="navbar__actions">
        <RoleSwitcher />
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  );
}
