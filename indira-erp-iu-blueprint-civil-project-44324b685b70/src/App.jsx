import { Routes, Route, Outlet, Link } from 'react-router-dom';
import AppLayout from './layouts/AppLayout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import Tasks from './pages/Tasks.jsx';
import Settings from './pages/Settings.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import ChangePassword from './pages/ChangePassword.jsx';
import EditProfile from './pages/EditProfile.jsx';
import Help from './pages/Help.jsx';
import MastersHome from './pages/masters/MastersHome.jsx';
import MastersUsers from './pages/masters/Users.jsx';
import ProjectType from './pages/masters/it/ProjectType.jsx';
import ProjectTemplate from './pages/masters/it/ProjectTemplate.jsx';
import Task from './pages/masters/it/Task.jsx';
import Milestone from './pages/masters/it/Milestone.jsx';
import ProjectTemplates from './pages/masters/ProjectTemplates.jsx';
import BuildStructure from './pages/masters/templates/BuildStructure.jsx';
import Campus from './pages/masters/Campus.jsx';
import School from './pages/masters/School.jsx';
import RagRules from './pages/masters/RagRules.jsx';
import ProgressUnits from './pages/masters/ProgressUnits.jsx';
import LocationTags from './pages/masters/LocationTags.jsx';
import NotificationModulesAdmin from './pages/masters/NotificationModulesAdmin.jsx';
import SetPassword from './pages/SetPassword.jsx';
import ProjectNewManual from './pages/projects/ProjectNewManual.jsx';
import ProjectDetail from './pages/projects/ProjectDetail.jsx';
import ProjectKanban from './pages/projects/ProjectKanban.jsx';
import ProjectGantt from './pages/projects/ProjectGantt.jsx';
import ProjectsBulkImport from './pages/projects/ProjectsBulkImport.jsx';
import MyTasks from './pages/MyTasks.jsx';
import Approvals from './pages/Approvals.jsx';
import BaselineApprovals from './pages/BaselineApprovals.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import PublicOnlyRoute from './components/PublicOnlyRoute.jsx';
import AdminRoute from './components/AdminRoute.jsx';
import MastersRoute from './components/MastersRoute.jsx';
import PmRoute from './components/PmRoute.jsx';

export default function App() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicOnlyRoute>
            <Login />
          </PublicOnlyRoute>
        }
      />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/set-password" element={<SetPassword />} />
      <Route element={<ProtectedRoute />}>
        <Route
          element={
            <AppLayout>
              <Outlet />
            </AppLayout>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:projectId" element={<ProjectDetail />} />
          <Route path="/projects/:projectId/kanban" element={<ProjectKanban />} />
          <Route path="/projects/:projectId/gantt" element={<ProjectGantt />} />
          <Route path="/my-tasks" element={<MyTasks />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/baseline-approvals" element={<BaselineApprovals />} />
          <Route element={<PmRoute />}>
            <Route path="/projects/new/manual" element={<ProjectNewManual />} />
            <Route path="/projects/new/bulk" element={<ProjectsBulkImport />} />
          </Route>
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/change-password" element={<ChangePassword />} />
          <Route path="/profile" element={<EditProfile />} />
          <Route path="/help" element={<Help />} />

          <Route element={<MastersRoute />}>
            <Route path="/masters" element={<MastersHome />} />
          </Route>

          <Route element={<AdminRoute />}>
            <Route path="/masters/users" element={<MastersUsers />} />
            <Route path="/masters/project-templates" element={<ProjectTemplates />} />
            <Route path="/masters/project-templates/:templateId/build" element={<BuildStructure />} />
            <Route path="/masters/campus" element={<Campus />} />
            <Route path="/masters/school" element={<School />} />
            <Route path="/masters/rag-rules" element={<RagRules />} />
            <Route path="/masters/progress-units" element={<ProgressUnits />} />
            <Route path="/masters/location-tags" element={<LocationTags />} />
            <Route path="/masters/notification-modules" element={<NotificationModulesAdmin />} />
            {/* Project Type moved from IT Admin → Project Admin. Both the old /masters/it/project-type
                path (kept for stale bookmarks) and the new /masters/project-type render the same page. */}
            <Route path="/masters/project-type" element={<ProjectType />} />
            <Route path="/masters/it/project-type" element={<ProjectType />} />
          </Route>

          <Route element={<MastersRoute requireItAdmin />}>
            <Route path="/masters/it/project-template" element={<ProjectTemplate />} />
            <Route path="/masters/it/task" element={<Task />} />
            <Route path="/masters/it/milestone" element={<Milestone />} />
          </Route>

          {/* Catch-all — avoid blank white page on stale bookmarks / typos (BUG-04) */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Route>
    </Routes>
  );
}

function NotFound() {
  return (
    <div className="card" style={{ maxWidth: 520, margin: '48px auto', textAlign: 'center' }}>
      <h2 style={{ marginTop: 0 }}>Page not found</h2>
      <p className="form-hint">The page you were looking for doesn&apos;t exist or has moved.</p>
      <Link to="/" className="btn-primary btn-primary--sm" style={{ display: 'inline-block', marginTop: 12 }}>Back to Dashboard</Link>
    </div>
  );
}
