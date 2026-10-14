import { t, type Locale } from '../labels/t';
import type { RepoFlow, RoleDef, RoleOverlay, RoleUpdateProposal, StageSlug, VersionRecord } from '../../domain/index';
import { effectiveRole } from '../../domain/index';
import { ActionButton } from './action-button';

export interface OverlayEditorProps {
  readonly locale: Locale;
  readonly flow: RepoFlow | null;
  readonly stage: StageSlug | null;
  readonly library: readonly VersionRecord<RoleDef>[];
  readonly proposals: readonly RoleUpdateProposal[];
  readonly proposalBlocked: readonly (keyof RoleOverlay)[];
  readonly onInstructions: (stage: StageSlug, text: string) => void;
  readonly onDetach: (stage: StageSlug) => void;
  readonly onApplyProposal: (stage: StageSlug) => void;
  readonly onClearOverlayField: (stage: StageSlug, field: keyof RoleOverlay) => void;
}

const versionBadge = (ref: { readonly version: number; readonly detached?: RoleDef } | undefined): string => {
  if (ref === undefined) return '';
  if (ref.detached !== undefined) return 'detached';
  return `v${ref.version}`;
};

export function OverlayEditor({
  locale,
  flow,
  stage,
  library,
  proposals,
  proposalBlocked,
  onInstructions,
  onDetach,
  onApplyProposal,
  onClearOverlayField,
}: OverlayEditorProps) {
  const sectionLabel = t(locale, 'repoSettings.section.roles');
  if (flow === null || stage === null) {
    return (
      <section role="group" aria-label={sectionLabel} className="mb-4 rounded-card border border-hairline bg-surface px-3 py-4 text-[13px] text-inkdim">
        {t(locale, 'repoSettings.empty')}
      </section>
    );
  }
  const binding = flow.bindings.find((row) => row.stage === stage);
  const ref = binding?.role;
  const resolved = ref === undefined ? null : effectiveRole(ref, library);
  const instructions = ref?.overlay?.instructions ?? (resolved?.ok ? resolved.value.instructions : '');
  const proposal = proposals.find((row) => row.stage === stage);
  const blocked = proposalBlocked.length > 0;

  return (
    <section role="group" aria-label={sectionLabel} className="mb-4 rounded-card border border-hairline bg-surface px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="m-0 text-[13px] font-bold text-ink">{sectionLabel}</h2>
        {ref !== undefined ? (
          <span className="rounded-full border border-hairline px-2 py-0.5 text-[11px] text-inkdim">{versionBadge(ref)}</span>
        ) : null}
        {ref !== undefined && ref.detached === undefined ? (
          <ActionButton variant="neutral" size="sm" onClick={() => onDetach(stage)}>
            {t(locale, 'repoSettings.detach')}
          </ActionButton>
        ) : null}
      </div>
      <label className="mb-1 block text-[12px] font-medium text-inkdim" htmlFor="repo-overlay-instructions">
        {t(locale, 'repoSettings.overlay.instructions')}
      </label>
      <textarea
        id="repo-overlay-instructions"
        value={instructions}
        onChange={(event) => onInstructions(stage, event.target.value)}
        rows={4}
        className="mb-2 w-full min-h-8 resize-y rounded-control border border-hairline bg-bg px-2 py-1.5 text-[13px] text-ink"
      />
      {proposal !== undefined ? (
        <div role="list" className="mt-2 rounded-card border border-hairline bg-sunk px-3 py-2">
          <div role="listitem" className="flex flex-wrap items-center gap-2 text-[13px]">
            <span>{t(locale, 'repoSettings.version.updateAvailable')}</span>
            <span className="text-inkdim">v{proposal.from} → v{proposal.to}</span>
            {blocked ? (
              <span className="text-[12px] text-signal-soft">{proposalBlocked.join(', ')}</span>
            ) : null}
            <ActionButton
              variant="primary"
              size="sm"
              disabled={blocked}
              onClick={() => onApplyProposal(stage)}
            >
              {t(locale, 'repoSettings.version.apply')}
            </ActionButton>
            {blocked
              ? proposalBlocked.map((field) => (
                  <ActionButton key={field} variant="neutral" size="sm" onClick={() => onClearOverlayField(stage, field)}>
                    {String(field)}
                  </ActionButton>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
