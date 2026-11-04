import { useState } from 'react';
import { Navigate, useParams, useSearchParams } from 'react-router-dom';
import CompanyDetails from '../components/portfolio/CompanyDetails';
import { canReadCompanyTab } from '../utils/company-tabs';
import type { Row } from '../types/api';
import PortfolioSidebar from '../components/layout/PortfolioSidebar';
import PerformanceUpdateReport from '../components/portfolio/PerformanceUpdateReport';
import FinancialsReport from '../components/portfolio/FinancialsReport';
import InvestorReporting from '../components/portfolio/InvestorReporting';
import CustomReportsView from '../components/portfolio/custom-reports/CustomReportsView';
import BridgeReport from '../components/portfolio/bridge/BridgeReport';
import { useAuth } from '../contexts/AuthContext';
import '../styles/portfolio-company.css';
import FundPage from './FundPage';

const titles: Record<string, string> = { dashboard: 'Dashboard', company: 'Company', fund: 'Fund' };
const companyTabs = [
  ['details', 'Details'],
  ['performance-update', 'Performance Update'],
  ['financials', 'Financials'],
  ['valuation', 'Valuation'],
  ['bridge', 'Bridge'],
  ['investor-reporting', 'Investoren Reporting'],
  ['custom-reports', 'Custom Reports'],
] as const;
function CompanyView() {
  const { portfolioCompanies: companies, navigationError: error, user } = useAuth();
  const [updatedCompany, setUpdatedCompany] = useState<Row | null>(null);
  const visibleTabs = companyTabs.filter(([key]) =>
    canReadCompanyTab(key, user?.permissions ?? {})
  );
  const [params, setParams] = useSearchParams();
  const companyId = params.get('company');
  const requestedTab = params.get('tab') || 'performance-update';
  const normalizedTab = [
    'income-statement',
    'balance-sheet',
    'cashflow',
    'cross-portfolio-kpis',
  ].includes(requestedTab)
    ? 'financials'
    : requestedTab === 'performance-data'
      ? 'performance-update'
      : requestedTab;
  const tab = visibleTabs.some(([key]) => key === normalizedTab)
    ? normalizedTab
    : visibleTabs[0]?.[0];
  const company =
    updatedCompany?.objectId === companyId
      ? updatedCompany
      : companies.find((item) => item.objectId === companyId);

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
          <div className="portfolio-view-eyebrow">Portfolio Reporting / Company</div>
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
                {visibleTabs.map(([key, label]) => (
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
                {tab === 'details' ? (
                  <CompanyDetails
                    key={company.objectId}
                    companyId={company.objectId}
                    onCompanySaved={setUpdatedCompany}
                  />
                ) : tab === 'performance-update' ? (
                  <PerformanceUpdateReport companyId={company.objectId} />
                ) : tab === 'financials' ? (
                  <FinancialsReport companyId={company.objectId} />
                ) : tab === 'bridge' ? (
                  <BridgeReport companyId={company.objectId} />
                ) : tab === 'investor-reporting' ? (
                  <InvestorReporting companyId={company.objectId} />
                ) : tab === 'custom-reports' ? (
                  <CustomReportsView companyId={company.objectId} />
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
          {error && (
            <p className="company-load-error" role="alert">
              {error}
            </p>
          )}
          {companyId && !company && !error && (
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
  if (view === 'fund') return <FundPage />;
  return (
    <div className="portfolio-layout">
      <PortfolioSidebar />
      <main className="portfolio-main" aria-label={titles[view]}>
        <div className="portfolio-view-card">
          <div className="portfolio-view-eyebrow">Portfolio Reporting</div>
          <h1>{titles[view]}</h1>
        </div>
      </main>
    </div>
  );
}
