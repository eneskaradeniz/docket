// App settings (WO-0031 restyle on the kit Dialog) — WO-0059 rev 3 (the operator's 2026-08-31
// "her şey kötü, kullanışsız" round, redesigned with the ui-ux pass): ONE SCROLL, no tabs — three
// readout-headed sections (SAĞLAYICI · MODELLER · GENEL · ÇALIŞMA ALANI) separated by hairlines,
// the version line in the footer's left slot (the WsSettingsModal idiom). The model preference is
// PER-ROLE and renders as an ASSIGNMENT MATRIX (the one aesthetic risk): preset ids are COLUMN
// HEADS — each id appears ONCE — each role row carries its rlamp + role hue, a pressed cell shows
// ● (the karar-deposu marker idiom), and an `özel` column holds the verbatim custom id. Empty role
// = provider default, SHOWN by the unpressed grid (no placeholder fake). More than 4 presets or an
// empty preset set degrades to full-width role rows with wrapped chips. All state rides the same
// atomic draft (one Kaydet, never a mid-keystroke write); the workspace section is ABSENT on an
// empty database (ADR-0001); errors stay under their fields with role="alert" (WO-0036).
import { Fragment, useEffect, useState } from 'react';
import type { AppSettings, ProviderStatus, RoleModels } from '../../core/app-settings';
import type { PermissionRule, WorkOrderSource } from '../../core/source';
import type { WorkspaceId } from '../../core/types';
import type { BudgetThreshold } from '../../core/budget';
import { DEFAULT_WARN_PERCENT, parseAmount } from '../../core/budget';
import { normalizeDocsRoot } from '../../core/roadmap-md';
import { useLabels, useLocale } from '../data/locale';
import { useTheme } from '../data/theme';
import { VERSION } from '../data/version';
import { Button, Dialog, Field, Input, Segmented, Spinner } from '../kit';

const MODEL_ROLES = ['architect', 'implementer', 'verifier'] as const;
type ModelRole = (typeof MODEL_ROLES)[number];
const ROLE_HUE: Record<ModelRole, string> = { architect: 'text-signal', implementer: 'text-info', verifier: 'text-proceed' };

export function AppSettingsModal({
  settings,
  workspaceId,
  source,
  onBudgetChanged,
  onDocsRootChanged,
  onClose,
}: {
  settings: AppSettings;
  /** WO-0047: the active workspace — null (empty database) renders no workspace section (ADR-0001). */
  workspaceId: WorkspaceId | null;
  source: WorkOrderSource;
  onBudgetChanged: () => void;
  /** WO-0049: fired when the structure root changes — App re-reads the roadmap (its only consumer). */
  onDocsRootChanged: () => void;
  onClose: () => void;
}) {
  const { UI, PERMISSION_RULE_LABELS, PROVIDER_ERROR_LABELS, ROLE_LABELS } = useLabels();
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
  const statusTone = status?.ok ? 'text-proceed' : 'text-error';
  // WO-0059 rev 3: the auth SOURCE is provider-owned data — only a KNOWN shape gets a word
  // (the limitWindowLabel posture); an unknown source renders NOTHING rather than the raw id.
  const sourceLabel = status?.ok ? UI.providerSourceLabel(status.source) : undefined;

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

  // WO-0049 — the structure root (docs_root:<wsId>): one atomic draft, the same posture as
  // budget. The read returns the EFFECTIVE root ('docs' when unset), so there is no Kaldır — writing
  // `docs` IS the reset (the port cannot tell stored-default from unset, by design). Validation is
  // the pure core's own normalizeDocsRoot (the parseAmount precedent); the store re-refuses loudly.
  const [rootText, setRootText] = useState('');
  const [rootTouched, setRootTouched] = useState(false);
  const [rootBusy, setRootBusy] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    void settings.getDocsRoot(workspaceId).then((r) => {
      setRootText(r);
      setRootTouched(false);
    });
  }, [workspaceId, settings]);
  const rootErr = !rootTouched || rootBusy ? null : normalizeDocsRoot(rootText) === undefined ? UI.docsRootErr : null;
  const saveDocsRoot = async (): Promise<void> => {
    if (!workspaceId || rootBusy) return;
    setRootTouched(true);
    const normalized = normalizeDocsRoot(rootText);
    if (normalized === undefined) return;
    setRootBusy(true);
    try {
      await settings.setDocsRoot(workspaceId, normalized);
      setRootText(normalized);
      setRootTouched(false);
      onDocsRootChanged();
    } finally {
      setRootBusy(false);
    }
  };

  // WO-0059 rev 2/3 — the per-role model preference: ONE atomic draft for the three roles (never a
  // mid-keystroke write), operator-global. The presets are adapter-minted DATA rendered as the
  // matrix's column heads; a cell press FILLS that role's draft (a picker, not a writer) and a
  // second press on the pressed cell clears it. No validity state: no format is knowable core-side
  // — the provider validates the id at spawn; the fields never lock (ADR-0001).
  const [modelsStored, setModelsStored] = useState<RoleModels | undefined>(undefined);
  const [modelsDraft, setModelsDraft] = useState<Record<ModelRole, string>>({ architect: '', implementer: '', verifier: '' });
  const [presets, setPresets] = useState<string[]>([]);
  const [modelsBusy, setModelsBusy] = useState(false);
  useEffect(() => {
    void settings.getModels?.().then((m) => {
      setModelsStored(m);
      setModelsDraft({ architect: m?.architect ?? '', implementer: m?.implementer ?? '', verifier: m?.verifier ?? '' });
    });
    void settings.modelOptions?.().then(setPresets).catch(() => setPresets([]));
  }, [settings]);
  const setRoleDraft = (role: ModelRole, value: string): void => setModelsDraft((d) => ({ ...d, [role]: value }));
  const toggleRolePreset = (role: ModelRole, id: string): void =>
    setModelsDraft((d) => ({ ...d, [role]: d[role] === id ? '' : id }));
  const saveModels = async (): Promise<void> => {
    if (modelsBusy) return;
    setModelsBusy(true);
    try {
      const clean: RoleModels = {};
      for (const role of MODEL_ROLES) {
        const trimmed = modelsDraft[role].trim();
        if (trimmed) clean[role] = trimmed;
      }
      await settings.setModels?.(Object.keys(clean).length > 0 ? clean : undefined);
      const stored = (await settings.getModels?.()) ?? undefined;
      setModelsStored(stored);
      setModelsDraft({ architect: stored?.architect ?? '', implementer: stored?.implementer ?? '', verifier: stored?.verifier ?? '' });
    } finally {
      setModelsBusy(false);
    }
  };
  const clearModels = async (): Promise<void> => {
    if (modelsBusy) return;
    setModelsBusy(true);
    try {
      await settings.setModels?.(undefined);
      setModelsStored(undefined);
      setModelsDraft({ architect: '', implementer: '', verifier: '' });
    } finally {
      setModelsBusy(false);
    }
  };

  const matrixColumns =
    presets.length > 0 && presets.length <= 4
      ? { gridTemplateColumns: `92px repeat(${presets.length}, minmax(0, 1fr)) 140px` }
      : undefined;

  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.settings}
      closeAria={UI.dialogCloseAria}
      footer={
        <>
          <span className="mr-auto font-mono text-[11px] text-inkdim">{UI.productName} · v{VERSION}</span>
          <Button variant="primary" size="sm" onClick={onClose}>
            {UI.close}
          </Button>
        </>
      }
    >
      <div className="flex flex-col">
        {/* ===== SAĞLAYICI — auth + Test; the one first-run blocker leads ===== */}
        <section data-provider-section="" className="pb-4">
          <div className="flex items-center gap-3">
            <h2 className="readout">{UI.settingsTabProvider}</h2>
            <button type="button" onClick={() => void runTest()} className="alink ml-auto text-[12px]">
              {UI.providerTest}
            </button>
          </div>
          <p className="mt-1.5 flex items-center gap-2 text-[12px]">
            {testing ? (
              <Spinner />
            ) : (
              <>
                <span
                  aria-hidden="true"
                  className={`h-1.5 w-1.5 rounded-full ${status === undefined ? 'bg-inkdim/40' : status.ok ? 'bg-proceed' : 'bg-error'}`}
                />
                <span className={statusTone}>
                  {status === undefined ? UI.providerStatusUnknown : status.ok ? UI.providerStatusOk : PROVIDER_ERROR_LABELS[status.code]}
                </span>
                {status?.ok && sourceLabel ? (
                  <span className="font-mono text-[11px] text-inkdim">{sourceLabel}</span>
                ) : null}
              </>
            )}
          </p>
        </section>

        {/* ===== MODELLER — the per-role assignment matrix (WO-0059 rev 3) ===== */}
        <section data-model-section="" className="border-t border-hairline py-4">
          <h2 className="readout">{UI.modelSectionLabel}</h2>
          {matrixColumns ? (
            <div
              data-model-matrix=""
              role="group"
              aria-label={UI.modelMatrixAria}
              className="mt-2.5 grid items-center gap-x-2 gap-y-1.5"
              style={matrixColumns}
            >
              <span />
              {presets.map((id) => (
                <span key={id} title={id} className="truncate font-mono text-[10px] tracking-wide text-inkdim">
                  {id}
                </span>
              ))}
              <span className="truncate font-mono text-[10px] tracking-wide text-inkdim">{UI.modelHeadCustom}</span>
              {MODEL_ROLES.map((role) => (
                <Fragment key={role}>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className={`rlamp rlamp-${role}`} />
                    <span className={`text-[11px] font-medium uppercase tracking-wider ${ROLE_HUE[role]}`}>{ROLE_LABELS[role]}</span>
                  </span>
                  {presets.map((id) => {
                    const pressed = modelsDraft[role] === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={pressed}
                        aria-label={`${ROLE_LABELS[role]} · ${id}`}
                        title={`${ROLE_LABELS[role]} · ${id}`}
                        onClick={() => toggleRolePreset(role, id)}
                        className={`ichip flex h-6 items-center justify-center rounded text-[11px] ${pressed ? 'ichip-on' : ''}`}
                      >
                        {pressed ? '●' : ''}
                      </button>
                    );
                  })}
                  <Input
                    value={modelsDraft[role]}
                    aria-label={`${ROLE_LABELS[role]} · ${UI.modelCustomSuffix}`}
                    className="h-6 font-mono text-[11px]"
                    onChange={(e) => setRoleDraft(role, e.target.value)}
                  />
                </Fragment>
              ))}
            </div>
          ) : (
            /* The degrade: more presets than the matrix can hold (adapter data, open-ended) or an
               empty set — full-width role rows, wrapped chips, the same draft. */
            <div className="mt-2.5 flex flex-col gap-3">
              {MODEL_ROLES.map((role) => (
                <div key={role}>
                  <div className="flex items-center gap-2">
                    <span aria-hidden="true" className={`rlamp rlamp-${role}`} />
                    <span className={`text-[11px] font-medium uppercase tracking-wider ${ROLE_HUE[role]}`}>{ROLE_LABELS[role]}</span>
                    <Input
                      value={modelsDraft[role]}
                      aria-label={ROLE_LABELS[role]}
                      className="ml-auto h-6 w-56 font-mono text-[11px]"
                      onChange={(e) => setRoleDraft(role, e.target.value)}
                    />
                  </div>
                  {presets.length > 0 ? (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {presets.map((id) => {
                        const pressed = modelsDraft[role] === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            aria-pressed={pressed}
                            onClick={() => toggleRolePreset(role, id)}
                            className={`ichip rounded px-1.5 py-px font-mono text-[10px] tracking-wide ${pressed ? 'ichip-on' : ''}`}
                          >
                            {id}
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[11px] text-inkdim">{UI.modelRoleHint}</p>
          <div className="mt-2 flex items-center gap-2">
            <Button variant="primary" size="sm" busy={modelsBusy} locked={modelsBusy} onClick={() => void saveModels()}>
              {UI.woEditSave}
            </Button>
            {modelsStored ? (
              <Button variant="ghost" size="sm" onClick={() => void clearModels()}>{UI.modelClear}</Button>
            ) : null}
          </div>
        </section>

        {/* ===== GENEL — the console's own voice and face; instant-apply segments ===== */}
        <section data-general-section="" className="border-t border-hairline py-4">
          <h2 className="readout">{UI.settingsTabGeneral}</h2>
          <div className="mt-2.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-ink">{UI.permRuleLabel}</span>
              <span className="ml-auto">
                <Segmented
                  size="sm"
                  value={rule}
                  onValueChange={(r) => { setRule(r); void settings.setPermissionRule?.(r); }}
                  options={[
                    { value: 'ask_every', label: PERMISSION_RULE_LABELS.ask_every },
                    { value: 'risky_excluded', label: PERMISSION_RULE_LABELS.risky_excluded },
                    { value: 'full_auto', label: PERMISSION_RULE_LABELS.full_auto },
                  ]}
                />
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[13px] text-ink">{UI.language}</span>
              <span className="ml-auto">
                <Segmented
                  size="sm"
                  value={locale}
                  onValueChange={(l) => setLocale(l)}
                  options={[
                    { value: 'tr', label: UI.langTr },
                    { value: 'en', label: UI.langEn },
                  ]}
                />
              </span>
              <span className="ml-3 text-[13px] text-ink">{UI.theme}</span>
              <span>
                <Segmented
                  size="sm"
                  value={mode}
                  onValueChange={(m) => setMode(m)}
                  options={[
                    { value: 'system', label: UI.themeSystem },
                    { value: 'light', label: UI.themeLight },
                    { value: 'dark', label: UI.themeDark },
                  ]}
                />
              </span>
            </div>
          </div>
        </section>

        {workspaceId ? (
          /* ===== ÇALIŞMA ALANI — the economics and the pointer of THIS workspace; the whole
             section is ABSENT on an empty database (ADR-0001), not shown inert. ===== */
          <section data-workspace-section="" className="border-t border-hairline pt-4">
            <h2 className="readout">{UI.settingsTabWorkspace}</h2>
            <div data-budget-section="" className="mt-2.5 grid grid-cols-2 gap-3">
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
            <div data-docs-root-section="">
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[13px] text-ink">{UI.docsRootLabel}</span>
                <Input
                  value={rootText}
                  aria-label={UI.docsRootLabel}
                  aria-invalid={rootErr !== null}
                  className="ml-auto w-44 font-mono"
                  onChange={(e) => { setRootText(e.target.value); setRootTouched(true); }}
                />
                <Button variant="primary" size="sm" busy={rootBusy} locked={rootBusy} onClick={() => void saveDocsRoot()}>
                  {UI.woEditSave}
                </Button>
              </div>
              {rootErr !== null ? (
                <p role="alert" className="mt-1.5 text-[11.5px] text-error">{rootErr}</p>
              ) : (
                <p className="mt-1.5 text-[11px] text-inkdim">{UI.docsRootWarn}</p>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </Dialog>
  );
}
