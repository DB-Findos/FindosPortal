import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useViewContent } from './ViewContentContext';
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
type Upload = <T = any>(path: string, file: File) => Promise<T>;
const ApiContext = createContext<{ request: Request; upload: Upload } | null>(null);
export function ApiProvider({ children }: { children: ReactNode }) {
  const { recordRead } = useViewContent();
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener('portal-data-changed', refresh);
    return () => window.removeEventListener('portal-data-changed', refresh);
  }, []);
  const request: Request = useCallback(
    async (path, method = 'GET', body, versionId) => {
      const record = recordRead(path, method);
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
      record(result);
      return result;
    },
    [revision, recordRead]
  );
  const upload: Upload = useCallback(async (path, file) => {
    const response = await fetch('/api' + path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Requested-With': 'FindosPortal',
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 401) window.dispatchEvent(new Event('session-expired'));
      throw new ApiError(
        response.status,
        result.error || 'Upload fehlgeschlagen.',
        result.fieldErrors || {}
      );
    }
    return result;
  }, []);
  const value = useMemo(() => ({ request, upload }), [request, upload]);
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}
export function useApi() {
  const value = useContext(ApiContext);
  if (!value) throw Error('ApiProvider fehlt');
  return value;
}
