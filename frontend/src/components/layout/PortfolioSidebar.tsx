import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  BriefcaseBusiness,
  Building2,
  ChevronDown,
  ChevronRight,
  Folder,
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  WalletCards,
} from 'lucide-react';
import { useApi } from '../../contexts/ApiContext';
type View = { name: string; label: string; path: string; icon: string };
type Section = { name: string; label: string; icon: string; views: View[] };
type PortfolioCompany = {
  objectId: string;
  name: string;
  internal_name: string | null;
  status: string;
};
const icons: Record<string, typeof Folder> = {
  'briefcase-business': BriefcaseBusiness,
  'layout-dashboard': LayoutDashboard,
  'building-2': Building2,
  'wallet-cards': WalletCards,
};
export default function PortfolioSidebar() {
  const { request } = useApi();
  const location = useLocation();
  const navigate = useNavigate();
  const [sections, setSections] = useState<Section[]>([]);
  const [companies, setCompanies] = useState<PortfolioCompany[]>([]);
  const [companiesLoaded, setCompaniesLoaded] = useState(false);
  const [companiesOpen, setCompaniesOpen] = useState(location.pathname === '/portfolio/company');
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<Section[]>('/navigation')
      .then((value) => {
        if (active) setSections(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [request]);
  useEffect(() => {
    if (location.pathname === '/portfolio/company') {
      setCompaniesOpen(true);
      if (!companiesLoaded) {
        request<PortfolioCompany[]>('/portfolio/companies')
          .then((value) => {
            setCompanies(value);
            setCompaniesLoaded(true);
          })
          .catch((e) => setError(e.message));
      }
    }
  }, [location.pathname, companiesLoaded, request]);
  const toggleCompanies = (view: View) => {
    if (collapsed) setCollapsed(false);
    if (location.pathname !== view.path) navigate(view.path);
    setCompaniesOpen((open) => !open);
  };
  return (
    <aside
      className={'portfolio-sidebar' + (collapsed ? ' is-collapsed' : '')}
      aria-label="Portfolio Navigation"
    >
      <div className="portfolio-nav-top">
        <div className="portfolio-nav-title">
          {!collapsed && (
            <>
              <span className="portfolio-nav-mark">
                <BriefcaseBusiness size={17} />
              </span>
              <span>Portfolio</span>
            </>
          )}
        </div>
        <button
          className="portfolio-collapse"
          onClick={() => setCollapsed((value) => !value)}
          title={collapsed ? 'Navigation einblenden' : 'Navigation ausblenden'}
          aria-label={collapsed ? 'Navigation einblenden' : 'Navigation ausblenden'}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
      <nav className="portfolio-nav-items">
        {error && <p className="portfolio-nav-error">{!collapsed && error}</p>}
        {sections.map((section) => {
          const SectionIcon = icons[section.icon] || Folder;
          return (
            <section className="portfolio-nav-section" key={section.name}>
              {!collapsed && (
                <div className="portfolio-section-heading">
                  <SectionIcon size={15} />
                  <span>{section.label}</span>
                </div>
              )}
              {section.views.map((view) => {
                const Icon = icons[view.icon] || ChevronRight;
                if (view.name === 'company') {
                  const active = location.pathname === view.path;
                  return (
                    <div className="portfolio-company-nav" key={view.path}>
                      <button
                        className={'portfolio-nav-link' + (active ? ' active' : '')}
                        title={collapsed ? view.label : undefined}
                        onClick={() => toggleCompanies(view)}
                        aria-expanded={!collapsed && companiesOpen}
                      >
                        <Icon size={17} />
                        {!collapsed && (
                          <>
                            <span>{view.label}</span>
                            {companiesOpen ? (
                              <ChevronDown className="portfolio-nav-chevron" size={14} />
                            ) : (
                              <ChevronRight className="portfolio-nav-chevron" size={14} />
                            )}
                          </>
                        )}
                      </button>
                      {!collapsed && companiesOpen && (
                        <div className="portfolio-company-list">
                          {!companiesLoaded && (
                            <span className="portfolio-company-hint">
                              Companies werden geladen …
                            </span>
                          )}
                          {companiesLoaded && companies.length === 0 && (
                            <span className="portfolio-company-hint">
                              Keine Companies mit Status P - Portfolio.
                            </span>
                          )}
                          {companies.map((company) => (
                            <button
                              className={
                                'portfolio-company-item' +
                                (new URLSearchParams(location.search).get('company') ===
                                company.objectId
                                  ? ' active'
                                  : '')
                              }
                              key={company.objectId}
                              onClick={() =>
                                navigate(
                                  `${view.path}?company=${encodeURIComponent(company.objectId)}&tab=performance-update`
                                )
                              }
                              title={company.name}
                            >
                              <Building2 size={16} aria-hidden="true" />
                              <span className="portfolio-company-name">{company.name}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                return (
                  <NavLink
                    key={view.path}
                    to={view.path}
                    title={collapsed ? view.label : undefined}
                    className={({ isActive }) => 'portfolio-nav-link' + (isActive ? ' active' : '')}
                  >
                    <Icon size={17} />
                    {!collapsed && (
                      <>
                        <span>{view.label}</span>
                        <ChevronRight className="portfolio-nav-chevron" size={14} />
                      </>
                    )}
                  </NavLink>
                );
              })}
            </section>
          );
        })}
        {!sections.length && !error && !collapsed && (
          <p className="portfolio-nav-empty">
            Für deine Nutzergruppe wurden noch keine Views freigegeben.
          </p>
        )}
      </nav>
      {!collapsed && <div className="portfolio-sidebar-foot">Portfolio Management</div>}
    </aside>
  );
}
