export type NavigationView = { name: string; label: string; path: string; icon: string };
export type PortfolioFund = { objectId: string; name: string; currency: string };
export type NavigationSection = {
  name: string;
  label: string;
  icon: string;
  views: NavigationView[];
};
export type PortfolioCompany = {
  objectId: string;
  name: string;
  internal_name: string | null;
  currency: string | null;
  status: string | null;
};
