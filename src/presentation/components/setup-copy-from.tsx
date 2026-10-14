// setup-copy-from.tsx — copy settings from an added repo (U-318).
import { ActionButton } from './action-button';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { AddedRepoRecord } from '../stores/new-project';

const INPUT_CLASS =
  'w-full rounded-control border border-bord bg-transparent px-2.5 py-1.5 text-[0.8125rem] leading-[1.25rem] text-ink focus:border-signal focus:outline-none';
const LABEL_CLASS = 'text-[0.8125rem] leading-[1.25rem] font-semibold text-ink';
const NOTE_CLASS = 'text-[0.78rem] leading-[1.125rem]';

export interface SetupCopyFromProps {
  readonly locale: Locale;
  readonly sources: readonly AddedRepoRecord[];
  readonly sourceId: string;
  readonly targetPath: string;
  readonly busy: boolean;
  readonly errorKey: LabelKey | null;
  readonly onSource: (id: string) => void;
  readonly onTarget: (path: string) => void;
  readonly onContinue: () => void;
  readonly onBack: () => void;
}

export function SetupCopyFrom({
  locale,
  sources,
  sourceId,
  targetPath,
  busy,
  errorKey,
  onSource,
  onTarget,
  onContinue,
  onBack,
}: SetupCopyFromProps) {
  return (
    <section className="mt-4 grid gap-3" data-setup-copy-from="">
      <header className="grid gap-1">
        <h2 className="m-0 text-[0.9375rem] font-semibold text-ink">{t(locale, 'setup.multi.copy.title')}</h2>
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'setup.multi.copy.lead')}</p>
      </header>
      <label className="grid gap-2">
        <span className={LABEL_CLASS}>{t(locale, 'setup.multi.copy.srcLabel')}</span>
        <select
          value={sourceId}
          onChange={(event) => onSource(event.target.value)}
          className={INPUT_CLASS}
          data-setup-copy-source=""
        >
          {sources.map((repo) => (
            <option key={repo.id} value={repo.id}>
              {repo.id}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2">
        <span className={LABEL_CLASS}>{t(locale, 'setup.multi.copy.targetLabel')}</span>
        <input value={targetPath} onChange={(event) => onTarget(event.target.value)} className={`${INPUT_CLASS} font-mono`} data-setup-copy-target="" />
      </label>
      {errorKey !== null ? (
        <p role="alert" className={`${NOTE_CLASS} text-error`}>
          {t(locale, errorKey)}
        </p>
      ) : null}
      <div className="grid gap-2 rounded-card border border-hairline px-3.5 py-3">
        <p className={`m-0 ${LABEL_CLASS}`}>{t(locale, 'setup.multi.copy.copiedHead')}</p>
        <p className={`m-0 ${NOTE_CLASS} text-inkdim`}>{t(locale, 'setup.multi.copy.copiedList')}</p>
        <p className={`m-0 pt-2 ${LABEL_CLASS}`}>{t(locale, 'setup.multi.copy.notCopiedHead')}</p>
        <p className={`m-0 ${NOTE_CLASS} text-inkdim`}>{t(locale, 'setup.multi.copy.notCopiedList')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="neutral" size="md" disabled={busy} onClick={onBack}>
          {t(locale, 'newProject.cancel')}
        </ActionButton>
        <ActionButton variant="primary" size="md" disabled={busy || sourceId === '' || targetPath.trim() === ''} onClick={onContinue}>
          {t(locale, 'setup.multi.copy.toDiffBtn')}
        </ActionButton>
      </div>
    </section>
  );
}
