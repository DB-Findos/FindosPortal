import { Outlet } from 'react-router-dom';
import Topbar from '../components/layout/Topbar';
import AiChatSidebar from '../components/ai/AiChatSidebar';
export default function AppLayout() {
  return (
    <div className="app">
      <Topbar />
      <Outlet />
      <AiChatSidebar />
    </div>
  );
}
