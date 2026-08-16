// src/ui/data/view-mode.ts — the GLOBAL SADE/DETAY view (WO-0031c / v4).
//
// v4 ruling: one toggle in the strip owns the WHOLE screen (not per-pane, as Faz B had it), default
// SADE, remembered across reloads. localStorage is a renderer web API — no Node, no Electron import,
// boundary-clean. The provider persists on change and rehydrates once on mount; invalid stored values
// coerce to the default instead of throwing.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ViewMode = 'sade' | 'detail';

const STORAGE_KEY = 'docket.view-mode';

function readStored(): ViewMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'detail' ? 'detail' : 'sade';
  } catch {
    return 'sade'; // storage unavailable (privacy mode) — the default, never a crash
  }
}

const ViewModeContext = createContext<{ mode: ViewMode; setMode: (m: ViewMode) => void }>({
  mode: 'sade',
  setMode: () => undefined,
});

export function ViewModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ViewMode>(readStored);
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // best-effort persistence; the in-memory mode still applies
    }
  }, [mode]);
  return <ViewModeContext.Provider value={{ mode, setMode }}>{children}</ViewModeContext.Provider>;
}

export function useViewMode(): { mode: ViewMode; setMode: (m: ViewMode) => void } {
  return useContext(ViewModeContext);
}
