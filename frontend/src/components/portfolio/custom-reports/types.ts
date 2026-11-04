export type CustomReportSummary = {
  objectId: string;
  id: string;
  name: string;
  description: string;
  owner_id: string;
  is_owner: boolean;
  lastModifiedAt: string;
};
export type CustomReportRun = CustomReportSummary & {
  html: string;
  context: {
    company_id: string;
    date: string;
    dimension: string;
    currency: string;
    currency_code: string;
  };
  bindings: {
    key: string;
    label: string;
    status: string;
    message?: string;
    value?: string | null;
    formatted?: string;
    points?: unknown[];
    rows?: unknown[];
  }[];
  warnings: string[];
};
