// Existing Covenant Metric Numbers stay fixed. Only additional, distinct
// Covenants receive another number; their Targets always use number + 1.
export const covenantMetricNumbers: Record<string, Record<string, number>> = {
  Alexa: {
    'Leverage Ratio': 4004100,
    'Interest Cover Ratio': 4004200,
    'EBITDA/Net Interest': 4004300,
  },
  'Ann-Sophie': { 'Leverage Ratio': 4004100 },
  Baldo: { 'Minimum Liquidity': 4004300, 'Minimum EBITDA': 4004400 },
  Camilla: { 'Leverage Ratio': 4004100 },
  Carl: { 'Leverage Ratio': 4004100, DSCR: 4004200, 'Gross Leverage Ratio': 4004300 },
  Fadri: { 'Leverage Ratio': 4004100 },
  Jeannie: { 'Leverage Ratio': 4004100, 'Cash Cover': 4004200 },
  Julia: {
    'Leverage Ratio': 4004100,
    'EBITDA/Net Interest': 4004200,
    'Leverage Ratio (excl. VL)': 4004300,
  },
  Laurie: { 'Leverage Ratio': 4004100, 'Cash Flow Cover': 4004200, 'EBITDA/Net Interest': 4004300 },
  Markus: { 'Leverage Ratio': 4004100 },
  Momo: { 'Leverage Ratio': 4004100 },
  Norbert: { 'Leverage Ratio': 4004100 },
  Oskar: { 'Leverage Ratio': 4004100, 'EBITDA/Net Interest': 4004200 },
  Pagode: { 'Minimum Cash': 4004300, 'Minimum EBITDA': 4004400 },
  Renate: { 'Leverage Ratio': 4004100 },
  Sissi: { 'Leverage Ratio': 4004100, 'Cash Cover': 4004200, 'Interest Cover': 4004400 },
  Ulrich: { 'Leverage Ratio': 4004100, DSCR: 4004200 },
  Valena: { 'Senior Leverage': 4004100, 'Cash Flow Cover': 4004200 },
  Valeria: { 'Leverage Ratio': 4004100, Capex: 4004300 },
};
export const covenantCompanyAliases: Record<string, string> = { 'Ann-Sophie': 'Angelina' };
