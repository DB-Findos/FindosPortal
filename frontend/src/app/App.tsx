import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from '../components/common/ProtectedRoute';
import AppLayout from '../layouts/AppLayout';
import SettingsLayout from '../layouts/SettingsLayout';
import LoginPage from '../pages/LoginPage';
import HomePage from '../pages/HomePage';
import UserManagementPage from '../pages/UserManagementPage';
import DataManagementPage from '../pages/DataManagementPage';
import DesignPage from '../pages/DesignPage';
import AdvancedSearchPage from '../pages/AdvancedSearchPage';
import KpiSettingsPage from '../pages/KpiSettingsPage';
import '../styles/kpi.css';
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomePage />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users/:tab?" element={<UserManagementPage />} />
            <Route path="data/:entity?" element={<DataManagementPage />} />
            <Route path="design" element={<DesignPage />} />
            <Route path="search" element={<AdvancedSearchPage />} />
            <Route path="kpis" element={<KpiSettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
