import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useApi } from '../../../contexts/ApiContext';
import { useVisibleViewData } from '../../../contexts/ViewContentContext';
import BridgeWaterfall from '../bridge/BridgeWaterfall';
import FundTable from './FundTable';
import { bridgeNumber } from '../bridge/bridge-types';
import type { FundBridgeResponse, FundReportContext } from './types';
import '../IncomeStatementReport.css';
import '../bridge/BridgeReport.css';

export default function FundBridgeReport({
  fundId,
  date,
  dimension,
  scope,
  onDateResolved,
}: FundReportContext) {
  const { request } = useApi();
  const [report, setReport] = useState<FundBridgeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const query = new URLSearchParams({ dimension, scope });
    if (date) query.set('date', date);
    request<FundBridgeResponse>(`/portfolio/funds/${fundId}/bridge?${query}`)
      .then((value) => {
        if (active) {
          setReport(value);
          onDateResolved(value.date);
        }
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [fundId, date, dimension, scope, request, onDateResolved]);
  const current =
    report?.fund.objectId === fundId &&
    (!date || report.date === date) &&
    report.dimension === dimension &&
    report.scope === scope
      ? report
      : null;
  useVisibleViewData('Fund Equity Bridge', {
    fundId,
    date: date || current?.date,
    dimension,
    scope,
    currency: 'EUR',
    report: current,
    loading,
    error,
    visualizations: ['In EUR aggregierte Equity-Brücke aller ausgewählten Fund-Beteiligungen'],
  });
  return (
    <section className="fund-bridge-content">
      {error && (
        <div className="performance-message error" role="alert">
          {error}
        </div>
      )}
      {loading && (
        <div className="performance-refreshing" role="status">
          <RefreshCw className="performance-spin" size={14} />
          Fund-Brücke wird geladen …
        </div>
      )}
      {current && !error && (
        <>
          <div className="income-chart-card fund-bridge-chart">
            <div className="income-chart-meta">
              <span>{current.companies.length} Beteiligungen · in Mio. EUR</span>
              <span>T0 · Entry bis T1 · {current.date}</span>
            </div>
            <BridgeWaterfall
              bars={current.bars}
              currency="EUR"
              scale={current.valueScale}
              selected={[]}
              toggle={() => {}}
            />
          </div>
          <div className="fund-bridge-breakdown">
            <FundTable
              name={`fund-bridge:${fundId}`}
              columns={[
                { key: 'company', label: 'Company' },
                ...current.bars.map((bar) => ({ key: bar.key, label: bar.label })),
              ]}
              rows={current.companies.map((company) => ({
                key: company.objectId,
                cells: {
                  company: company.internal_name || company.name,
                  ...Object.fromEntries(
                    company.bars.map((bar) => [
                      bar.key,
                      <span title={bar.message || ''}>
                        {bridgeNumber(bar.value, current.valueScale)}
                      </span>,
                    ])
                  ),
                },
              }))}
              footer={{
                company: 'Gesamt ? Mio. EUR',
                ...Object.fromEntries(
                  current.bars.map((bar) => [
                    bar.key,
                    <span title={bar.message || ''}>
                      {bridgeNumber(bar.value, current.valueScale)}
                      {bar.status !== 'ok' && (
                        <small>
                          {bar.completeCompanies}/{bar.totalCompanies} vorhanden
                        </small>
                      )}
                    </span>,
                  ])
                ),
              }}
            />
          </div>
          {!current.companies.length && (
            <p className="fund-status-note">Keine Beteiligungen in dieser Auswahl.</p>
          )}
          {current.bars.some((bar) => bar.status !== 'ok') && current.companies.length > 0 && (
            <p className="fund-status-note">
              Unvollständige Summen werden als „–“ angezeigt. Fehlende Unternehmenswerte werden
              nicht als 0 angesetzt.
            </p>
          )}
          {current.warnings.length > 0 && (
            <details className="fund-report-warnings">
              <summary>Hinweise zu den Quelldaten ({current.warnings.length})</summary>
              {current.warnings.map((warning, index) => (
                <p key={index}>{warning}</p>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
