import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: Record<string, string> = {}
  ) {
    super(message);
  }
}
type Request = <T = any>(
  path: string,
  method?: string,
  body?: unknown,
  versionId?: string
) => Promise<T>;
const ApiContext = createContext<{ request: Request } | null>(null);
export function ApiProvider({ children }: { children: ReactNode }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('portal-data-changed', refresh);
    return () => window.removeEventListener('portal-data-changed', refresh);
  }, []);
  const request: Request = useCallback(
    async (path, method = 'GET', body, versionId) => {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Requested-With': 'FindosPortal',
      };
      if (versionId) headers['If-Match'] = versionId;
      const response = await fetch('/api' + path, {
        method,
        credentials: 'same-origin',
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.status === 204) return null;
      const result = await response.json();
      if (!response.ok) {
        if (response.status === 401 && path !== '/auth/login')
          window.dispatchEvent(new Event('session-expired'));
        throw new ApiError(
          response.status,
          result.error || 'Anfrage fehlgeschlagen.',
          result.fieldErrors || {}
        );
      }
      return result;
    },
    [revision]
  );
  const value = useMemo(() => ({ request }), [request]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}
export function useApi() {
  const value = useContext(ApiContext);
  if (!value) throw Error('ApiProvider fehlt');
  return value;
}
