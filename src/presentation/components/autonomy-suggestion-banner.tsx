// components/autonomy-suggestion-banner.tsx — flow suggestion banner on work order detail (U-335).
import { useState } from 'react';
import type { IntentOutcome, WorkOrderDetailAutonomy } from '../stores/work-order-detail';
import type { FlowDef, StageDef } from '../../domain/index';
import { autonomyRefusalKey } from './autonomy-control';
import { ActionButton } from './action-button';
import { VersionBadge } from './version-badge';
import { t, type Locale } from '../labels/t';

export interface AutonomySuggestionBannerProps {
  readonly locale: Locale;
  /** Null keeps the banner quiet. */
  readonly view: WorkOrderDetailAutonomy | null;
  readonly onConfirm: () => Promise<IntentOutcome | undefined>;
}

export function AutonomySuggestionBanner({ locale, view, onConfirm }: AutonomySuggestionBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // The banner stays quiet when dismissed, absent, when effective level already reached auto,
  // or when the flow carries no auto suggestion.
  if (dismissed || view === null || view.level === 'auto' || view.suggestion !== 'auto') {
    return null;
  }

  const restrictiveStages = view.restrictiveStages ?? [];

  const handleConfirm = async () => {
    setSubmitting(true);
    setRefusal(null);
    try {
      const outcome = await onConfirm();
      if (outcome !== undefined && !outcome.result.ok) {
        const error = ('error' in outcome.result && outcome.result.error) || ('code' in outcome.result && outcome.result.code) || 'unknown';
        setRefusal(error);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDecline = () => {
    // Declining writes nothing to any store and simply dismisses the banner locally.
    setDismissed(true);
  };

  return (
    <section
      role="region"
      aria-label={t(locale, 'autonomy.suggestion.banner')}
      data-autonomy-suggestion-banner=""
      className="flex flex-col gap-2 rounded-card border border-hairline bg-surface px-4 py-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[13px] font-semibold text-ink">
          {t(locale, 'autonomy.suggestion.banner')}
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-autonomy-suggestion-decline=""
            disabled={submitting}
            onClick={handleDecline}
            className="h-8 rounded-control border border-hairline px-3 text-[12px] text-inkdim hover:bg-raised hover:text-ink"
          >
            {t(locale, 'autonomy.suggestion.decline')}
          </button>
          {/* The ask's confirm is the banner's one primary (U-375) — amber waits on the operator. */}
          <ActionButton
            variant="primary"
            size="md"
            disabled={submitting}
            onClick={() => void handleConfirm()}
          >
            {t(locale, 'autonomy.suggestion.confirm')}
          </ActionButton>
        </div>
      </div>

      {restrictiveStages.length > 0 ? (
        <div data-autonomy-suggestion-restrictions="" className="text-[12px] text-inkdim">
          <p className="m-0">
            {t(locale, 'autonomy.suggestion.restrictiveNotice').replace('{stages}', restrictiveStages.join(', '))}
          </p>
          <p className="m-0 mt-0.5">
            {t(locale, 'autonomy.suggestion.restrictiveConfirmNote')}
          </p>
        </div>
      ) : null}

      {refusal !== null ? (
        <p data-autonomy-suggestion-refusal="" className="m-0 text-[12px] text-inkdim">
          {t(locale, autonomyRefusalKey(refusal))}
        </p>
      ) : null}
    </section>
  );
}

export interface FlowLibraryRowProps {
  readonly locale: Locale;
  readonly flow: FlowDef;
  readonly version?: number;
}

export function FlowLibraryRow({ locale, flow, version }: FlowLibraryRowProps) {
  const suggestsAuto = flow.autonomy === 'auto';
  return (
    <div
      data-flow-library-row={flow.id}
      className="flex items-center justify-between rounded-card border border-hairline bg-surface px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">{flow.name}</span>
        {version !== undefined ? <VersionBadge locale={locale} version={version} /> : null}
      </div>
      {suggestsAuto ? (
        <span
          data-flow-suggestion-tag=""
          className="rounded-full border border-bord bg-raised px-2 py-0.5 text-[10px] text-inkdim"
        >
          {t(locale, 'autonomy.tag.suggestsAuto')}
        </span>
      ) : null}
    </div>
  );
}

export interface FlowEditorStageRowProps {
  readonly locale: Locale;
  readonly stage: StageDef;
}

/** U-336: Stage row in the flow editor — a stage whose `autonomy` is set shows its level as a small
 *  tag ("önerir: auto" for `auto`, or the level name for manual/balanced); the tag is read-only. */
export function FlowEditorStageRow({ locale, stage }: FlowEditorStageRowProps) {
  const autonomy = stage.autonomy;
  const tagText =
    autonomy === 'auto'
      ? t(locale, 'autonomy.tag.suggestsAuto')
      : autonomy !== undefined
        ? t(locale, `autonomy.level.${autonomy}`)
        : undefined;

  return (
    <div
      data-flow-editor-stage-row={stage.id}
      className="flex items-center justify-between rounded-card border border-hairline bg-surface px-3 py-2"
    >
      <span className="text-[13px] font-semibold text-ink">{stage.name}</span>
      {tagText !== undefined ? (
        <span
          data-stage-autonomy-tag=""
          className="rounded-full border border-bord bg-raised px-2 py-0.5 text-[10px] text-inkdim"
        >
          {tagText}
        </span>
      ) : null}
    </div>
  );
}
