// screens/new-project.tsx — Phase 7 "Proje ekle" panel (U-286, U-287, U-272 … U-279): three setup
// entries, import, proposal diff, and the setup permission dialog. Hosted in panel-overlay (U-181).
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { ActionButton } from '../components/action-button';
import { HomeLaunchers } from '../components/launcher-rows';
import { PanelOverlay } from '../components/panel-overlay';
import { PermissionPrompt } from '../components/permission-prompt';
import { SetupProposalDiff } from '../components/setup-proposal-diff';
import { WindowTitle } from '../components/window-frame';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import {
  disclosureExpanded,
  hasDraft,
  type NewProjectDone,
  type NewProjectField,
  type NewProjectStore,
  type SetupEntryPath,
} from '../stores/new-project';
import type { NewProjectPanelOrigin } from '../stores/new-project-panel';

export interface NewProjectPanelProps {
  readonly open: boolean;
  readonly origin: NewProjectPanelOrigin;
  readonly store: NewProjectStore;
  readonly locale: Locale;
  readonly onClose: () => void;
  readonly onDone: (done: NewProjectDone) => void;
  readonly onOpenAccounts?: () => void;
}

const LABEL_CLASS = 'text-[0.8125rem] leading-[1.25rem] font-semibold text-ink';
const NOTE_CLASS = 'text-[0.78rem] leading-[1.125rem]';
const INPUT_CLASS =
  'w-full rounded-control border border-bord bg-transparent px-2.5 py-1.5 text-[0.8125rem] leading-[1.25rem] text-ink focus:border-signal focus:outline-none';

const PATH_CARDS: readonly { readonly path: SetupEntryPath; readonly title: LabelKey; readonly desc: LabelKey | null }[] = [
  { path: 'docket_ai', title: 'setup.ai.title', desc: null },
  { path: 'quick', title: 'setup.quick.title', desc: 'setup.quick.desc' },
  { path: 'detailed', title: 'setup.detailed.title', desc: 'setup.detailed.desc' },
];

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="block h-4 w-4">
    <path d="m4 4 8 8M12 4 4 12" />
  </svg>
);

export function NewProjectPanel({ open, origin, store, locale, onClose, onDone, onOpenAccounts }: NewProjectPanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const threadFocusRef = useRef<HTMLDivElement>(null);
  const { form, failure, done, proposal, permission, screen, connectedProvider, busy, reasonKey, secretNotices } = state;

  useEffect(() => {
    if (open) void store.refreshProvider();
  }, [open, store]);

  useEffect(() => {
    if (done !== null) onDone(done);
  }, [done, onDone]);

  const errorUnder = (field: NewProjectField) =>
    failure !== null && failure.field === field ? (
      <p role="alert" className={`flex flex-wrap items-center gap-2 ${NOTE_CLASS} text-error`} data-new-project-error={failure.code}>
        <span>{t(locale, failure.key)}</span>
        {failure.offerAttach ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void store.attachExisting()}
            data-new-project-attach=""
            className={`rounded-control border border-bord px-2 py-0.5 ${NOTE_CLASS} font-semibold text-ink hover:bg-raised disabled:opacity-50`}
          >
            {t(locale, 'newProject.attach')}
          </button>
        ) : null}
      </p>
    ) : null;

  const head = (
    <div className="flex items-start gap-3">
      <WindowTitle title={t(locale, 'setup.title')} lead={t(locale, 'newProject.copy')} />
      <button
        type="button"
        onClick={onClose}
        aria-label={t(locale, 'newProject.close')}
        title={t(locale, 'newProject.close')}
        className="ml-auto grid h-[1.875rem] w-[1.875rem] flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
      >
        <CloseIcon />
      </button>
    </div>
  );

  const primaryLabel =
    screen === 'proposal' ? 'setup.proposal.accept' : screen === 'form' ? 'newProject.create' : 'newProject.create';
  const primaryAction = (): void => {
    if (screen === 'proposal') void store.acceptProposal();
    else if (screen === 'form') void store.submit();
  };
  const primaryDisabled = screen === 'proposal' ? busy || proposal === null : reasonKey !== null || busy;

  const footer = (
    <>
      <ActionButton variant="neutral" size="md" onClick={screen === 'proposal' ? () => store.discardProposal() : onClose}>
        {t(locale, screen === 'proposal' ? 'setup.proposal.discard' : 'newProject.cancel')}
      </ActionButton>
      <span aria-live="polite" className={`ml-auto flex min-w-0 items-center gap-2 ${NOTE_CLASS} text-inkdim`}>
        {busy ? <span className="truncate">{t(locale, 'setup.loading')}</span> : null}
        {reasonKey !== null && !busy ? (
          <>
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 flex-none rounded-full bg-signal" />
            <span className="truncate">{t(locale, reasonKey)}</span>
          </>
        ) : null}
      </span>
      <span className="min-w-[8.25rem] flex-none [&>button]:w-full">
        <ActionButton variant="primary" size="md" disabled={primaryDisabled} onClick={primaryAction}>
          {t(locale, busy ? 'newProject.creating' : primaryLabel)}
        </ActionButton>
      </span>
    </>
  );

  const methodChooser = (
    <div role="group" aria-label={t(locale, 'setup.method.group')} className="grid gap-2" data-setup-method="">
      {hasDraft(form, screen, proposal) ? (
        <button
          type="button"
          data-card="resume"
          onClick={() => store.resumeDraft()}
          className="grid min-h-[4.5rem] w-full gap-1 rounded-card border border-signal-soft bg-raised px-3.5 py-3 text-left"
        >
          <b className="text-[0.875rem] font-semibold text-ink">{t(locale, 'setup.resume.title')}</b>
        </button>
      ) : null}
      {PATH_CARDS.map((card) => {
        const aiDisabled = card.path === 'docket_ai' && !connectedProvider;
        const selected = form.path === card.path && screen !== 'choose';
        const tone = aiDisabled ? 'border-hairline opacity-60' : selected ? 'border-signal-soft bg-raised' : 'border-hairline hover:border-bord';
        return (
          <div key={card.path} className="grid gap-1">
            <button
              type="button"
              disabled={aiDisabled}
              aria-disabled={aiDisabled ? 'true' : undefined}
              data-card={card.path}
              onClick={() => store.pickPath(card.path)}
              className={`flex min-h-[4.5rem] w-full flex-col items-start gap-0.5 rounded-card border bg-surface px-3.5 py-3 text-left ${tone}`}
            >
              <b className="text-[0.875rem] font-semibold text-ink">{t(locale, card.title)}</b>
              {card.desc !== null ? <span className={`${NOTE_CLASS} text-inkdim`}>{t(locale, card.desc)}</span> : null}
            </button>
            {aiDisabled ? (
              <button
                type="button"
                onClick={() => onOpenAccounts?.()}
                className={`${NOTE_CLASS} w-fit rounded-control border border-bord px-2 py-0.5 font-semibold text-inkdim hover:bg-raised hover:text-ink`}
                data-setup-no-provider=""
              >
                {t(locale, 'setup.ai.noProvider')}
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        data-card="import"
        onClick={() => store.pickPath('import')}
        className={`flex min-h-[4.5rem] w-full flex-col items-start gap-0.5 rounded-card border bg-surface px-3.5 py-3 text-left ${
          form.path === 'import' ? 'border-signal-soft bg-raised' : 'border-hairline hover:border-bord'
        }`}
      >
        <b className="text-[0.875rem] font-semibold text-ink">{t(locale, 'newProject.existing')}</b>
        <span className={`${NOTE_CLASS} text-inkdim`}>{t(locale, 'newProject.existing.desc')}</span>
      </button>
    </div>
  );

  const pathForm = (
    <div className="mt-4 grid gap-2" data-new-project-form="existing">
      <label className="grid gap-2">
        <span className={LABEL_CLASS}>{t(locale, 'newProject.folder')}</span>
        <input
          autoFocus
          value={form.repoPath}
          onChange={(event) => store.setRepoPath(event.target.value)}
          placeholder={t(locale, 'newProject.folder.placeholder')}
          className={`${INPUT_CLASS} font-mono`}
        />
      </label>
      {errorUnder('path')}
      {form.path === 'detailed' && form.detailedStep === 1 ? (
        <>
          <label className="grid gap-2">
            <span className={LABEL_CLASS}>{t(locale, 'newProject.name')}</span>
            <input value={form.name} onChange={(event) => store.setName(event.target.value)} className={INPUT_CLASS} />
          </label>
          {errorUnder('name')}
          <label className="grid gap-2">
            <span className={LABEL_CLASS}>{t(locale, 'newProject.location')}</span>
            <input
              value={form.parent}
              onChange={(event) => store.setParent(event.target.value)}
              placeholder={t(locale, 'newProject.location.placeholder')}
              className={`${INPUT_CLASS} font-mono`}
            />
          </label>
          {errorUnder('parent')}
        </>
      ) : (
        <label className="grid gap-2">
          <span className={LABEL_CLASS}>{t(locale, 'newProject.name')}</span>
          <input value={form.name} onChange={(event) => store.setName(event.target.value)} className={INPUT_CLASS} />
        </label>
      )}
      {form.path === 'detailed' && form.detailedStep === 0 ? (
        <ActionButton variant="neutral" size="md" disabled={form.repoPath.trim() === ''} onClick={() => store.nextDetailed()}>
          {t(locale, 'newProject.create')}
        </ActionButton>
      ) : null}
      {errorUnder('name')}
    </div>
  );

  const aiThread = (
    <div
      ref={threadFocusRef}
      tabIndex={-1}
      className="mt-4 grid gap-2 rounded-card border border-hairline px-3.5 py-3 outline-none focus:border-signal"
      data-setup-ai-thread=""
      aria-label={t(locale, 'setup.ai.title')}
    >
      <p className={`${NOTE_CLASS} text-inkdim`}>{t(locale, 'setup.ai.title')}</p>
      {secretNotices > 0 ? (
        <p className={`${NOTE_CLASS} text-error`} data-setup-secret-notice="">{t(locale, 'setup.permission.secretNotice')}</p>
      ) : null}
    </div>
  );

  return (
    <>
      <PanelOverlay
        open={open}
        origin={origin}
        label={t(locale, 'setup.title')}
        brand={t(locale, 'setup.title')}
        rail={null}
        head={head}
        footer={footer}
        dataMark="data-new-project-panel"
        scrimMark="data-new-project-scrim"
        onClose={onClose}
      >
        <div data-new-project="" className="w-full">
          <HomeLaunchers onLaunch={onClose} />
          {screen === 'choose' ? methodChooser : null}
          {screen === 'form' ? pathForm : null}
          {screen === 'ai' ? aiThread : null}
          {screen === 'proposal' && proposal !== null ? (
            <SetupProposalDiff
              locale={locale}
              proposal={proposal}
              expanded={(section) => disclosureExpanded(section)}
              onToggle={(section) => store.toggleSection(section)}
            />
          ) : null}
        </div>
      </PanelOverlay>
      <PermissionPrompt
        open={permission !== null}
        prompt={permission}
        locale={locale}
        onDeny={() => store.denyPermission()}
        onAllow={() => store.allowPermission()}
        returnFocusRef={threadFocusRef}
      />
    </>
  );
}
