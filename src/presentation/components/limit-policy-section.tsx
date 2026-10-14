import { t, type Locale } from '../labels/t';
import type { LimitPolicy, RepoFlow, StageSlug } from '../../domain/index';
import { limitPolicyFor } from '../../domain/index';
import { limitPolicyDiffs, limitPolicyLabelKey, REPO_LIMIT_POLICIES } from '../stores/repo-settings';

export interface LimitPolicySectionProps {
  readonly locale: Locale;
  readonly flow: RepoFlow | null;
  readonly stage: StageSlug | null;
  readonly defaultPolicy: LimitPolicy;
  readonly onSelect: (stage: StageSlug, policy: LimitPolicy) => void;
  readonly onReset: (stage: StageSlug) => void;
}

export function LimitPolicySection({ locale, flow, stage, defaultPolicy, onSelect, onReset }: LimitPolicySectionProps) {
  const label = t(locale, 'repoSettings.section.limitPolicy');
  if (flow === null || stage === null) {
    return (
      <section role="group" aria-label={label} className="rounded-card border border-hairline bg-surface px-3 py-4 text-[13px] text-inkdim">
        {t(locale, 'repoSettings.empty')}
      </section>
    );
  }
  const effective = limitPolicyFor(flow, stage, defaultPolicy);
  const diff = limitPolicyDiffs(flow, defaultPolicy).find((row) => row.stage === stage);
  const stageName = flow.stages.find((row) => row.id === stage)?.name ?? stage;

  return (
    <section role="group" aria-label={label} className="rounded-card border border-hairline bg-surface px-3 py-3">
      <h2 className="mb-2 text-[13px] font-bold text-ink">{label}</h2>
      <p className="mb-2 text-[12px] text-inkdim">{stageName}</p>
      <div className="flex flex-col gap-1">
        {REPO_LIMIT_POLICIES.map((policy) => (
          <label key={policy} className="flex items-center gap-2 rounded-control px-2 py-1.5 hover:bg-raised">
            <input
              type="radio"
              name={`limit-${stage}`}
              checked={effective === policy}
              onChange={() => onSelect(stage, policy)}
            />
            <span className="text-[13px] text-ink">{t(locale, limitPolicyLabelKey(policy))}</span>
          </label>
        ))}
      </div>
      {diff !== undefined ? (
        <p className="mt-2 flex items-center gap-2 text-[12px] text-signal-soft">
          <span
            aria-label={t(locale, 'editor.recommended.tooltip').replace('{value}', t(locale, limitPolicyLabelKey(diff.recommended)))}
            title={t(locale, 'editor.recommended.tooltip').replace('{value}', t(locale, limitPolicyLabelKey(diff.recommended)))}
            className="h-2 w-2 rounded-full bg-signal"
          />
          <button
            type="button"
            onClick={() => onReset(stage)}
            aria-label={t(locale, 'editor.reset.aria')}
            title={t(locale, 'editor.reset.aria')}
            className="grid h-8 w-8 place-items-center rounded-control border border-bord text-inkdim hover:bg-raised hover:text-ink"
          >
            <span aria-hidden="true">↶</span>
          </button>
        </p>
      ) : null}
    </section>
  );
}
