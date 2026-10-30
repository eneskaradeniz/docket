// screens/new-project.tsx — Phase 7 "Proje ekle" panel (U-286, U-287, U-272 … U-279): three setup
// entries, import, proposal diff, and the setup permission dialog. The Docket AI entry runs the
// live setup conversation (A-357 … A-360): the repo-folder input starts it, the thread rides the
// chat queries and events, an ask opens the one prompt, the agent's proposal opens the diff.
import { useEffect, useRef, useSyncExternalStore } from 'react';

import { ActionButton } from '../components/action-button';
import { HomeLaunchers } from '../components/launcher-rows';
import { PanelOverlay } from '../components/panel-overlay';
import { PermissionPrompt } from '../components/permission-prompt';
import { SetupAddRepoChooser } from '../components/setup-add-repo-chooser';
import { SetupCopyFrom } from '../components/setup-copy-from';
import { SetupImportRepos } from '../components/setup-import-repos';
import { SetupProposalDiff } from '../components/setup-proposal-diff';
import { SetupRepoList, SetupSummary } from '../components/setup-summary';
import { WindowTitle } from '../components/window-frame';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { noticeTextKey } from '../stores/chat-model';
import {
  disclosureExpanded,
  hasDraft,
  type NewProjectDone,
  type NewProjectField,
  type NewProjectStore,
  type SetupEntryPath,
  type SetupThreadMessage,
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
  /** The "Docket MCP çalışmıyor" line's target (U-315): the settings panel's MCP section. */
  readonly onOpenMcp?: () => void;
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

const WRAP = 'whitespace-pre-wrap [overflow-wrap:anywhere]';

/** A stored thread line as text: a notice key becomes the locale's sentence, anything else stays
 *  the message's own data — rendered as a React text node, never as markup. */
const shownThreadText = (text: string, locale: Locale): string => {
  const key = noticeTextKey(text);
  return key === null ? text : t(locale, key);
};

function ThreadRow({ message, locale }: { readonly message: SetupThreadMessage; readonly locale: Locale }) {
  if (message.role === 'user') {
    return (
      <div data-setup-row="user" className={`${WRAP} justify-self-end rounded-panel bg-raised px-3 py-2 text-[0.8125rem] leading-[1.25rem] text-ink`}>
        {shownThreadText(message.text, locale)}
      </div>
    );
  }
  return (
    <div data-setup-row="assistant" className={`${WRAP} text-[0.8125rem] leading-[1.25rem] text-ink`}>
      {shownThreadText(message.text, locale)}
    </div>
  );
}

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="block h-4 w-4">
    <path d="m4 4 8 8M12 4 4 12" />
  </svg>
);

export function NewProjectPanel({ open, origin, store, locale, onClose, onDone, onOpenAccounts, onOpenMcp }: NewProjectPanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  const threadFocusRef = useRef<HTMLDivElement>(null);
  const {
    form,
    failure,
    done,
    proposal,
    permission,
    permissionRepoLabel,
    screen,
    connectedProvider,
    mcpRunning,
    busy,
    reasonKey,
    secretNotices,
    ai,
    addedRepos,
    importQueue,
    importMode,
    importLoading,
    importOverflow,
    importParent,
    copySourceId,
    copyTargetPath,
    copyErrorKey,
    importSkippedTotal,
  } = state;

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
            className={`rounded-control border border-bord px-2 py-0.5 ${NOTE_CLASS} font-semibold text-ink enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-45`}
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

  // On the AI screen the footer's primary mirrors the thread's own action: starting the
  // conversation before one exists, sending while it runs.
  const multiScreen = screen === 'summary' || screen === 'repo_list' || screen === 'add_chooser' || screen === 'copy_from' || screen === 'import_batch';
  const primaryLabel =
    screen === 'summary'
      ? 'setup.multi.summary.openProject'
      : screen === 'proposal'
        ? 'setup.proposal.accept'
        : screen === 'ai'
          ? ai.conversation === null
            ? 'setup.ai.start'
            : 'setup.ai.send'
          : 'newProject.create';
  const primaryAction = (): void => {
    if (screen === 'summary') void store.openProjectFromSummary();
    else if (screen === 'proposal') void store.acceptProposal();
    else if (screen === 'form') void store.submit();
    else if (screen === 'ai') {
      if (ai.conversation === null) void store.startAi();
      else void store.sendAi();
    }
  };
  const primaryDisabled =
    screen === 'summary'
      ? busy
      : screen === 'proposal'
        ? busy || proposal === null
        : screen === 'ai'
          ? ai.conversation === null
            ? form.repoPath.trim() === '' || busy
            : ai.draft.trim() === '' || ai.turn !== null || busy
          : reasonKey !== null || busy;

  const footer = multiScreen ? undefined : (
    <>
      <ActionButton
        variant="neutral"
        size="md"
        onClick={screen === 'proposal' ? () => store.discardProposal() : onClose}
      >
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

  const pendingImport = importQueue.filter((row) => row.status === 'ready' || row.status === 'review').length;

  const methodChooser = (
    <div role="group" aria-label={t(locale, 'setup.method.group')} className="grid gap-2" data-setup-method="">
      {hasDraft(form, screen, proposal, state.resumable) ? (
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
        const aiDisabled = card.path === 'docket_ai' && (!connectedProvider || !mcpRunning);
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
            {card.path === 'docket_ai' && !connectedProvider ? (
              <button
                type="button"
                onClick={() => onOpenAccounts?.()}
                className={`${NOTE_CLASS} w-fit rounded-control border border-bord px-2 py-0.5 font-semibold text-inkdim hover:bg-raised hover:text-ink`}
                data-setup-no-provider=""
              >
                {t(locale, 'setup.ai.noProvider')}
              </button>
            ) : null}
            {card.path === 'docket_ai' && !mcpRunning ? (
              <button
                type="button"
                onClick={() => onOpenMcp?.()}
                className={`${NOTE_CLASS} w-fit rounded-control border border-bord px-2 py-0.5 font-semibold text-inkdim hover:bg-raised hover:text-ink`}
                data-setup-no-mcp=""
              >
                {t(locale, 'setup.ai.mcpDown')}
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
      {ai.failure !== null ? (
        <p role="alert" className={`${NOTE_CLASS} text-error`} data-setup-ai-failure="">{t(locale, ai.failure)}</p>
      ) : null}
      {ai.conversation === null ? (
        <div className="grid gap-2" data-setup-ai-start="">
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
          {/* The footer's primary mirrors this action (the screen's one primary, U-375); the
              in-card start stays the outline beside it. */}
          <ActionButton
            variant="neutral"
            size="md"
            disabled={form.repoPath.trim() === '' || busy}
            onClick={() => void store.startAi()}
          >
            {t(locale, busy ? 'setup.loading' : 'setup.ai.start')}
          </ActionButton>
        </div>
      ) : (
        <div className="grid gap-2" data-setup-ai-live="">
          <div aria-live="polite" className="grid max-h-[18rem] gap-3 overflow-auto" data-setup-thread="">
            {ai.messages.map((message) => (
              <ThreadRow key={message.id} message={message} locale={locale} />
            ))}
            {ai.streamed !== '' ? (
              <div data-setup-row="assistant" className={`${WRAP} text-[0.8125rem] leading-[1.25rem] text-ink`}>{ai.streamed}</div>
            ) : null}
            {ai.turn !== null ? (
              <span role="status" aria-label={t(locale, 'chat.busy')} className="inline-flex gap-1 py-2">
                <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse" />
                <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse [animation-delay:150ms]" />
                <i className="h-1.5 w-1.5 rounded-full bg-inkdim opacity-60 motion-safe:animate-pulse [animation-delay:300ms]" />
              </span>
            ) : null}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void store.sendAi();
            }}
          >
            <input
              value={ai.draft}
              onChange={(event) => store.setAiDraft(event.target.value)}
              placeholder={t(locale, 'setup.ai.placeholder')}
              aria-label={t(locale, 'setup.ai.placeholder')}
              className={INPUT_CLASS}
              data-setup-composer=""
            />
            <ActionButton variant="neutral" size="md" disabled={ai.draft.trim() === '' || ai.turn !== null || busy} onClick={() => void store.sendAi()}>
              {t(locale, 'setup.ai.send')}
            </ActionButton>
          </form>
        </div>
      )}
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
        <div data-new-project="" className="grid w-full gap-4">
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
              onTestCommandChange={
                state.proposalId === null && (proposal.repo.commandSets['tests'] ?? []).length <= 1
                  ? (value) => store.setTestCommand(value)
                  : undefined
              }
            />
          ) : null}
          {screen === 'summary' ? (
            <SetupSummary
              locale={locale}
              added={addedRepos}
              skipped={importSkippedTotal}
              pending={pendingImport}
              busy={busy}
              onOpenProject={() => void store.openProjectFromSummary()}
              onAddRepo={() => store.showAddChooser()}
              onViewList={() => store.showRepoList()}
            />
          ) : null}
          {screen === 'repo_list' ? (
            <SetupRepoList
              locale={locale}
              repos={addedRepos}
              busy={busy}
              onAddRepo={() => store.showAddChooser()}
              onFinish={() => void store.openProjectFromSummary()}
              onBack={() => store.backFromMulti()}
            />
          ) : null}
          {screen === 'add_chooser' ? (
            <SetupAddRepoChooser
              locale={locale}
              connectedProvider={connectedProvider}
              mcpRunning={mcpRunning}
              onPick={(path) => store.pickPath(path)}
              onOpenAccounts={onOpenAccounts}
              onOpenMcp={onOpenMcp}
              onBack={() => store.backFromMulti()}
            />
          ) : null}
          {screen === 'copy_from' ? (
            <SetupCopyFrom
              locale={locale}
              sources={addedRepos}
              sourceId={copySourceId}
              targetPath={copyTargetPath}
              busy={busy}
              errorKey={copyErrorKey}
              onSource={(id) => store.setCopySource(id)}
              onTarget={(path) => store.setCopyTarget(path)}
              onContinue={() => void store.loadCopyProposal()}
              onBack={() => store.backFromMulti()}
            />
          ) : null}
          {screen === 'import_batch' ? (
            <SetupImportRepos
              locale={locale}
              mode={importMode}
              parentPath={importParent}
              loading={importLoading}
              overflow={importOverflow}
              rows={importQueue}
              busy={busy}
              onMode={(mode) => store.setImportMode(mode)}
              onParent={(path) => store.setImportParent(path)}
              onPickFolders={() => void store.pickImportFolders()}
              onScan={() => void store.scanImportParent()}
              onReview={(path) => store.reviewImportRow(path)}
              onApprove={(path) => void store.approveImportRow(path)}
              onApproveAll={() => void store.approveAllImport()}
              onToSummary={() => store.continueImportToSummary()}
              onBack={() => store.backFromMulti()}
            />
          ) : null}
        </div>
      </PanelOverlay>
      <PermissionPrompt
        open={permission !== null}
        prompt={permission}
        locale={locale}
        repoLabel={permissionRepoLabel}
        onDeny={() => store.denyPermission()}
        onAllow={() => store.allowPermission()}
        returnFocusRef={threadFocusRef}
      />
    </>
  );
}
