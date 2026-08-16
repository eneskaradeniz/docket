// App settings (WO-0031 restyle on the kit Dialog): provider access + İzin modu + language
// placeholder + version. Theme is gone — dark-only by the console ruling.
import { useEffect, useState } from 'react';
import type { AppSettings, ProviderStatus } from '../../core/app-settings';
import { PROVIDER_ERROR_LABELS, UI } from '../data/labels';
import { VERSION } from '../data/version';
import { Button, Dialog, Field, Input, Segmented, Spinner } from '../kit';

export function AppSettingsModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
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
    status === undefined
      ? UI.providerStatusUnknown
      : status.ok
        ? `${UI.providerStatusOk} (${status.source})`
        : PROVIDER_ERROR_LABELS[status.code];
  const statusTone = status?.ok ? 'text-proceed' : 'text-error';

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.settings}
      footer={
        <Button variant="primary" size="sm" onClick={onClose}>
          {UI.close}
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <Field label={UI.providerKeyLabel} hint={UI.providerHint}>
            <div className="flex gap-1.5">
              <Input
                type="password"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                placeholder={UI.providerKeyPlaceholder}
                className="font-mono"
              />
              <Button size="sm" variant="secondary" onClick={() => void saveKey()}>{UI.providerKeySave}</Button>
              <Button size="sm" variant="ghost" onClick={() => void clearKey()}>{UI.providerKeyClear}</Button>
            </div>
          </Field>
          <div className="mt-2 flex items-center gap-3">
            {testing ? <Spinner /> : <span className={`text-xs ${statusTone}`}>{statusText}</span>}
            <button type="button" onClick={() => void runTest()} className="alink ml-auto text-[12px]">
              {UI.providerTest}
            </button>
          </div>
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.permModeLabel}
          </span>
          <Segmented
            value={permMode}
            onValueChange={(m) => { setPermMode(m); void settings.setPermissionMode?.(m); }}
            options={[
              { value: 'ask', label: UI.permModeAsk },
              { value: 'auto', label: UI.permModeAuto },
            ]}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-inkdim">{UI.permModeHint}</p>
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.language}
          </span>
          <Segmented
            value="tr"
            onValueChange={() => undefined}
            options={[
              { value: 'tr', label: UI.langTr },
              { value: 'en', label: UI.langEn },
            ]}
          />
          <p className="mt-1.5 text-[11px] text-inkdim">{UI.langHint}</p>
        </section>

        <p className="border-t border-hairline pt-3 font-mono text-[11px] text-inkdim">
          {UI.productName} · v{VERSION}
        </p>
      </div>
    </Dialog>
  );
}
