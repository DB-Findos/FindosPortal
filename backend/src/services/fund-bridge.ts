import { Decimal } from 'decimal.js';
import type { DatabaseClient } from '../database/connection.js';
import type { Rights } from './kpi-definitions.js';
import { bridgeReport } from './bridge-report.js';
import { bridgeDefinitions } from './bridge-definitions.js';
import { memoizeCalculationReads } from './kpi-data/sources.js';
import { fundCompanies, fundMonth, type FundScope } from './fund-context.js';

export async function fundBridge(
  db: DatabaseClient,
  rights: Rights,
  fundId: string,
  dimension: 'actual' | 'budget' | 'forecast' | 'plan',
  scope: FundScope,
  requestedDate?: string
) {
  const { fund, companies } = await fundCompanies(db, fundId, scope);
  const date = await fundMonth(
    db,
    companies.map((c) => c.objectId),
    dimension,
    requestedDate
  );
  const shared = memoizeCalculationReads(db);
  const reports: Awaited<ReturnType<typeof bridgeReport>>[] = [];
  for (const company of companies)
    reports.push(
      await bridgeReport(shared, rights, {
        companyId: company.objectId,
        date,
        dimension,
        currency: 'EUR',
        includeHistory: false,
      })
    );
  let running: Decimal | null = null;
  const bars = bridgeDefinitions.map((binding, index) => {
    const available = reports
      .map((report) => report.bars[index])
      .filter((bar) => bar.value !== null && bar.status === 'ok');
    const missingCompanies = companies
      .filter(
        (_, i) => reports[i].bars[index].value === null || reports[i].bars[index].status !== 'ok'
      )
      .map((c) => c.internal_name || c.name);
    const subtotal = available.reduce((sum, bar) => sum.plus(bar.value!), new Decimal(0));
    const value = companies.length > 0 && missingCompanies.length === 0 ? subtotal : null;
    const start = binding.kind === 'total' ? new Decimal(0) : running;
    const end =
      binding.kind === 'total'
        ? value
        : running !== null && value !== null
          ? running.plus(value)
          : null;
    running = end;
    return {
      ...binding,
      kpiId: reports[0]?.bars[index].kpiId ?? null,
      value: value?.toNumber() ?? null,
      start: start?.toNumber() ?? null,
      end: end?.toNumber() ?? null,
      status: value === null ? 'missing' : 'ok',
      message: missingCompanies.length
        ? `Fehlende Werte: ${missingCompanies.join(', ')}`
        : companies.length
          ? null
          : 'Keine Beteiligungen in dieser Auswahl.',
      knownSubtotal: subtotal.toNumber(),
      completeCompanies: available.length,
      totalCompanies: companies.length,
    };
  });
  return {
    fund: { objectId: fund.objectId, name: fund.name },
    date,
    dimension,
    scope,
    currency: { mode: 'EUR', code: 'EUR' },
    valueScale: 1000000,
    bars,
    companies: companies.map((company, index) => ({
      ...company,
      bars: reports[index].bars,
      warnings: reports[index].warnings,
    })),
    warnings: reports.flatMap((report, index) =>
      report.warnings.map(
        (warning) => `${companies[index].internal_name || companies[index].name}: ${warning}`
      )
    ),
  };
}
