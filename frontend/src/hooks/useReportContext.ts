import { useState } from 'react';

/** An empty date asks the API for the latest data month of the selected company. */
export function useReportContext(companyId: string) {
  const [selection, setSelection] = useState({ companyId, date: '' });
  const [currency, setCurrency] = useState<'CC' | 'EUR'>('EUR');
  return {
    date: selection.companyId === companyId ? selection.date : '',
    setDate: (date: string) => setSelection({ companyId, date }),
    currency,
    setCurrency,
  };
}
