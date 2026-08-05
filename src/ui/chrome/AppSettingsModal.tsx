import { useEffect } from 'react';
import { UI } from '../data/labels';
import { VERSION } from '../data/version';
import type { ThemeMode } from './use-theme';

const THEMES: readonly ThemeMode[] = ['light', 'dark', 'system'] as const;
const THEME_LABEL: Record<ThemeMode, string> = {
  light: UI.themeLight,
  dark: UI.themeDark,
  system: UI.themeSystem,
};

// App settings (WO-0013): theme (live-swaps the palette), language (inert until M3.5 — not disabled,
// just no consumer), version. Centered modal like the work-order modals.
export function AppSettingsModal({
  theme,
  setTheme,
  onClose,
}: {
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onEsc);
    return () => document.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center px-4 pt-24"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-md border border-rule bg-surface p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">{UI.settings}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={UI.close}
            className="-mr-1.5 -mt-1.5 grid h-7 w-7 place-items-center rounded text-[14px] text-inkdim hover:bg-surface2 hover:text-ink"
          >
            ✕
          </button>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">
          {UI.theme}
        </label>
        <div className="mb-4 flex gap-1 rounded bg-surface2 p-1">
          {THEMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={`flex-1 rounded px-2 py-1.5 text-[12px] font-medium ${t === theme ? 'bg-bg text-ink' : 'text-inkdim'}`}
            >
              {THEME_LABEL[t]}
            </button>
          ))}
        </div>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">
          {UI.language}
        </label>
        <div className="mb-4 flex gap-1 rounded bg-surface2 p-1">
          <button type="button" className="flex-1 rounded px-2 py-1.5 text-[12px] font-medium text-inkdim">
            {UI.langEn}
          </button>
          <button type="button" className="flex-1 rounded bg-bg px-2 py-1.5 text-[12px] font-medium text-ink">
            {UI.langTr}
          </button>
        </div>

        <div className="my-4 border-t border-rule" />
        <p className="font-mono text-[11px] text-inkdim">
          {UI.productName} · v{VERSION}
        </p>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="btn-ghost rounded px-4 py-1.5 text-[12px]">
            {UI.close}
          </button>
        </div>
      </div>
    </div>
  );
}
