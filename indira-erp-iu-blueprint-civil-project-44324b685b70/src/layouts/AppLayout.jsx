import Navbar from '../components/Navbar.jsx';
import Sidebar from '../components/Sidebar.jsx';
import { useSidebar } from '../context/SidebarContext.jsx';

// ApprovalsLoginPopup intentionally removed for all roles per user request.
// The Approvals page/route still exists but the pending-approvals popup no longer appears on login.
export default function AppLayout({ children }) {
  const { collapsed } = useSidebar();
  return (
    <div className="app-shell" data-sidebar={collapsed ? 'collapsed' : 'expanded'}>
      <Sidebar />
      <Navbar />
      <main className="main">{children}</main>
    </div>
  );
}
