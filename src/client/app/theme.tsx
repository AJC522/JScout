import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppSettings, Bootstrap, ThemePreference } from '../../shared/types';
import { api, errorMessage } from '../api/client';
import { useToast } from '../components/ui/Toast';
import { useMediaQuery } from '../lib/hooks';
import { qk } from '../lib/query';
import { applyTheme, readStoredTheme, storeTheme } from './theme-storage';

interface ThemeContextValue {
  /** The saved preference. */
  theme: ThemePreference;
  /** What is on screen right now ('system' resolved through the OS setting). */
  resolvedTheme: 'light' | 'dark';
  setTheme: (theme: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Owns the theme. The server's AppSettings.theme is the source of truth; localStorage
 * mirrors it so theme-init.js can apply it before first paint. A change applies at once,
 * then is saved with PATCH /api/settings.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [theme, setThemeState] = useState<ThemePreference>(() => readStoredTheme() ?? 'system');
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');

  const settings = useQuery({
    queryKey: qk.settings(),
    queryFn: ({ signal }) => api('GET /api/settings', { signal }),
  });

  // Adopt the server's value whenever it changes (first load, or the Settings page saved one).
  const lastServerTheme = useRef<ThemePreference | undefined>(undefined);
  const serverTheme = settings.data?.theme;
  useEffect(() => {
    if (!serverTheme || serverTheme === lastServerTheme.current) return;
    lastServerTheme.current = serverTheme;
    setThemeState(serverTheme);
  }, [serverTheme]);

  useEffect(() => {
    applyTheme(theme);
    storeTheme(theme);
  }, [theme]);

  const save = useMutation({
    mutationFn: (next: ThemePreference) => api('PATCH /api/settings', { body: { theme: next } }),
    onSuccess: (saved) => {
      lastServerTheme.current = saved.theme;
      queryClient.setQueryData<AppSettings>(qk.settings(), saved);
      queryClient.setQueryData<Bootstrap>(qk.bootstrap(), (old) => (old ? { ...old, settings: saved } : old));
    },
    onError: (error) => {
      toast.error('Theme changed on this device only', { description: `It could not be saved: ${errorMessage(error)}`, id: 'theme-save' });
    },
  });
  const { mutate } = save;

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      mutate(next);
    },
    [mutate],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme: theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme, setTheme }),
    [theme, prefersDark, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
