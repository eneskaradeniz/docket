import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { RepoFlow, RoleDef, StageSlug, VersionRecord } from '../../domain/index';
import { effectiveRole } from '../../domain/index';

export interface FlowStageStripProps {
  readonly locale: Locale;
  readonly flow: RepoFlow | null;
  readonly activeStage: StageSlug | null;
  readonly accountLabels: Readonly<Record<string, string>>;
  readonly library: readonly VersionRecord<RoleDef>[];
  readonly onSelect: (stage: StageSlug) => void;
}

const chainLabel = (flow: RepoFlow, stage: StageSlug, accountLabels: Readonly<Record<string, string>>): string => {
  const binding = flow.bindings.find((row) => row.stage === stage);
  if (binding === undefined || binding.accounts.length === 0) return '—';
  return binding.accounts
    .map((route) => accountLabels[route.accountId] ?? route.accountId)
    .join(' → ');
};

const roleName = (flow: RepoFlow, stageId: StageSlug, library: readonly VersionRecord<RoleDef>[]): string => {
  const stageDef = flow.stages.find((row) => row.id === stageId);
  const binding = flow.bindings.find((row) => row.stage === stageId);
  const ref = binding?.role;
  if (ref === undefined) return stageDef?.role ?? '—';
  const resolved = effectiveRole(ref, library);
  return resolved.ok ? resolved.value.name : ref.roleId;
};

export function FlowStageStrip({ locale, flow, activeStage, accountLabels, library, onSelect }: FlowStageStripProps) {
  if (flow === null) {
    return (
      <div role="status" className="rounded-card border border-hairline bg-surface px-3 py-6 text-[13px] text-inkdim">
        {t(locale, 'repoSettings.empty')}
      </div>
    );
  }
  const sectionKey: LabelKey = 'repoSettings.section.flow';
  return (
    <section role="group" aria-label={t(locale, sectionKey)} className="mb-4">
      <h2 className="mb-2 text-[13px] font-bold text-ink">{t(locale, sectionKey)}</h2>
      <ol role="list" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {flow.stages.map((stageRow) => {
          const selected = activeStage === stageRow.id;
          return (
            <li key={stageRow.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(stageRow.id)}
                className={[
                  'flex h-16 w-[11.25rem] flex-col justify-center gap-1 rounded-card border px-3 text-left',
                  selected ? 'border-signal bg-raised' : 'border-hairline bg-surface hover:bg-raised',
                ].join(' ')}
              >
                <span className="truncate text-[13px] font-semibold text-ink">{stageRow.name}</span>
                <span className="truncate text-[12px] text-inkdim">{roleName(flow, stageRow.id, library)}</span>
                <span className="truncate text-[11px] text-inkdim">{chainLabel(flow, stageRow.id, accountLabels)}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
