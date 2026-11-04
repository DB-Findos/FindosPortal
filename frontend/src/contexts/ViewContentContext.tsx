import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useLocation } from 'react-router-dom';
import { captureView } from '../services/view-snapshot';

type ViewContent = {
  recordRead: (path: string, method: string) => (data: unknown) => void;
  register: (name: string, data: unknown) => () => void;
  capture: () => ReturnType<typeof captureView>;
};
const Context = createContext<ViewContent | null>(null);

export function ViewContentProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const route = location.pathname + location.search;
  const state = useRef({
    route,
    reads: new Map<string, { sequence: number; data?: unknown }>(),
    components: new Map<string, unknown>(),
  });
  if (state.current.route !== route)
    state.current = { route, reads: new Map(), components: new Map() };
  const recordRead = useCallback((path: string, method: string) => {
    // Capture only application data loaded by this view, never auth, chats or file contents.
    const allowed =
      !/^\/(auth|ai|design)(\/|$)/.test(path) &&
      (method === 'GET' || /\/(run|evaluate|preview)(\?|$)/.test(path));
    if (!allowed) return () => {};
    const current = state.current;
    const key = path.split('?')[0];
    const sequence = (current.reads.get(key)?.sequence || 0) + 1;
    current.reads.set(key, { sequence });
    return (data: unknown) => {
      if (state.current === current && current.reads.get(key)?.sequence === sequence)
        current.reads.set(key, { sequence, data });
    };
  }, []);
  const register = useCallback((name: string, data: unknown) => {
    const current = state.current;
    current.components.set(name, data);
    return () => {
      if (current.components.get(name) === data) current.components.delete(name);
    };
  }, []);
  const capture = useCallback(async () => {
    const current = state.current;
    const sources = [...current.components].map(([name, data]) => ({ name, data }));
    // Explicit report snapshots are authoritative; API results complement generic settings/data views.
    if (!current.components.size)
      for (const [name, result] of current.reads)
        if (result.data !== undefined) sources.push({ name, data: result.data });
    const result = await captureView(sources);
    if (state.current !== current)
      throw Error(
        'Die Ansicht wurde während der Aufnahme gewechselt. Bitte die Nachricht erneut senden.'
      );
    return result;
  }, []);
  const value = useMemo(() => ({ recordRead, register, capture }), [recordRead, register, capture]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useViewContent() {
  const value = useContext(Context);
  if (!value) throw Error('ViewContentProvider fehlt');
  return value;
}
/** Keep exact, unrounded report values and chart selections in the assistant's visible-view context. */
export function useVisibleViewData(name: string, data: unknown) {
  const { register } = useViewContent();
  useLayoutEffect(() => register(name, data), [register, name, data]);
}
