// App settings (WO-0031 restyle on the kit Dialog): auth status + Test + the DEFAULT permission rule
// (WO-0031c — each work order carries its own; this is only the default new ones start from) + language
// placeholder + version. Theme is gone (dark-only); the stored-API-key field was removed at the
// operator's request — auth rides the provider CLI login, which Test verifies.
import { useEffect, useState } from 'react';
import type { AppSettings, ProviderStatus } from '../../core/app-settings';
import type { PermissionRule } from '../../core/source';
import { PERMISSION_RULE_LABELS, PROVIDER_ERROR_LABELS, UI } from '../data/labels';
import { VERSION } from '../data/version';
import { Button, Dialog, Segmented, Spinner } from '../kit';

export function AppSettingsModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  // Auth status (WO-0025 / B1): the quick check on open tells the operator where auth stands before the
  // first "Plan iste" throws; Test re-runs the zero-token handshake on demand.
  const [rule, setRule] = useState<PermissionRule>('risky_excluded');
  const [status, setStatus] = useState<ProviderStatus | undefined>(undefined);
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    void settings.getPermissionRule?.().then((r) => setRule(r ?? 'risky_excluded'));
    void settings.checkProvider().then(setStatus).catch(() => setStatus(undefined));
  }, [settings]);
  const runTest = async (): Promise<void> => {
    setTesting(true);
    try {
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
          <div className="flex items-center gap-3">
            {testing ? <Spinner /> : <span className={`text-xs ${statusTone}`}>{statusText}</span>}
            <button type="button" onClick={() => void runTest()} className="alink ml-auto text-[12px]">
              {UI.providerTest}
            </button>
          </div>
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.permRuleLabel}
          </span>
          <Segmented
            value={rule}
            onValueChange={(r) => { setRule(r); void settings.setPermissionRule?.(r); }}
            options={[
              { value: 'ask_every', label: PERMISSION_RULE_LABELS.ask_every },
              { value: 'risky_excluded', label: PERMISSION_RULE_LABELS.risky_excluded },
              { value: 'full_auto', label: PERMISSION_RULE_LABELS.full_auto },
            ]}
          />
          <p className="mt-1.5 text-[11px] leading-relaxed text-inkdim">
            {rule === 'ask_every' ? UI.permRuleAskHint : rule === 'full_auto' ? UI.permRuleFullHint : UI.permRuleRiskyHint}
            {' '}{UI.permRuleHint}
          </p>
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
