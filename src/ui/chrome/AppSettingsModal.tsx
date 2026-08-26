// App settings (WO-0031 restyle on the kit Dialog): auth status + Test + the DEFAULT permission rule
// (WO-0031c — each work order carries its own; this is only the default new ones start from) + the
// language selector (WO-0035 — live: writes the stored row + the localStorage mirror) + the theme
// selector (WO-0040 — Sistem/Açık/Karanlık; renderer-local localStorage per the app-settings.ts
// ruling: presentation only, no port) + version. The stored-API-key field was removed at the
// operator's request — auth rides the provider CLI login, which Test verifies.
// WO-0047: the workspace's monthly budget — cap + warn percent as one atomic draft with Kaydet
// (numbers never write mid-keystroke; the Segmented immediate-write pattern suits closed enums,
// not decimals) + Kaldır when a threshold exists + the current month readout beneath.
import { useEffect, useState } from 'react';
import type { AppSettings, ProviderStatus } from '../../core/app-settings';
import type { PermissionRule, WorkOrderSource } from '../../core/source';
import type { WorkspaceId } from '../../core/types';
import type { BudgetThreshold } from '../../core/budget';
import { DEFAULT_WARN_PERCENT, parseAmount } from '../../core/budget';
import { useLabels, useLocale } from '../data/locale';
import { useTheme } from '../data/theme';
import { VERSION } from '../data/version';
import { Button, Dialog, Field, Input, Segmented, Spinner } from '../kit';

export function AppSettingsModal({
  settings,
  workspaceId,
  source,
  onBudgetChanged,
  onClose,
}: {
  settings: AppSettings;
  /** WO-0047: the active workspace — null (empty database) renders no budget section (ADR-0001). */
  workspaceId: WorkspaceId | null;
  source: WorkOrderSource;
  onBudgetChanged: () => void;
  onClose: () => void;
}) {
  const { UI, PERMISSION_RULE_LABELS, PROVIDER_ERROR_LABELS } = useLabels();
  const { locale, setLocale } = useLocale();
  const { mode, setMode } = useTheme();
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

  // WO-0047 — the workspace's budget section state: the stored threshold, the draft, the month's
  // observed spend (the readout), and per-field errors that appear only after a save attempt
  // (WO-0036: the refusal teaches under the field it failed on; validity never locks the button).
  const [budgetStored, setBudgetStored] = useState<BudgetThreshold | undefined>(undefined);
  const [capText, setCapText] = useState('');
  const [warnText, setWarnText] = useState('');
  const [monthSpend, setMonthSpend] = useState<{ usd: number; hasUnknown: boolean } | undefined>(undefined);
  const [budgetTouched, setBudgetTouched] = useState(false);
  const [budgetBusy, setBudgetBusy] = useState(false);
  const readBudget = (wsId: WorkspaceId): void => {
    void settings.getBudget?.(wsId).then((t) => {
      setBudgetStored(t);
      setCapText(t ? String(t.capUsd) : '');
      setWarnText(t ? String(t.warnPercent) : '');
      setBudgetTouched(false);
    });
    void source.workspaceMonthSpend(wsId).then(setMonthSpend).catch(() => setMonthSpend(undefined));
  };
  useEffect(() => {
    if (workspaceId) readBudget(workspaceId);
  }, [workspaceId, settings, source]);
  const capParsed = parseAmount(capText);
  const warnParsed = parseAmount(warnText);
  const capErr = !budgetTouched || budgetBusy ? null : !(capParsed > 0) ? UI.budgetErrCap : null;
  const warnErr = !budgetTouched || budgetBusy ? null : !(warnParsed >= 1 && warnParsed <= 100) ? UI.budgetErrWarn : null;
  const budgetValid = capParsed > 0 && warnParsed >= 1 && warnParsed <= 100;
  const saveBudget = async (): Promise<void> => {
    if (!workspaceId) return;
    setBudgetTouched(true);
    if (!budgetValid || budgetBusy) return;
    setBudgetBusy(true);
    try {
      await settings.setBudget?.(workspaceId, { capUsd: capParsed, warnPercent: warnParsed });
      readBudget(workspaceId);
      onBudgetChanged();
    } finally {
      setBudgetBusy(false);
    }
  };
  const clearBudget = async (): Promise<void> => {
    if (!workspaceId || budgetBusy) return;
    setBudgetBusy(true);
    try {
      await settings.setBudget?.(workspaceId, undefined);
      readBudget(workspaceId);
      onBudgetChanged();
    } finally {
      setBudgetBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.settings}
      closeAria={UI.dialogCloseAria}
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
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.language}
          </span>
          <Segmented
            value={locale}
            onValueChange={(l) => setLocale(l)}
            options={[
              { value: 'tr', label: UI.langTr },
              { value: 'en', label: UI.langEn },
            ]}
          />
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.theme}
          </span>
          <Segmented
            value={mode}
            onValueChange={(m) => setMode(m)}
            options={[
              { value: 'system', label: UI.themeSystem },
              { value: 'light', label: UI.themeLight },
              { value: 'dark', label: UI.themeDark },
            ]}
          />
        </section>

        {workspaceId ? (
          // WO-0047 — the workspace's month-spend threshold. One atomic draft (cap + warn percent
          // persist as ONE row); the readout beneath is the feedback loop, in the money voice.
          <section data-budget-section="">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
              {UI.budgetLabel}
            </span>
            <div className="grid grid-cols-2 gap-3">
              <Field label={UI.budgetCapLabel} error={capErr}>
                <Input
                  value={capText}
                  inputMode="decimal"
                  aria-label={UI.budgetCapLabel}
                  aria-invalid={capErr !== null}
                  onChange={(e) => { setCapText(e.target.value); setBudgetTouched(true); }}
                />
              </Field>
              <Field
                label={UI.budgetWarnPercentLabel}
                error={warnErr}
                hint={budgetStored ? undefined : `${DEFAULT_WARN_PERCENT}`}
              >
                <Input
                  value={warnText}
                  inputMode="decimal"
                  aria-label={UI.budgetWarnPercentLabel}
                  aria-invalid={warnErr !== null}
                  onChange={(e) => { setWarnText(e.target.value); setBudgetTouched(true); }}
                />
              </Field>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button variant="primary" size="sm" busy={budgetBusy} locked={budgetBusy} onClick={() => void saveBudget()}>
                {UI.budgetSave}
              </Button>
              {budgetStored ? (
                <Button variant="ghost" size="sm" onClick={() => void clearBudget()}>{UI.budgetClear}</Button>
              ) : null}
              {budgetStored && monthSpend ? (
                <span
                  data-budget-month-readout=""
                  className="ml-auto font-mono text-[11px] text-inkdim"
                >
                  {monthSpend.hasUnknown
                    ? UI.budgetMonthReadoutKnown(monthSpend.usd, budgetStored.capUsd)
                    : UI.budgetMonthReadout(monthSpend.usd, budgetStored.capUsd)}
                </span>
              ) : null}
            </div>
          </section>
        ) : null}

        <p className="border-t border-hairline pt-3 font-mono text-[11px] text-inkdim">
          {UI.productName} · v{VERSION}
        </p>
      </div>
    </Dialog>
  );
}
