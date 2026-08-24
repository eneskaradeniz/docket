// src/ui/data/theme.tsx — the theme seam (WO-0040): which face the console wears, and where that
// choice lives. First paint is SYNCHRONOUS (the locale precedent): the localStorage mirror — or,
// with nothing mirrored, Sistem. Theme is renderer-local localStorage BY RULING (src/core/app-settings.ts
// header: presentation only, machine-local like window state) — no port, no DB row, nothing for the
// CLI to read. The resolved theme lands on documentElement's data-theme; index.css owns both faces
// through the semantic tokens (dark = the @theme defaults, light = the [data-theme='light']
// override). Under Sistem the OS matchMedia is followed LIVE; an explicit pick needs no listener.
// Storage access is catch-guarded throughout; matchMedia is Electron-guaranteed (unguarded by
// design — this component sits above the only ErrorBoundary).
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

  // Sistem follows the OS LIVE; an explicit pick needs no listener (unsubscribed when not Sistem).
  // Re-sync on (re)subscribe: the OS may have flipped while an explicit pick held the listener
  // off, and a stale systemDark would paint Sistem the wrong face until the next flip
  // (review round, 2026-08-24).
  useEffect(() => {
    if (mode !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setSystemDark(mq.matches);
    const onChange = (e: MediaQueryListEvent): void => setSystemDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = (next: ThemeMode): void => {
    setModeState(next); // a no-op setState when next === mode — React bails out
    // adopt optimistically (the locale precedent) — under Sistem read the OS LIVE: the stored
    // state may be stale (the re-sync effect corrects it one paint later)
    applyTheme(resolveTheme(next, next === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : systemDark));
    writeMirror(next);
  };

  return <ThemeContext.Provider value={{ mode, resolved, setMode }}>{children}</ThemeContext.Provider>;
}

/** The theme + its setter (the Settings selector). */
export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
