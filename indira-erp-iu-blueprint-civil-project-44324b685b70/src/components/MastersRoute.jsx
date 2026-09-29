import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';

export default function MastersRoute({ requireItAdmin = false }) {
  const { session, isAdmin, isItAdmin, loading } = useAuth();
  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (requireItAdmin) {
    if (!isItAdmin) return <Navigate to="/" replace />;
  } else if (!isAdmin && !isItAdmin) {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
