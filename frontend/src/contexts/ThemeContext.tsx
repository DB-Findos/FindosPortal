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
import type { Colors, Design } from '../types/api';
export const defaultColors: Colors = {
  primary: '#246649',
  secondary: '#738077',
  accent: '#a7d5bc',
  background: '#f7f9f8',
  surface: '#ffffff',
  text: '#22332d',
};
type Theme = {
  design: Design;
  refresh: () => Promise<void>;
  save: (
    colors: Colors,
    logo?: { name: string; mime_type: string; data_base64: string } | null
  ) => Promise<void>;
};
const ThemeContext = createContext<Theme | null>(null);
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { request } = useApi();
  const [design, setDesign] = useState<Design>({
    id: null,
    objectId: null,
    colors: defaultColors,
    logo: null,
  });
  const refresh = useCallback(async () => {
    setDesign(await request<Design>('/design'));
  }, [request]);
  useEffect(() => {
    void refresh().catch(() => {});
  }, [refresh]);
  useEffect(() => {
    for (const [key, value] of Object.entries(design.colors))
      document.documentElement.style.setProperty('--' + key, value);
    const rgb = design.colors.primary
      .slice(1)
      .match(/../g)!
      .map((v) => parseInt(v, 16));
    document.documentElement.style.setProperty(
      '--on-primary',
      rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 155 ? '#13221a' : '#ffffff'
    );
  }, [design.colors]);
  const save = useCallback(
    async (
      colors: Colors,
      logo?: { name: string; mime_type: string; data_base64: string } | null
    ) => {
      setDesign(
        await request<Design>(
          '/design',
          'PUT',
          { colors, ...(logo === undefined ? {} : { logo }) },
          design.id || 'new'
        )
      );
    },
    [request, design.id]
  );
  const value = useMemo(() => ({ design, refresh, save }), [design, refresh, save]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw Error('ThemeProvider fehlt');
  return value;
}
