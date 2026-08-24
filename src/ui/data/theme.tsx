// src/ui/data/theme.tsx — the theme seam (WO-0040): which face the console wears, and where that
// choice lives. First paint is SYNCHRONOUS (the locale precedent): the localStorage mirror — or,
// with nothing mirrored, Sistem. Theme is renderer-local localStorage BY RULING (src/core/app-settings.ts
// header: presentation only, machine-local like window state) — no port, no DB row, nothing for the
// CLI to read. The resolved theme lands on documentElement's data-theme; index.css owns both faces
// through the semantic tokens (dark = the @theme defaults, light = the [data-theme='light']
// override). Under Sistem the OS matchMedia is followed LIVE; an explicit pick needs no listener.
// This component never throws (it sits above the only ErrorBoundary; every storage access is
// initializer-or-guarded).
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'docket.theme';

function readMirror(): ThemeMode | undefined {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'system' || v === 'light' || v === 'dark' ? v : undefined;
  } catch {
    return undefined; // storage unavailable (privacy mode) — Sistem decides, never a crash
  }
}

function writeMirror(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // best-effort persistence cache; the in-memory theme still applies
  }
}

/** Sistem resolves through the OS; an explicit pick is itself the answer. */
export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  return mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;
}

function applyTheme(resolved: ResolvedTheme): void {
  document.documentElement.dataset.theme = resolved;
}

export interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

// A provider-less render degrades to the CSS default (dark — no attribute, the @theme values stand).
export const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'dark',
  setMode: () => undefined,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const initial = readMirror() ?? 'system';
    applyTheme(resolveTheme(initial, window.matchMedia('(prefers-color-scheme: dark)').matches)); // synchronous — the first frame is already themed
    return initial;
  });
  const resolved = resolveTheme(mode, systemDark);

  // the attribute follows every resolution change (a Sistem flip lands here too)
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Sistem follows the OS LIVE; an explicit pick needs no listener (unsubscribed when not Sistem)
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = (next: ThemeMode): void => {
    setModeState(next); // a no-op setState when next === mode — React bails out
    applyTheme(resolveTheme(next, systemDark)); // adopt optimistically (the locale precedent)
    writeMirror(next);
  };

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

/** The theme + its setter (the Settings selector). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
