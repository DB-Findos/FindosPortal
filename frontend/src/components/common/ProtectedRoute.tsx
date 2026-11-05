import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import PendingAccessPage from '../../pages/PendingAccessPage';
export default function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading">Portal wird geladen …</div>;
  if (user?.pending_access) return <PendingAccessPage />;
  return user ? <Outlet /> : <Navigate to="/login" state={{ from: location.pathname }} replace />;
}
