import { useEffect, useState } from 'react';
import type { AppSettings, ProviderStatus } from '../../core/app-settings';
import { PROVIDER_ERROR_LABELS, UI } from '../data/labels';
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
  settings,
  onClose,
}: {
  theme: ThemeMode;
  setTheme: (m: ThemeMode) => void;
  settings: AppSettings;
  onClose: () => void;
}) {
  // Provider block state (WO-0025 / B1): the stored key draft + the last check result. The quick check on
  // open tells the operator where auth stands before the first "Plan iste" throws.
  const [keyDraft, setKeyDraft] = useState('');
  const [permMode, setPermMode] = useState<'ask' | 'auto'>('ask');
  const [status, setStatus] = useState<ProviderStatus | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void settings.getProviderKey().then((k) => setKeyDraft(k ?? ''));
    void settings.getPermissionMode?.().then((m) => setPermMode(m ?? 'ask'));
    void settings.checkProvider().then(setStatus).catch(() => setStatus(undefined));
  }, [settings]);
  const saveKey = async (): Promise<void> => {
    await settings.setProviderKey(keyDraft.trim() || undefined);
    setStatus(undefined);
  };
  const clearKey = async (): Promise<void> => {
    setKeyDraft('');
    await settings.setProviderKey(undefined);
    setStatus(undefined);
  };
  const runTest = async (): Promise<void> => {
    setTesting(true);
    try {
      if (keyDraft.trim()) await settings.setProviderKey(keyDraft.trim());
      setStatus(await settings.checkProvider());
    } finally {
      setTesting(false);
    }
  };
  const statusText =
    status === undefined ? UI.providerStatusUnknown : status.ok ? `${UI.providerStatusOk} (${status.source})` : PROVIDER_ERROR_LABELS[status.code];
  const statusTone = status?.ok ? 'text-sage' : 'text-clay';

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

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">
          {UI.providerLabel}
        </label>
        <div className="mb-4 rounded-sm border border-rule bg-surface2 p-2.5">
          <p className={`text-[12px] ${statusTone}`}>
            {statusText}
          </p>
          <div className="mt-2 flex gap-1.5">
            <input
              type="password"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={UI.providerKeyPlaceholder}
              className="min-w-0 flex-1 rounded-sm border border-rule bg-bg px-2 py-1 font-mono text-[12px] text-ink"
            />
            <button type="button" onClick={() => void saveKey()} className="btn-ghost shrink-0 rounded px-2.5 py-1 text-xs">
              {UI.providerKeySave}
            </button>
            <button type="button" onClick={() => void clearKey()} className="btn-ghost shrink-0 rounded px-2.5 py-1 text-xs">
              {UI.providerKeyClear}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <button type="button" onClick={() => void runTest()} className="alink text-[12px]">
              {testing ? UI.providerTesting : UI.providerTest}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-inkdim">{UI.providerHint}</p>
        </div>

        <label className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-inkdim">
          {UI.permModeLabel}
        </label>
        <div className="mb-2 flex gap-1 rounded bg-surface2 p-1">
          {(['ask', 'auto'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setPermMode(m); void settings.setPermissionMode?.(m); }}
              className={`flex-1 rounded px-2 py-1.5 text-[12px] font-medium ${m === permMode ? 'bg-bg text-ink' : 'text-inkdim'}`}
            >
              {m === 'ask' ? UI.permModeAsk : UI.permModeAuto}
            </button>
          ))}
        </div>
        <p className="mb-4 text-[11px] text-inkdim">{UI.permModeHint}</p>

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
