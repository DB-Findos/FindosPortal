import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarDays } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useReportContext } from '../hooks/useReportContext';
import PortfolioSidebar from '../components/layout/PortfolioSidebar';
import FundBridgeReport from '../components/portfolio/funds/FundBridgeReport';
import FundDataStatus from '../components/portfolio/funds/FundDataStatus';
import '../components/portfolio/PerformanceUpdateReport.css';
import '../components/portfolio/funds/FundReporting.css';
export default function FundPage() {
  const { portfolioFunds, navigationError } = useAuth();
  const [params, setParams] = useSearchParams();
  const fundId = params.get('fund') || '';
  const fund = portfolioFunds.find((item) => item.objectId === fundId);
  const tab = params.get('tab') === 'data-status' ? 'data-status' : 'bridge';
  const { date, setDate } = useReportContext(fundId);
  const [dimension, setDimension] = useState('actual');
  const [scope, setScope] = useState('portfolio');
  const [resolved, setResolved] = useState({ fundId, date: '' });
  const onDateResolved = useCallback(
    (value: string) => setResolved({ fundId, date: value }),
    [fundId]
  );
  const context = { fundId, date, dimension, scope, onDateResolved };
  return (
    <div className="portfolio-layout">
      <PortfolioSidebar />
      <main className="portfolio-main" aria-label="Funds">
        <div className="portfolio-view-card company-view-card">
          <div className="portfolio-view-eyebrow">Portfolio Reporting / Funds</div>
          <div className="company-title-row">
            <h1>{fund?.name || 'Fund auswählen'}</h1>
          </div>
          {fund ? (
            <>
              <nav className="company-tabs" aria-label="Fund Reports">
                {[
                  ['bridge', 'Bridge'],
                  ['data-status', 'Datenstand'],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    className={tab === key ? 'active' : ''}
                    onClick={() => {
                      const next = new URLSearchParams(params);
                      next.set('tab', key);
                      setParams(next);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </nav>
              <div className="fund-report-panel">
                <div className="performance-toolbar fund-report-toolbar">
                  <div className="performance-pickers">
                    <label>
                      <span>Fund</span>
                      <select
                        value={fundId}
                        onChange={(event) => {
                          const next = new URLSearchParams(params);
                          next.set('fund', event.target.value);
                          setParams(next);
                        }}
                      >
                        {portfolioFunds.map((item) => (
                          <option key={item.objectId} value={item.objectId}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Stichtag</span>
                      <span className="performance-input-wrap">
                        <CalendarDays size={15} />
                        <input
                          type="month"
                          value={date || (resolved.fundId === fundId ? resolved.date : '')}
                          onChange={(event) => setDate(event.target.value)}
                        />
                      </span>
                    </label>
                    <label>
                      <span>Dimension</span>
                      <select
                        value={dimension}
                        onChange={(event) => setDimension(event.target.value)}
                      >
                        <option value="actual">Actual</option>
                        <option value="budget">Budget</option>
                        <option value="forecast">Forecast</option>
                        <option value="plan">Findos Plan</option>
                      </select>
                    </label>
                    <label>
                      <span>Beteiligungen</span>
                      <select value={scope} onChange={(event) => setScope(event.target.value)}>
                        <option value="portfolio">Aktives Portfolio</option>
                        <option value="all" disabled>
                          Portfolio inkl. Exits · folgt
                        </option>
                      </select>
                    </label>
                    {tab === 'bridge' && <div className="fund-currency-context">EUR · Euro</div>}
                  </div>
                </div>
                {tab === 'bridge' ? (
                  <FundBridgeReport {...context} />
                ) : (
                  <FundDataStatus {...context} />
                )}
              </div>
            </>
          ) : (
            <div className="company-empty-report">
              <span>Funds</span>
              <p>Wähle links Fund II, Fund III oder Fund IV aus.</p>
            </div>
          )}
          {navigationError && (
            <p className="company-load-error" role="alert">
              {navigationError}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
