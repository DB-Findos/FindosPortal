import { useEffect, useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import PortfolioSidebar from '../components/layout/PortfolioSidebar';
import PerformanceUpdateReport from '../components/portfolio/PerformanceUpdateReport';
import IncomeStatementReport from '../components/portfolio/IncomeStatementReport';
import { useApi } from '../contexts/ApiContext';
import '../styles/portfolio-company.css';

const titles: Record<string, string> = { dashboard: 'Dashboard', company: 'Company', fund: 'Fund' };
const companyTabs = [
  ['performance-update', 'Performance Update'],
  ['income-statement', 'Income Statement'],
  ['balance-sheet', 'Balance Sheet'],
  ['cashflow', 'Cashflow'],
  ['valuation', 'Valuation'],
  ['bridge', 'Bridge'],
  ['investor-reporting', 'Investoren Reporting'],
  ['financials', 'Financials'],
  ['custom-reports', 'Custom Reports'],
] as const;
type PortfolioCompany = {
  objectId: string;
  name: string;
  internal_name: string | null;
  currency: string | null;
  status: string;
};

function CompanyView() {
  const { request } = useApi();
  const [params, setParams] = useSearchParams();
  const companyId = params.get('company');
  const requestedTab = params.get('tab') || 'performance-update';
  const tab = requestedTab === 'performance-data' ? 'performance-update' : requestedTab;
  const [companies, setCompanies] = useState<PortfolioCompany[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    request<PortfolioCompany[]>('/portfolio/companies')
      .then((value) => active && setCompanies(value))
      .catch((cause: Error) => active && setError(cause.message))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [request]);
  const company = companies.find((item) => item.objectId === companyId);

  const chooseTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next);
  };

  return (
    <div className="portfolio-layout">
      <PortfolioSidebar />
      <main className="portfolio-main" aria-label="Company">
        <div className="portfolio-view-card company-view-card">
          <div className="portfolio-view-eyebrow">Portfolio Management / Company</div>
          <div className="company-title-row">
            <div>
              <h1>
                {company?.internal_name ||
                  company?.name ||
                  (companyId ? 'Company wird geladen …' : 'Company auswählen')}
              </h1>
              {company && <p className="company-legal-name">{company.name}</p>}
            </div>
            {company && <span className="company-status-pill">{company.status}</span>}
          </div>
          {companyId && company && (
            <>
              <nav className="company-tabs" aria-label="Company Reports">
                {companyTabs.map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={tab === key ? 'active' : ''}
                    onClick={() => chooseTab(key)}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="company-tab-panel">
                {tab === 'performance-update' ? (
                  <PerformanceUpdateReport companyId={company.objectId} />
                ) : tab === 'income-statement' ? (
                  <IncomeStatementReport companyId={company.objectId} />
                ) : (
                  <div className="company-empty-report">
                    <span>{companyTabs.find(([key]) => key === tab)?.[1] || 'Report'}</span>
                    <p>Für diesen Tab ist noch kein Bericht eingerichtet.</p>
                  </div>
                )}
              </div>
            </>
          )}
          {!companyId && (
            <div className="company-empty-report">
              <span>Portfolio Company</span>
              <p>Wähle links im Sidebar eine Company mit Status „P - Portfolio“ aus.</p>
            </div>
          )}
          {loading && companyId && !company && (
            <p className="company-load-message">Portfolio Companies werden geladen …</p>
          )}
          {error && (
            <p className="company-load-error" role="alert">
              {error}
            </p>
          )}
          {!loading && companyId && !company && !error && (
            <p className="company-load-error">
              Diese Company ist nicht mehr im Portfolio verfügbar.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

export default function PortfolioPage() {
  const { view = 'dashboard' } = useParams();
  if (!titles[view]) return <Navigate to="/portfolio/dashboard" replace />;
  if (view === 'company') return <CompanyView />;
  return (
    <div className="portfolio-layout">
      <PortfolioSidebar />
      <main className="portfolio-main" aria-label={titles[view]}>
        <div className="portfolio-view-card">
          <div className="portfolio-view-eyebrow">Portfolio Management</div>
          <h1>{titles[view]}</h1>
        </div>
      </main>
    </div>
  );
}
