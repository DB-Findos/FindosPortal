import { Outlet } from 'react-router-dom';
import Sidebar from '../components/layout/Sidebar';
export default function SettingsLayout() {
  return (
    <div className="settings-layout">
      <Sidebar />
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
