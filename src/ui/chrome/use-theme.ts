import { useEffect, useState } from 'react';

// Theme (WO-0013). Dark is the default; 'light' adds the html.light class that overrides the token
// vars; 'system' follows prefers-color-scheme. Persisted to localStorage and applied on mount.
export type ThemeMode = 'light' | 'dark' | 'system';
const KEY = 'docket.theme';
const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

function apply(mode: ThemeMode): void {
  const light = mode === 'light' || (mode === 'system' && !systemDark());
  document.documentElement.classList.toggle('light', light);
}

export function useTheme(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(
    () => ((typeof localStorage !== 'undefined' && localStorage.getItem(KEY)) as ThemeMode) || 'dark',
  );
  useEffect(() => {
    apply(mode);
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      /* storage may be unavailable */
    }
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const fn = () => apply('system');
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [mode]);
  return [mode, setMode];
}
