import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useApi } from './ApiContext';
import type { Entity, User } from '../types/api';
type Auth = {
  user: User | null;
  entities: Entity[];
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<Auth | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const { request } = useApi();
  const [user, setUser] = useState<User | null>(null),
    [entities, setEntities] = useState<Entity[]>([]),
    [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    const me = await request<User>('/auth/me');
    const catalog = await request<Entity[]>('/entities');
    console.log(catalog);
    setUser(me);
    setEntities(catalog);
  }, [request]);
  const logout = useCallback(async () => {
    await request('/auth/logout', 'POST');
    setUser(null);
    setEntities([]);
  }, [request]);
  useEffect(() => {
    const expired = () => {
      setUser(null);
      setEntities([]);
    };
    window.addEventListener('session-expired', expired);
    refresh()
      .catch(expired)
      .finally(() => setLoading(false));
    return () => window.removeEventListener('session-expired', expired);
  }, [refresh]);
  const value = useMemo(
    () => ({ user, entities, loading, refresh, logout }),
    [user, entities, loading, refresh, logout]
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw Error('AuthProvider fehlt');
  return value;
}
