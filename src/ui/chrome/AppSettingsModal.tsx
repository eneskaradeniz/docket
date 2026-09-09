// AppSettingsModal — WO-0059 rev 4 (the from-scratch round; the operator's 2026-09-09 rulings,
// four mockup tours docs/ui-mockups/ayarlar-sold-menu.html rev 5→8): a LEFT MENU + right content
// pane in an xl (880px) dialog. Two menu items — Modeller · Genel — bare single-line names
// (sentence case; the rev-6 mono readouts under them died at tour 4: "title yeterli").
//
// Sağlayıcı DIED with the stored API key (the port methods, the env injection, the row — swept at
// open): its successor is ONE line in Genel — the provider's presence, `Hazır` / `Bulunamadı` +
// `Doğrula` (the spawn-free account read), the name itself crossing as adapter DATA
// (providerDisplayName — a vendor literal may live only in the adapter, c1).
//
// The model preference is PER-ROLE SEGMENTS (Default · haiku · sonnet · opus — worst→best,
// adapter-minted alias tiers rendered verbatim as DATA) that write INSTANTLY: a closed enum
// commits on click (the dil/tema segment behavior) — the modal holds NO text field at all.
// ÇALIŞMA ALANI moved to the workspace's Düzenle dialog (per-workspace facts, global settings
// stay global). Copy is plain Turkish — no internal jargon renders.
import { useEffect, useRef, useState } from 'react';
import type { AppSettings, ProviderStatus, RoleModels } from '../../core/app-settings';
import type { PermissionRule } from '../../core/source';
import { useLabels, useLocale } from '../data/locale';
import { useTheme } from '../data/theme';
import { VERSION } from '../data/version';
import { Button, Dialog, Segmented, Spinner } from '../kit';
import { toast } from './ToastHost';

const MODEL_ROLES = ['architect', 'implementer', 'verifier'] as const;
type ModelRole = (typeof MODEL_ROLES)[number];
const ROLE_HUE: Record<ModelRole, string> = { architect: 'text-signal', implementer: 'text-info', verifier: 'text-proceed' };
type Section = 'models' | 'general';

/** One menu item — a bare single-line name (rev 8: no sub-readout; the title is enough). */
function MenuItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      data-settings-item={active ? 'on' : 'off'}
      aria-current={active ? 'true' : 'false'}
      onClick={onClick}
      className={`w-full rounded-[7px] px-2.5 py-2 text-left text-[13px] font-medium tracking-tight transition-colors duration-150 ${
        active ? 'bg-raised text-ink' : 'text-inkdim hover:bg-raised/60 hover:text-ink'
      }`}
    >
      {label}
    </button>
  );
}

export function AppSettingsModal({ settings, onClose }: { settings: AppSettings; onClose: () => void }) {
  const { UI, PERMISSION_RULE_LABELS, ROLE_LABELS } = useLabels();
  const { locale, setLocale } = useLocale();
  const { mode, setMode } = useTheme();
  const [section, setSection] = useState<Section>('models');
  // The permission rule's default (rev 1-3 carry-over): lives in Genel, instant-apply segment.
  const [rule, setRule] = useState<PermissionRule>('risky_excluded');
  // WO-0059 rev 4 — the per-role tier map + the adapter-minted tiers. No draft: a segment click
  // writes through (read-modify-write, one port call) and re-reads so the row is the one truth.
  const [models, setModels] = useState<RoleModels | undefined>(undefined);
  const modelsRef = useRef<RoleModels | undefined>(undefined); // the map of record between click and re-read
  const [presets, setPresets] = useState<string[]>([]);
  // The presence line: the name is provider DATA; the status is the spawn-free account read.
  const [providerName, setProviderName] = useState<string | undefined>(undefined);
  const [status, setStatus] = useState<ProviderStatus | undefined>(undefined);
  // The MOUNT check is in flight too — the line starts neutral (spinner), never a premature
  // «Bulunamadı» (review f5: the two-state word is for RESULTS, not for the loading window).
  const [verifying, setVerifying] = useState(true);

  useEffect(() => {
    void settings.getPermissionRule().then((r) => setRule(r ?? 'risky_excluded'));
    void settings.getModels().then((m) => { modelsRef.current = m; setModels(m); }).catch(() => setModels(undefined));
    void settings.modelOptions().then(setPresets).catch(() => setPresets([]));
    void settings.providerName().then(setProviderName).catch(() => setProviderName(undefined));
    void settings.checkProvider().then((s) => { setStatus(s); setVerifying(false); }).catch(() => { setStatus(undefined); setVerifying(false); });
  }, [settings]);

  const verify = async (): Promise<void> => {
    setVerifying(true);
    try {
      setStatus(await settings.checkProvider());
    } catch {
      setStatus(undefined);
    } finally {
      setVerifying(false);
    }
  };

  const setRoleTier = (role: ModelRole, tier: string): void => {
    // The map of record is the REF, not the state — two quick clicks inside one IPC round-trip
    // would otherwise build the second write from the stale map and silently drop the first tier
    // (review f4). Optimistic update first, then the write; a failed write toasts and re-reads.
    const next: RoleModels = { ...(modelsRef.current ?? {}) };
    if (tier === '') delete next[role];
    else next[role] = tier;
    modelsRef.current = next;
    setModels(next);
    settings.setModels(Object.keys(next).length > 0 ? next : undefined)
      .then(() => settings.getModels())
      .then((stored) => { modelsRef.current = stored; setModels(stored); })
      .catch(() => {
        toast.push({ kind: 'error', title: UI.saveFailed });
        settings.getModels().then((stored) => { modelsRef.current = stored; setModels(stored); }).catch(() => undefined);
      });
  };

  // The two-state word is for RESULTS only — while a check runs the spinner speaks instead.
  const statusWord = status?.ok ? UI.providerStatusOk : UI.providerStatusMissing;
  const statusTone = status?.ok ? 'text-proceed' : 'text-error';

  const roleRow = (role: ModelRole) => (
    <div className="flex items-center gap-2.5 py-0.5">
      <span aria-hidden="true" className={`rlamp rlamp-${role}`} />
      <span className={`text-[12.5px] font-medium tracking-tight ${ROLE_HUE[role]}`}>{ROLE_LABELS[role]}</span>
      <span className="ml-auto">
        <Segmented
          size="sm"
          value={models?.[role] ?? ''}
          onValueChange={(tier) => setRoleTier(role, tier)}
          options={[
            { value: '', label: UI.modelDefaultTier },
            ...presets.map((tier) => ({ value: tier, label: tier })),
          ]}
        />
      </span>
    </div>
  );

  return (
    <Dialog
      open
      xl
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.settings}
      closeAria={UI.dialogCloseAria}
      footer={
        <>
          <span className="mr-auto font-mono text-[11px] text-inkdim">{UI.productName} · v{VERSION}</span>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {UI.close}
          </Button>
        </>
      }
    >
      <div className="flex min-h-[360px] gap-0">
        {/* ===== the sunken menu rail: two bare names; the rail's well is the only divider ===== */}
        <nav data-settings-menu="" aria-label={UI.settings} className="flex w-[200px] shrink-0 flex-col gap-0.5 border-r border-hairline bg-bg/60 p-2">
          <MenuItem label={UI.modelSectionLabel} active={section === 'models'} onClick={() => setSection('models')} />
          <MenuItem label={UI.settingsTabGeneral} active={section === 'general'} onClick={() => setSection('general')} />
        </nav>

        <div className="min-w-0 flex-1 px-5 py-4">
          {section === 'models' ? (
            /* ===== MODELLER — the per-role tier segments (rev 4): worst→best, instant write ===== */
            <section data-model-section="" className="flex flex-col gap-2.5">
              <h2 className="text-[13px] font-semibold tracking-tight text-ink">{UI.modelSectionLabel}</h2>
              <p className="text-[11px] leading-relaxed text-inkdim">{UI.modelTierLine}</p>
              <div data-model-rows="" role="group" aria-label={UI.modelMatrixAria} className="mt-1 flex flex-col gap-1.5">
                {MODEL_ROLES.map(roleRow)}
              </div>
              <p className="text-[11px] text-inkdim">{UI.modelDraftLine(ROLE_LABELS.architect)}</p>
            </section>
          ) : (
            /* ===== GENEL — the provider's presence line + the console's voice, face, cadence ===== */
            <section data-general-section="" className="flex flex-col gap-2.5">
              <h2 className="text-[13px] font-semibold tracking-tight text-ink">{UI.settingsTabGeneral}</h2>

              <div data-provider-line="" className="flex items-center gap-2 rounded-lg border border-hairline px-2.5 py-2">
                {providerName !== undefined ? <span className="text-[12.5px] font-medium text-ink">{providerName}</span> : null}
                {verifying ? (
                  <Spinner />
                ) : (
                  <span className={`text-[12px] font-medium ${statusTone}`}>{statusWord}</span>
                )}
                <button
                  type="button"
                  onClick={() => void verify()}
                  className={`alink ml-auto text-[12px] ${verifying ? 'opacity-45' : ''}`}
                >
                  {UI.providerVerify}
                </button>
              </div>

              <div className="mt-1 flex items-center gap-3">
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
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[13px] text-ink">{UI.theme}</span>
                <span className="ml-auto">
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
            </section>
          )}
        </div>
      </div>
    </Dialog>
  );
}
