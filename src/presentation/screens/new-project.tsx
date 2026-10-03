// screens/new-project.tsx — the "Yeni proje" page (U-40), in the wizard's page language: a centred
// 880×580 card with the title and one line, the cards in the prototype's order (the guided start
// and the clone card shown dim with a "Yakında" tag, never selectable), the selected mode's
// fields, and a fixed bottom band — Vazgeç · the reason line · the primary. The machine lives in
// stores/new-project.ts; this file mirrors it. Paths are typed: no folder picker exists yet.
import { useEffect, useSyncExternalStore } from 'react';

import { ActionButton } from '../components/action-button';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  type NewProjectDone,
  type NewProjectField,
  type NewProjectMode,
  type NewProjectStore,
} from '../stores/new-project';

export interface NewProjectScreenProps {
  readonly store: NewProjectStore;
  readonly locale: Locale;
  /** "Vazgeç": back to where the page was opened from. */
  readonly onCancel: () => void;
  /** A project was created or attached: the shell opens its view and shows the toast. */
  readonly onDone: (done: NewProjectDone) => void;
}

const LABEL_CLASS = 'text-[12.5px] font-semibold text-ink';
const INPUT_CLASS =
  'w-full rounded-control border border-bord bg-transparent px-2.5 py-1.5 text-[13px] text-ink focus:border-signal focus:outline-none';
const SOON_CLASS = 'rounded-full border border-hairline px-2 py-px text-[12px] font-semibold text-inkdim';

const MODE_CARDS: readonly { readonly mode: NewProjectMode | 'clone'; readonly title: LabelKey; readonly desc: LabelKey }[] = [
  { mode: 'existing', title: 'newProject.existing', desc: 'newProject.existing.desc' },
  { mode: 'clone', title: 'newProject.clone', desc: 'newProject.clone.desc' },
  { mode: 'blank', title: 'newProject.blank', desc: 'newProject.blank.desc' },
];

const SparkIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="block h-4 w-4">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
  </svg>
);

export function NewProjectScreen({ store, locale, onCancel, onDone }: NewProjectScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const { form, failure, done } = state;
  useEffect(() => {
    if (done !== null) onDone(done);
  }, [done, onDone]);

  const errorUnder = (field: NewProjectField) =>
    failure !== null && failure.field === field ? (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-[12.5px] text-error" data-new-project-error={failure.code}>
        <span>{t(locale, failure.key)}</span>
        {failure.offerAttach ? (
          <button
            type="button"
            disabled={state.busy}
            onClick={() => void store.attachExisting()}
            data-new-project-attach=""
            className="rounded-control border border-bord px-2 py-0.5 text-[12.5px] font-semibold text-ink hover:bg-raised disabled:opacity-50"
          >
            {t(locale, 'newProject.attach')}
          </button>
        ) : null}
      </p>
    ) : null;

  const submit = (): void => void store.submit();
  const onEnter = (event: { readonly key: string }): void => {
    if (event.key === 'Enter') submit();
  };

  return (
    <section
      aria-label={t(locale, 'newProject.title')}
      data-new-project=""
      className="mx-auto grid h-[580px] w-[880px] max-w-full grid-rows-[auto_minmax(0,1fr)_64px] overflow-hidden rounded-panel border border-bord bg-surface"
    >
      <div className="px-8 pt-8">
        <h1 className="text-[20px] font-bold leading-tight text-ink">{t(locale, 'newProject.title')}</h1>
        <p className="mt-1 text-[14px] text-inkdim">{t(locale, 'newProject.copy')}</p>
      </div>

      <div className="mt-5 min-h-0 overflow-y-auto px-8 pb-6">
        <button
          type="button"
          disabled
          aria-disabled="true"
          data-card="together"
          className="grid w-full gap-1 rounded-panel border border-bord bg-surface px-4 py-3.5 text-left opacity-50"
        >
          <span className="flex items-center gap-2.5">
            <span aria-hidden="true" className="text-signal">
              <SparkIcon />
            </span>
            <span className="text-[15px] font-semibold text-ink">{t(locale, 'newProject.featured')}</span>
            <span className="rounded-full border border-signal-soft px-2 py-px text-[12px] font-semibold text-signal-soft">
              {t(locale, 'newProject.featured.chip')}
            </span>
            <span className={`ml-auto ${SOON_CLASS}`}>{t(locale, 'newProject.soon')}</span>
          </span>
          <span className="text-[12.5px] text-inkdim">{t(locale, 'newProject.featured.sub')}</span>
        </button>

        <div className="my-4 flex items-center gap-3">
          <i className="h-px flex-1 bg-hairline" />
          <span className="text-[12.5px] text-inkdim">{t(locale, 'newProject.divider')}</span>
          <i className="h-px flex-1 bg-hairline" />
        </div>

        <div className="flex gap-2">
          {MODE_CARDS.map((card) => {
            const disabled = card.mode === 'clone';
            const selected = card.mode === form.mode;
            const tone = disabled
              ? 'border-hairline opacity-50'
              : selected
                ? 'border-signal-soft bg-raised'
                : 'border-hairline hover:border-bord';
            return (
              <button
                key={card.mode}
                type="button"
                disabled={disabled}
                aria-disabled={disabled ? 'true' : undefined}
                aria-pressed={disabled ? undefined : selected}
                data-card={card.mode}
                onClick={() => {
                  if (card.mode !== 'clone') store.pickCard(card.mode);
                }}
                className={`flex min-h-[72px] min-w-0 flex-1 flex-col items-start gap-0.5 rounded-card border bg-surface px-3.5 py-3 text-left ${tone}`}
              >
                <span className="flex w-full items-center gap-2">
                  <b className="text-[14px] font-semibold text-ink">{t(locale, card.title)}</b>
                  {disabled ? <span className={`ml-auto ${SOON_CLASS}`}>{t(locale, 'newProject.soon')}</span> : null}
                </span>
                <span className="text-[12.5px] text-inkdim">{t(locale, card.desc)}</span>
              </button>
            );
          })}
        </div>

        {form.mode === 'existing' ? (
          <div className="mt-4 grid gap-2" data-new-project-form="existing">
            <label className="grid gap-2">
              <span className={LABEL_CLASS}>{t(locale, 'newProject.folder')}</span>
              <input
                autoFocus
                value={form.path}
                onChange={(event) => store.setPath(event.target.value)}
                onKeyDown={onEnter}
                placeholder={t(locale, 'newProject.folder.placeholder')}
                className={`${INPUT_CLASS} font-mono`}
              />
            </label>
            {errorUnder('path')}
            <label className="grid gap-2">
              <span className={LABEL_CLASS}>{t(locale, 'newProject.name')}</span>
              <input value={form.name} onChange={(event) => store.setName(event.target.value)} onKeyDown={onEnter} className={INPUT_CLASS} />
            </label>
            {errorUnder('name')}
          </div>
        ) : (
          <div className="mt-4 grid gap-2" data-new-project-form="blank">
            <label className="grid gap-2">
              <span className={LABEL_CLASS}>{t(locale, 'newProject.name')}</span>
              <input
                autoFocus
                value={form.name}
                onChange={(event) => store.setName(event.target.value)}
                onKeyDown={onEnter}
                className={INPUT_CLASS}
              />
            </label>
            {errorUnder('name')}
            <label className="grid gap-2">
              <span className={LABEL_CLASS}>{t(locale, 'newProject.location')}</span>
              <input
                value={form.parent}
                onChange={(event) => store.setParent(event.target.value)}
                onKeyDown={onEnter}
                placeholder={t(locale, 'newProject.location.placeholder')}
                className={`${INPUT_CLASS} font-mono`}
              />
            </label>
            {errorUnder('parent')}
            <p className="text-[12.5px] text-inkdim">{t(locale, 'newProject.blank.note')}</p>
          </div>
        )}
      </div>

      <footer className="flex items-center gap-3 border-t border-hairline px-8">
        <ActionButton variant="ghost" size="md" onClick={onCancel}>
          {t(locale, 'newProject.cancel')}
        </ActionButton>
        <span aria-live="polite" className="ml-auto flex min-w-0 items-center gap-2 text-[12.5px] text-inkdim">
          {state.reasonKey !== null ? (
            <>
              <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-none rounded-full bg-signal" />
              <span className="truncate">{t(locale, state.reasonKey)}</span>
            </>
          ) : null}
        </span>
        <span className="min-w-[132px] flex-none [&>button]:w-full">
          <ActionButton variant="primary" size="md" disabled={state.reasonKey !== null || state.busy} onClick={submit}>
            {t(locale, state.busy ? 'newProject.creating' : 'newProject.create')}
          </ActionButton>
        </span>
      </footer>
    </section>
  );
}
