import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function PmRoute() {
  const { session, isProjectManager, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (!isProjectManager) return <Navigate to="/projects" replace />;
  return <Outlet />;
}
