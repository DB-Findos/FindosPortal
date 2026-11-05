import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from './ApiContext';
import type { Entity, User } from '../types/api';
import type { NavigationSection, PortfolioCompany, PortfolioFund } from '../types/navigation';
type SessionNavigation = {
  sections: NavigationSection[];
  companies: PortfolioCompany[];
  funds: PortfolioFund[];
  error: string;
};
type Auth = {
  user: User | null;
  entities: Entity[];
  loading: boolean;
  navigation: NavigationSection[];
  portfolioCompanies: PortfolioCompany[];
  portfolioFunds: PortfolioFund[];
  navigationError: string;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { request } = useApi();
  const requestRef = useRef(request);
  requestRef.current = request;
  const sessionVersion = useRef(0);
  const navigationRef = useRef<{ userId: string; data: Promise<SessionNavigation> } | null>(null);
  const refreshRef = useRef<Promise<void> | null>(null);
  const [navigation, setNavigation] = useState<NavigationSection[]>([]);
  const [portfolioCompanies, setPortfolioCompanies] = useState<PortfolioCompany[]>([]);
  const [portfolioFunds, setPortfolioFunds] = useState<PortfolioFund[]>([]);
  const [navigationError, setNavigationError] = useState('');
  const [user, setUser] = useState<User | null>(null),
    [entities, setEntities] = useState<Entity[]>([]),
    [loading, setLoading] = useState(true);
  const clearSession = useCallback(() => {
    sessionVersion.current++;
    navigationRef.current = null;
    refreshRef.current = null;
    setUser(null);
    setEntities([]);
    setNavigation([]);
    setPortfolioCompanies([]);
    setPortfolioFunds([]);
    setNavigationError('');
  }, []);
  const refresh = useCallback(() => {
    if (refreshRef.current) return refreshRef.current;
    const version = sessionVersion.current;
    const work = (async () => {
      const me = await requestRef.current<User>('/auth/me');
      if (version !== sessionVersion.current) return;
      if (me.pending_access) {
        navigationRef.current = null;
        setEntities([]);
        setNavigation([]);
        setPortfolioCompanies([]);
        setPortfolioFunds([]);
        setNavigationError('');
        setUser(me);
        return;
      }
      if (!navigationRef.current || navigationRef.current.userId !== me.id) {
        navigationRef.current = {
          userId: me.id,
          data: (async () => {
            const [sections, companies, funds] = await Promise.allSettled([
              requestRef.current<NavigationSection[]>('/navigation'),
              me.permissions.companies?.can_read
                ? requestRef.current<PortfolioCompany[]>('/portfolio/companies')
                : Promise.resolve([] as PortfolioCompany[]),
              me.permissions.funds?.can_read
                ? requestRef.current<PortfolioFund[]>('/portfolio/funds')
                : Promise.resolve([] as PortfolioFund[]),
            ]);
            return {
              sections: sections.status === 'fulfilled' ? sections.value : [],
              companies: companies.status === 'fulfilled' ? companies.value : [],
              funds: funds.status === 'fulfilled' ? funds.value : [],
              error: [sections, companies, funds]
                .map((result) =>
                  result.status === 'rejected'
                    ? String(result.reason?.message || 'Navigation konnte nicht geladen werden.')
                    : ''
                )
                .filter(Boolean)
                .join(' '),
            };
          })(),
        };
      }
      const [catalog, session] = await Promise.all([
        requestRef.current<Entity[]>('/entities'),
        navigationRef.current.data,
      ]);
      if (version !== sessionVersion.current) return;
      setNavigation(session.sections);
      setPortfolioCompanies(session.companies);
      setPortfolioFunds(session.funds);
      setNavigationError(session.error);
      // Render protected content only after the session navigation is ready.
      setEntities(catalog);
      setUser(me);
    })();
    const pending = work.finally(() => {
      if (refreshRef.current === pending) refreshRef.current = null;
    });
    refreshRef.current = pending;
    return pending;
  }, []);
  const logout = useCallback(async () => {
    await requestRef.current('/auth/logout', 'POST');
    clearSession();
  }, [clearSession]);
  useEffect(() => {
    const expired = clearSession;
    window.addEventListener('session-expired', expired);
    refresh()
      .catch(expired)
      .finally(() => setLoading(false));
    return () => window.removeEventListener('session-expired', expired);
  }, [refresh, clearSession]);
  const value = useMemo(
    () => ({
      user,
      entities,
      loading,
      refresh,
      logout,
      navigation,
      portfolioCompanies,
      portfolioFunds,
      navigationError,
    }),
    [
      user,
      entities,
      loading,
      refresh,
      logout,
      navigation,
      portfolioCompanies,
      portfolioFunds,
      navigationError,
    ]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw Error('AuthProvider fehlt');
  return value;
}
