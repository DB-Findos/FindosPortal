import { NavLink, Link } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronRight,
  Database,
  Palette,
  ShieldCheck,
  Users,
  Search,
  Calculator,
} from 'lucide-react';
export default function Sidebar() {
  const links = [
    { to: '/settings/users', name: 'User Management', icon: Users },
    { to: '/settings/data', name: 'Data Management', icon: Database },
    { to: '/settings/search', name: 'Advanced Search', icon: Search },
    { to: '/settings/kpis', name: 'KPIs & Reporting', icon: Calculator },
    { to: '/settings/design', name: 'Design & Layout', icon: Palette },
  ];
  return (
    <aside className="sidebar">
      <Link className="back-button" to="/">
        <ArrowLeft size={15} /> Zur Hauptseite
      </Link>
      <div className="sidebar-label">EINSTELLUNGEN</div>
      <nav>
        {links.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => 'nav-item ' + (isActive ? 'active' : '')}
          >
            <item.icon size={18} />
            {item.name}
            <ChevronRight size={15} />
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <ShieldCheck size={17} />
        <div>
          Findos Portal<small>Administration</small>
        </div>
      </div>
    </aside>
  );
}
