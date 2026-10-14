// stores/new-project.ts — Phase 7 project setup (U-286, U-287, U-272 … U-279): three entry paths
// and import converge on one SetupProposal review; permission prompts are session-only. The Docket
// AI path runs a live setup conversation (A-357 … A-360): the folder entry starts it, the thread
// rides the chat queries and events, an ask opens the one prompt, and the proposal the agent made
// opens the identical diff screen.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { ProjectTreeItem, Query, SettingsAccountsView } from '../../api/queries';
import type { Actor, FlowDef, LimitPolicy, RepoFlow, SetupWarning } from '../../domain/index';
import { BUILTIN_FLOWS, planImport, type SkipReason } from '../../domain/index';

type PickFoldersResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly paths: readonly string[]; readonly truncated?: true };
import type { LabelKey } from '../labels/keys';
import { chatFailureKey } from './chat-model';
import { commandResultKey, isQueryFailure } from './results';

export type SetupPathMode = 'docket_ai' | 'quick' | 'detailed';

export type SetupEntryPath = SetupPathMode | 'import' | 'copy_from' | 'import_multi';

export const IMPORT_QUEUE_MAX = 8;

export interface AddedRepoRecord {
  readonly id: string;
  readonly path: string;
}

export type ImportRowStatus = 'ready' | 'review' | 'skipped' | 'added';

export interface ImportQueueRow {
  readonly name: string;
  readonly path: string;
  readonly status: ImportRowStatus;
  readonly reasonKey?: LabelKey;
  readonly proposal?: SetupProposal;
}

/** The api's push events the setup thread reads; the other members ride the same channel and are
 *  ignored (U-12 — the union mirrors the channel so `subscribe` satisfies the signal as-is). */
export type SetupChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' }
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string }
  | { readonly type: 'setup.read.ask'; readonly conversation: string }
  | { readonly type: 'quit.requested'; readonly runs: readonly string[]; readonly chats: readonly string[] };

export type SetupChangeSignal = (listener: (change: SetupChange) => void) => () => void;

export type SetupDetailSection = 'flow' | 'roles' | 'limits' | 'commands';

export interface SetupPermissionPrompt {
  readonly path: string;
  readonly reason: string;
}

export interface SetupProposal {
  readonly project: { readonly name: string; readonly repos: readonly string[] };
  readonly repo: {
    readonly id: string;
    readonly flow: RepoFlow;
    readonly defaultLimitPolicy: LimitPolicy;
    readonly commandSets: Readonly<Record<string, readonly string[]>>;
    readonly docsRoot: string;
    readonly testGlobs: readonly string[];
  };
  readonly warnings: readonly SetupWarning[];
  readonly differsFromRecommended: readonly string[];
}

export type SetupScreen =
  | 'choose'
  | 'form'
  | 'proposal'
  | 'ai'
  | 'summary'
  | 'repo_list'
  | 'add_chooser'
  | 'copy_from'
  | 'import_batch';

export type NewProjectField = 'path' | 'name' | 'parent';

export interface NewProjectForm {
  readonly path: SetupEntryPath | null;
  readonly repoPath: string;
  readonly name: string;
  readonly nameEdited: boolean;
  readonly parent: string;
  readonly detailedStep: 0 | 1;
}

export const START_FORM: NewProjectForm = {
  path: null,
  repoPath: '',
  name: '',
  nameEdited: false,
  parent: '',
  detailedStep: 0,
};

const sessionDisclosure: Record<SetupDetailSection, boolean> = {
  flow: false,
  roles: false,
  limits: false,
  commands: false,
};

export const disclosureExpanded = (section: SetupDetailSection): boolean => sessionDisclosure[section];

export const toggleDisclosure = (section: SetupDetailSection): boolean => {
  sessionDisclosure[section] = !sessionDisclosure[section];
  return sessionDisclosure[section];
};

export const resetSessionDisclosure = (): void => {
  for (const key of Object.keys(sessionDisclosure) as SetupDetailSection[]) sessionDisclosure[key] = false;
};

export const folderName = (path: string): string => {
  const segments = path.trim().split(/[\\/]+/).filter((segment) => segment !== '');
  return segments.length === 0 ? '' : segments[segments.length - 1];
};

export const slugOf = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'project' : slug;
};

const repoFlowOf = (flow: FlowDef): RepoFlow => ({
  flowId: flow.id,
  version: 1,
  stages: flow.stages,
  bindings: flow.stages.map((stage) => ({
    stage: stage.id,
    ...(stage.role === null ? {} : { role: { roleId: stage.role, version: 1 } }),
    accounts: [],
  })),
});

/** Library flow copy — no catalog (U-287, D-8). */
export const buildSetupProposal = (name: string, repoPath: string): SetupProposal => {
  const standard = BUILTIN_FLOWS[0];
  if (standard === undefined) throw new Error('builtin flow');
  const repoSlug = slugOf(name === '' ? folderName(repoPath) : name);
  return {
    project: { name: name.trim() === '' ? folderName(repoPath) : name.trim(), repos: [repoSlug] },
    repo: {
      id: repoSlug,
      flow: repoFlowOf(standard),
      defaultLimitPolicy: 'wait_resume',
      commandSets: { tests: ['npm test'] },
      docsRoot: 'docs',
      testGlobs: ['**/*.test.ts'],
    },
    warnings: [],
    differsFromRecommended: [],
  };
};

export const skipReasonKey = (reason: SkipReason): LabelKey => {
  switch (reason) {
    case 'not_a_git_repo':
      return 'setup.multi.reason.notGit';
    case 'already_in_project':
      return 'setup.multi.reason.duplicate';
    case 'duplicate_path':
      return 'setup.multi.reason.duplicate';
  }
};

export const importStatusOf = (proposal: SetupProposal): ImportRowStatus =>
  proposal.warnings.length > 0 ? 'review' : 'ready';

export const buildAddedRepoProposal = (
  projectName: string,
  existingRepoIds: readonly string[],
  repoPath: string,
): SetupProposal => {
  const draft = buildSetupProposal('', repoPath);
  return {
    ...draft,
    project: { name: projectName, repos: [...existingRepoIds, draft.repo.id] },
  };
};

export const pickPath = (form: NewProjectForm, path: SetupEntryPath): NewProjectForm => ({ ...form, path });

export const typeRepoPath = (form: NewProjectForm, repoPath: string): NewProjectForm =>
  form.nameEdited ? { ...form, repoPath } : { ...form, repoPath, name: folderName(repoPath) };

export const typeName = (form: NewProjectForm, name: string): NewProjectForm => ({ ...form, name, nameEdited: true });

export const typeParent = (form: NewProjectForm, parent: string): NewProjectForm => ({ ...form, parent });

export const advanceDetailed = (form: NewProjectForm): NewProjectForm =>
  form.path === 'detailed' && form.detailedStep === 0 ? { ...form, detailedStep: 1 } : form;

export const reasonOf = (form: NewProjectForm, screen: SetupScreen): LabelKey | null => {
  if (screen !== 'form') return null;
  if (form.path === 'import' || form.path === 'quick') {
    if (form.repoPath.trim() === '') return 'newProject.gate.folder';
    return form.name.trim() === '' ? 'newProject.gate.name' : null;
  }
  if (form.path === 'detailed') {
    if (form.detailedStep === 0) {
      if (form.repoPath.trim() === '') return 'newProject.gate.folder';
      return null;
    }
    if (form.name.trim() === '') return 'newProject.gate.name';
    return form.parent.trim() === '' ? 'newProject.gate.location' : null;
  }
  return null;
};

export const hasDraft = (
  form: NewProjectForm,
  screen: SetupScreen,
  proposal: SetupProposal | null,
  resumable: ResumableDraft | null = null,
): boolean => screen !== 'choose' || proposal !== null || form.path !== null || form.repoPath.trim() !== '' || resumable !== null;

/** The resume card's fact (A-359): the newest persisted setup draft, or null. */
export interface ResumableDraft {
  readonly id: string;
  readonly repoPath: string;
}

export const resumableOf = (view: unknown): ResumableDraft | null => {
  if (isQueryFailure(view) || typeof view !== 'object' || view === null) return null;
  const draft = (view as { readonly draft?: unknown }).draft;
  if (draft === null || draft === undefined) return null;
  if (typeof draft !== 'object') return null;
  const { id, repoPath } = draft as { readonly id?: unknown; readonly repoPath?: unknown };
  return typeof id === 'string' && typeof repoPath === 'string' && id !== '' && repoPath !== '' ? { id, repoPath } : null;
};

/** One row of the setup thread: a stored message reduced to what the thread shows. */
export interface SetupThreadMessage {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

/** The chat conversation view's messages as thread rows; a failure or a foreign shape answers []. */
export const threadOf = (view: unknown): readonly SetupThreadMessage[] => {
  if (isQueryFailure(view) || typeof view !== 'object' || view === null) return [];
  const messages = (view as { readonly messages?: unknown }).messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((message): SetupThreadMessage[] => {
    if (typeof message !== 'object' || message === null) return [];
    const { id, role, text } = message as { readonly id?: unknown; readonly role?: unknown; readonly text?: unknown };
    if (typeof id !== 'string' || typeof text !== 'string' || (role !== 'user' && role !== 'assistant')) return [];
    return [{ id, role, text }];
  });
};

/** The pending-proposal read of the setup surface (A-357): the ask and the secret count, or null. */
export interface SetupPendingRead {
  readonly ask: { readonly path: string; readonly reason: string } | null;
  readonly secrets: number;
}

export const pendingOf = (view: unknown): SetupPendingRead | null => {
  if (isQueryFailure(view) || typeof view !== 'object' || view === null) return null;
  const ask = (view as { readonly ask?: unknown }).ask;
  const secrets = (view as { readonly secrets?: unknown }).secrets;
  if (typeof secrets !== 'number') return null;
  if (ask === null) return { ask: null, secrets };
  if (typeof ask !== 'object' || ask === null) return null;
  const { path, reason } = ask as { readonly path?: unknown; readonly reason?: unknown };
  return typeof path === 'string' && typeof reason === 'string' ? { ask: { path, reason }, secrets } : null;
};

/** The newest pending project_setup row of a proposals.list reply, or null. */
export const setupProposalRowOf = (view: unknown): { readonly id: string; readonly target: string } | null => {
  if (isQueryFailure(view) || !Array.isArray(view)) return null;
  const row = view.find(
    (entry): entry is { readonly id: string; readonly target: string } =>
      typeof entry === 'object' && entry !== null && (entry as { readonly target?: unknown }).target === 'project_setup',
  );
  return row ?? null;
};

/** The stored proposal body (a JSON SetupProposal) parsed back into the diff screen's shape. */
export const setupProposalOf = (after: string): SetupProposal | null => {
  try {
    const parsed = JSON.parse(after) as SetupProposal;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.project?.name !== 'string' ||
      typeof parsed.repo?.id !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

export const connectedProviderOf = (view: unknown): boolean => {
  if (isQueryFailure(view)) return false;
  const accounts = (view as SettingsAccountsView).accounts;
  return Array.isArray(accounts) && accounts.length > 0;
};

/** The Docket MCP standing the AI entry rides (U-315): true only on a running view; null on a
 *  failed read, which keeps whatever the panel held — a broken read never blocks the entry. */
export const mcpRunningOf = (view: unknown): boolean | null => {
  if (isQueryFailure(view) || typeof view !== 'object' || view === null) return null;
  return (view as { readonly state?: unknown }).state === 'running';
};

export type ReadRequestKind = 'allow' | 'ask' | 'secret';

export const readRequestKind = (path: string): ReadRequestKind => {
  const base = path.split(/[/\\]/).pop()?.toLowerCase() ?? '';
  if (base === '.env' || base.startsWith('.env.')) return 'secret';
  if (base.endsWith('.pem') || base.endsWith('.key')) return 'secret';
  return 'ask';
};

export const canShowPermission = (
  current: SetupPermissionPrompt | null,
  denied: ReadonlySet<string>,
  path: string,
): boolean => current === null && !denied.has(path);

export const permissionAfterDeny = (
  denied: ReadonlySet<string>,
  path: string,
): ReadonlySet<string> => new Set([...denied, path]);

export interface NewProjectFailure {
  readonly code: string;
  readonly field: NewProjectField;
  readonly key: LabelKey;
  readonly offerAttach: boolean;
}

export const fieldOfFailure = (code: string, importMode: boolean): NewProjectField => {
  switch (code) {
    case 'invalid_name':
    case 'folder_exists':
    case 'definitions_invalid':
      return 'name';
    default:
      return importMode ? 'path' : 'path';
  }
};

export const failureOf = (code: string, importMode: boolean, command: Command['type'] = 'project.create'): NewProjectFailure => ({
  code,
  field: fieldOfFailure(code, importMode),
  key: commandResultKey(command, { ok: false, code }),
  offerAttach: code === 'project_exists' && importMode,
});

export type NewProjectTarget =
  | { readonly kind: 'roadmap'; readonly project: string }
  | { readonly kind: 'board'; readonly repo: string };

export const targetOf = (tree: unknown, id: string | undefined): NewProjectTarget | null => {
  if (isQueryFailure(tree) || !Array.isArray(tree)) return null;
  const projects = tree as readonly ProjectTreeItem[];
  const project = projects.find((item) => item.project === id);
  if (project === undefined) return null;
  return project.repos.length > 1 ? { kind: 'roadmap', project: project.project } : { kind: 'board', repo: project.mainRepo };
};

export interface NewProjectDone {
  readonly target: NewProjectTarget | null;
  readonly toastKey: LabelKey;
}

/** The Docket AI thread's own state (A-357 … A-359): the conversation id once started, its stored
 *  messages, the live turn's streamed text and id, the composer's draft, the start failure. */
export interface SetupAiState {
  readonly conversation: string | null;
  readonly messages: readonly SetupThreadMessage[];
  readonly streamed: string;
  readonly turn: string | null;
  readonly draft: string;
  readonly failure: LabelKey | null;
}

export const START_AI: SetupAiState = { conversation: null, messages: [], streamed: '', turn: null, draft: '', failure: null };

export interface NewProjectState {
  readonly screen: SetupScreen;
  readonly form: NewProjectForm;
  readonly connectedProvider: boolean;
  /** The built-in Docket MCP standing (U-315); true until the first read says otherwise. */
  readonly mcpRunning: boolean;
  readonly busy: boolean;
  readonly reasonKey: LabelKey | null;
  readonly failure: NewProjectFailure | null;
  readonly proposal: SetupProposal | null;
  /** The server-side proposal the AI agent made, when the diff on screen is one (A-360). */
  readonly proposalId: string | null;
  readonly resumable: ResumableDraft | null;
  readonly ai: SetupAiState;
  readonly permission: SetupPermissionPrompt | null;
  /** Depo badge on the permission dialog (U-316). */
  readonly permissionRepoLabel: string | null;
  readonly deniedPaths: readonly string[];
  readonly secretNotices: number;
  readonly done: NewProjectDone | null;
  readonly projectId: string | null;
  readonly projectName: string;
  readonly addedRepos: readonly AddedRepoRecord[];
  readonly importQueue: readonly ImportQueueRow[];
  readonly importMode: 'multi' | 'parent';
  readonly importLoading: boolean;
  readonly importOverflow: number;
  readonly importParent: string;
  readonly copySourceId: string;
  readonly copyTargetPath: string;
  readonly copyErrorKey: LabelKey | null;
  readonly importSkippedTotal: number;
  readonly activeRepoPath: string;
}

export interface NewProjectStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly changes?: SetupChangeSignal;
  readonly reloadTree?: () => Promise<void>;
  readonly pickFolders?: (options?: { readonly multiple?: boolean }) => Promise<PickFoldersResult>;
}

export interface NewProjectStore {
  state(): NewProjectState;
  reset(): void;
  refreshProvider(): Promise<void>;
  resumeDraft(): void;
  pickPath(path: SetupEntryPath): void;
  setRepoPath(path: string): void;
  setName(name: string): void;
  setParent(parent: string): void;
  nextDetailed(): void;
  generateProposal(): Promise<void>;
  discardProposal(): void;
  acceptProposal(): Promise<void>;
  requestAiRead(path: string, reason: string): void;
  denyPermission(): void;
  allowPermission(): void;
  startAi(resume?: ResumableDraft): Promise<void>;
  setAiDraft(text: string): void;
  sendAi(): Promise<void>;
  toggleSection(section: SetupDetailSection): void;
  attachExisting(): Promise<void>;
  submit(): Promise<void>;
  openProjectFromSummary(): Promise<void>;
  showAddChooser(): void;
  showRepoList(): void;
  backFromMulti(): void;
  setCopySource(id: string): void;
  setCopyTarget(path: string): void;
  loadCopyProposal(): Promise<void>;
  setImportMode(mode: 'multi' | 'parent'): void;
  setImportParent(path: string): void;
  pickImportFolders(): Promise<void>;
  scanImportParent(): Promise<void>;
  reviewImportRow(path: string): void;
  approveImportRow(path: string): Promise<void>;
  approveAllImport(): Promise<void>;
  continueImportToSummary(): void;
  subscribe(listener: () => void): () => void;
}

export const createNewProjectStore = (deps: NewProjectStoreDeps): NewProjectStore => {
  const { api, actor } = deps;
  let screen: SetupScreen = 'choose';
  let form: NewProjectForm = START_FORM;
  let connectedProvider = false;
  let mcpRunning = true;
  let busy = false;
  let failure: NewProjectFailure | null = null;
  let proposal: SetupProposal | null = null;
  let proposalId: string | null = null;
  let resumable: ResumableDraft | null = null;
  let ai: SetupAiState = START_AI;
  let permission: SetupPermissionPrompt | null = null;
  let deniedPaths = new Set<string>();
  let secretNotices = 0;
  let secretsSeen = 0;
  let done: NewProjectDone | null = null;
  let projectId: string | null = null;
  let projectName = '';
  let addedRepos: AddedRepoRecord[] = [];
  let importQueue: ImportQueueRow[] = [];
  let importMode: 'multi' | 'parent' = 'multi';
  let importLoading = false;
  let importOverflow = 0;
  let importParent = '';
  let importSkippedTotal = 0;
  let copySourceId = '';
  let copyTargetPath = '';
  let copyErrorKey: LabelKey | null = null;
  let permissionRepoLabel: string | null = null;
  let activeRepoPath = '';
  let snapshot: NewProjectState | null = null;
  const listeners = new Set<() => void>();
  const sessionGrants = new Set<string>();

  const publish = (): void => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

  const stateOf = (): NewProjectState => ({
    screen,
    form,
    connectedProvider,
    mcpRunning,
    busy,
    reasonKey: reasonOf(form, screen),
    failure,
    proposal,
    proposalId,
    resumable,
    ai,
    permission,
    deniedPaths: [...deniedPaths],
    secretNotices,
    done,
    projectId,
    projectName,
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
    activeRepoPath,
    permissionRepoLabel,
  });

  const edit = (next: NewProjectForm): void => {
    form = next;
    failure = null;
    publish();
  };

  // --- the Docket AI thread (A-357 … A-359) --------------------------------------------------------------

  /** The stored conversation as thread rows; a failed read keeps the last good thread. */
  const reloadThread = async (): Promise<void> => {
    if (ai.conversation === null) return;
    ai = { ...ai, messages: threadOf(await api.query({ type: 'chat.conversation', id: ai.conversation })) };
    publish();
  };

  /** The pending read of the setup surface: an ask opens the one prompt (U-272, U-275), a secret
   *  count the thread has not shown yet becomes its one-line notice (U-277). */
  const refreshPending = async (): Promise<void> => {
    if (ai.conversation === null) return;
    const pending = pendingOf(await api.query({ type: 'setup.read.pending', conversation: ai.conversation }));
    if (pending === null) return;
    if (pending.secrets > secretsSeen) {
      secretNotices += pending.secrets - secretsSeen;
      secretsSeen = pending.secrets;
    }
    if (pending.ask !== null && canShowPermission(permission, deniedPaths, pending.ask.path)) {
      permission = { path: pending.ask.path, reason: pending.ask.reason };
      permissionRepoLabel = folderName(activeRepoPath) || folderName(form.repoPath) || null;
    }
    publish();
  };

  /** The newest pending project_setup proposal the agent made becomes the diff on screen (A-360). */
  const pollProposal = async (): Promise<void> => {
    const row = setupProposalRowOf(await api.query({ type: 'proposals.list', status: 'pending' }));
    if (row === null) return;
    const detail: unknown = await api.query({ type: 'proposal.detail', id: row.id });
    if (isQueryFailure(detail) || typeof detail !== 'object' || detail === null) return;
    const parsed = setupProposalOf(String((detail as { readonly after?: unknown }).after ?? ''));
    if (parsed === null) return;
    proposal = parsed;
    proposalId = row.id;
    screen = 'proposal';
    publish();
  };

  const enterSummary = (name: string, id: string, repo: AddedRepoRecord): void => {
    projectId = id;
    projectName = name;
    addedRepos = [...addedRepos, repo];
    resetSessionDisclosure();
    proposal = null;
    proposalId = null;
    form = START_FORM;
    ai = START_AI;
    permission = null;
    permissionRepoLabel = null;
    screen = 'summary';
  };

  /** A finished setup writes the definitions; multi-repo stays on the summary screen. */
  const finishAi = async (): Promise<void> => {
    if (proposal === null) return;
    const repoPath = form.repoPath.trim();
    const repo: AddedRepoRecord = { id: proposal.repo.id, path: repoPath };
    if (projectId === null) {
      await deps.reloadTree?.();
      enterSummary(proposal.project.name, slugOf(proposal.project.name), repo);
      publish();
      return;
    }
    await deps.reloadTree?.();
    enterSummary(projectName, projectId, repo);
    publish();
  };

  /** A start refusal in the surface's own words: the entry's own no-provider and MCP lines, the
   *  chat vocabulary for the rest. */
  const aiFailureKey = (code: string): LabelKey =>
    code === 'no_provider' ? 'setup.ai.noProvider' : code === 'mcp_down' ? 'setup.ai.mcpDown' : chatFailureKey(code);

  const startAi = async (resume?: ResumableDraft): Promise<void> => {
    if (busy) return;
    busy = true;
    failure = null;
    ai = { ...ai, failure: null };
    publish();
    const repoPath = (resume === undefined ? form.repoPath : resume.repoPath).trim();
    const result = await api.command(actor, { type: 'setup.ai.start', repoPath, ...(resume === undefined ? {} : { draft: resume.id }) });
    busy = false;
    if (!result.ok || result.conversation === undefined) {
      ai = { ...ai, failure: result.ok ? 'error.unknown' : aiFailureKey(result.code) };
      publish();
      return;
    }
    ai = { conversation: result.conversation, messages: [], streamed: '', turn: null, draft: '', failure: null };
    screen = 'ai';
    publish();
    await reloadThread();
    await refreshPending();
    await pollProposal();
  };

  const sendAi = async (): Promise<void> => {
    const conversation = ai.conversation;
    const text = ai.draft.trim();
    if (conversation === null || text === '' || busy || ai.turn !== null) return;
    ai = { ...ai, draft: '' };
    publish();
    const result = await api.command(actor, { type: 'chat.send', conversation, text });
    if (!result.ok) {
      ai = { ...ai, failure: aiFailureKey(result.code) };
      publish();
      return;
    }
    await reloadThread();
  };

  // The push events of the setup surface: an ask opens the prompt, the turn events feed the thread.
  deps.changes?.((change) => {
    if (change.type !== 'setup.read.ask' && change.type !== 'chat.turn' && change.type !== 'chat.delta' && change.type !== 'chat.notice') return;
    if (ai.conversation === null || change.conversation !== ai.conversation) return;
    if (change.type === 'setup.read.ask') {
      void refreshPending();
      return;
    }
    if (change.type === 'chat.turn' && change.phase === 'started') {
      ai = { ...ai, turn: change.turn, streamed: '', failure: null };
      publish();
      return;
    }
    if (change.type === 'chat.delta') {
      ai = { ...ai, streamed: ai.streamed + change.text };
      publish();
      return;
    }
    // chat.turn finished: the stored messages now stand where the streamed text was, and the
    // agent's proposal — if it made one — becomes the diff on screen.
    ai = { ...ai, turn: null, streamed: '' };
    publish();
    void (async () => {
      await reloadThread();
      await refreshPending();
      await pollProposal();
    })();
  });

  const finish = async (result: Extract<CommandResult, { readonly ok: true }>, toastKey: LabelKey): Promise<void> => {
    await deps.reloadTree?.();
    const tree: unknown = await api.query({ type: 'project.tree' });
    done = { target: targetOf(tree, result.id), toastKey };
  };

  const applyConfirmedRepo = async (path: string, body: SetupProposal): Promise<boolean> => {
    if (projectId === null) return false;
    const result = await api.command(actor, { type: 'setup.apply', project: projectId, path, proposal: body });
    if (!result.ok) {
      failure = failureOf(result.code, false, 'setup.apply');
      return false;
    }
    addedRepos = [...addedRepos, { id: body.repo.id, path }];
    await deps.reloadTree?.();
    return true;
  };

  const queueFromFound = (found: readonly { readonly name: string; readonly path: string; readonly isGit: boolean }[]): void => {
    const inProject = addedRepos.map((repo) => repo.path);
    const plan = planImport(found, inProject, IMPORT_QUEUE_MAX);
    importOverflow = plan.overflow;
    importSkippedTotal += plan.rows.filter((row) => row.state === 'skipped').length;
    const ids = addedRepos.map((repo) => repo.id);
    importQueue = plan.rows.map((row): ImportQueueRow => {
      if (row.state === 'skipped') {
        return {
          name: row.name,
          path: row.path,
          status: 'skipped',
          reasonKey: row.reason === undefined ? undefined : skipReasonKey(row.reason),
        };
      }
      const proposalBody = buildAddedRepoProposal(projectName, ids, row.path);
      return {
        name: row.name,
        path: row.path,
        status: importStatusOf(proposalBody),
        proposal: proposalBody,
      };
    });
  };

  const run = async (command: Command, importMode: boolean): Promise<void> => {
    if (busy) return;
    busy = true;
    failure = null;
    publish();
    const result = await api.command(actor, command);
    if (result.ok) {
      if (command.type === 'project.attach') {
        await finish(result, 'success.project.attach');
        resetSessionDisclosure();
        form = START_FORM;
        screen = 'choose';
        proposal = null;
      } else {
        await finish(result, 'newProject.created');
        resetSessionDisclosure();
        form = START_FORM;
        screen = 'choose';
        proposal = null;
      }
    } else {
      failure = failureOf(result.code, importMode, command.type);
    }
    busy = false;
    publish();
  };

  return {
    state: () => {
      snapshot ??= stateOf();
      return snapshot;
    },
    reset: () => {
      form = START_FORM;
      screen = 'choose';
      busy = false;
      failure = null;
      proposal = null;
      proposalId = null;
      resumable = null;
      ai = START_AI;
      permission = null;
      deniedPaths = new Set();
      secretNotices = 0;
      secretsSeen = 0;
      sessionGrants.clear();
      done = null;
      projectId = null;
      projectName = '';
      addedRepos = [];
      importQueue = [];
      importMode = 'multi';
      importLoading = false;
      importOverflow = 0;
      importParent = '';
      importSkippedTotal = 0;
      copySourceId = '';
      copyTargetPath = '';
      copyErrorKey = null;
      permissionRepoLabel = null;
      activeRepoPath = '';
      publish();
    },
    refreshProvider: async () => {
      const reply: unknown = await api.query({ type: 'settings.accounts', catalog: 'skip' } satisfies Query);
      connectedProvider = connectedProviderOf(reply);
      // The entry's second standing (U-315): the Docket MCP must be running; a failed read keeps
      // the last one instead of blocking the entry.
      const standing = mcpRunningOf(await api.query({ type: 'mcp.status' }));
      if (standing !== null) mcpRunning = standing;
      // The persisted draft decides the resume card (A-340, A-359); a missing surface answers
      // nothing and the card simply stays away.
      resumable = resumableOf(await api.query({ type: 'setup.draft' }));
      publish();
    },
    resumeDraft: () => {
      if (resumable !== null) {
        void startAi(resumable);
        return;
      }
      if (proposal !== null) screen = 'proposal';
      else if (form.path === 'docket_ai') screen = 'ai';
      else if (form.path !== null) screen = 'form';
      publish();
    },
    pickPath: (path) => {
      if (path === 'docket_ai' && (!connectedProvider || !mcpRunning)) return;
      form = pickPath(form, path);
      failure = null;
      copyErrorKey = null;
      if (path === 'copy_from') {
        copySourceId = addedRepos[0]?.id ?? '';
        screen = 'copy_from';
      } else if (path === 'import_multi') {
        importQueue = [];
        importOverflow = 0;
        screen = 'import_batch';
      } else if (path === 'docket_ai') {
        screen = 'ai';
      } else {
        screen = 'form';
      }
      publish();
    },
    setRepoPath: (path) => edit(typeRepoPath(form, path)),
    setName: (name) => edit(typeName(form, name)),
    setParent: (parent) => edit(typeParent(form, parent)),
    nextDetailed: () => edit(advanceDetailed(form)),
    generateProposal: async () => {
      if (busy || reasonOf(form, screen) !== null) return;
      busy = true;
      failure = null;
      publish();
      activeRepoPath = form.repoPath.trim();
      proposal =
        projectId === null
          ? buildSetupProposal(form.name, activeRepoPath)
          : buildAddedRepoProposal(projectName, addedRepos.map((repo) => repo.id), activeRepoPath);
      screen = 'proposal';
      busy = false;
      publish();
    },
    discardProposal: () => {
      if (proposalId !== null) {
        // The agent's proposal (A-360): rejection writes nothing and keeps the draft; the thread
        // stands open for the next round.
        const rejected = proposalId;
        proposalId = null;
        proposal = null;
        screen = 'ai';
        publish();
        void api.command(actor, { type: 'proposal.decide', id: rejected, decision: 'rejected' });
        return;
      }
      proposal = null;
      screen = form.path === null ? 'choose' : 'form';
      publish();
    },
    acceptProposal: async () => {
      if (proposal === null || busy) return;
      if (proposalId !== null) {
        busy = true;
        publish();
        const decided = await api.command(actor, { type: 'proposal.decide', id: proposalId, decision: 'approved' });
        busy = false;
        if (!decided.ok) {
          failure = failureOf(decided.code, false, 'proposal.decide');
          publish();
          return;
        }
        await finishAi();
        return;
      }
      const name = proposal.project.name;
      const path = activeRepoPath !== '' ? activeRepoPath : form.repoPath.trim();
      busy = true;
      failure = null;
      publish();
      if (projectId === null) {
        if (form.path === 'import') {
          busy = false;
          await run({ type: 'project.attach', path }, true);
          return;
        }
        const createCommand: Command =
          form.path === 'detailed' && form.parent.trim() !== ''
            ? { type: 'project.create', mode: 'blank', parent: form.parent.trim(), name }
            : { type: 'project.create', mode: 'existing', path, name };
        const created = await api.command(actor, createCommand);
        if (!created.ok) {
          failure = failureOf(created.code, false, createCommand.type);
          busy = false;
          publish();
          return;
        }
        const createdId = created.id;
        if (createdId === undefined) {
          failure = failureOf('invalid_id', false, createCommand.type);
          busy = false;
          publish();
          return;
        }
        projectId = createdId;
        projectName = name;
        const applied = await api.command(actor, { type: 'setup.apply', project: createdId, path, proposal });
        if (!applied.ok) {
          failure = failureOf(applied.code, false, 'setup.apply');
          busy = false;
          publish();
          return;
        }
        await deps.reloadTree?.();
        enterSummary(name, projectId, { id: proposal.repo.id, path });
        busy = false;
        publish();
        return;
      }
      const applied = await applyConfirmedRepo(path, proposal);
      busy = false;
      if (applied) {
        screen = 'summary';
        proposal = null;
        activeRepoPath = '';
        form = START_FORM;
      }
      publish();
    },
    requestAiRead: (path, reason) => {
      const kind = readRequestKind(path);
      if (kind === 'secret') {
        secretNotices += 1;
        publish();
        return;
      }
      if (!canShowPermission(permission, deniedPaths, path)) return;
      permission = { path, reason };
      permissionRepoLabel = folderName(activeRepoPath) || folderName(form.repoPath) || null;
      publish();
    },
    denyPermission: () => {
      if (permission === null) return;
      deniedPaths = new Set(permissionAfterDeny(deniedPaths, permission.path));
      const answered = ai.conversation;
      const refused = permission.path;
      permission = null;
      publish();
      // The denied path is remembered for the conversation (U-276): the agent's retry is a typed
      // refusal, never a second prompt.
      if (answered !== null) void api.command(actor, { type: 'setup.read.answer', conversation: answered, path: refused, allow: false });
    },
    allowPermission: () => {
      if (permission === null) return;
      sessionGrants.add(permission.path);
      const answered = ai.conversation;
      const granted = permission.path;
      permission = null;
      publish();
      // A live setup conversation records the grant server-side (A-335, A-358); the agent's
      // retry then passes through it.
      if (answered !== null) void api.command(actor, { type: 'setup.read.answer', conversation: answered, path: granted, allow: true });
    },
    toggleSection: (section) => {
      toggleDisclosure(section);
      publish();
    },
    startAi,
    setAiDraft: (text) => {
      ai = { ...ai, draft: text };
      publish();
    },
    sendAi,
    attachExisting: async () => {
      if (failure === null || !failure.offerAttach) return;
      await run({ type: 'project.attach', path: form.repoPath.trim() }, true);
    },
    submit: async () => {
      if (screen !== 'form' || busy || reasonOf(form, screen) !== null) return;
      busy = true;
      failure = null;
      publish();
      activeRepoPath = form.repoPath.trim();
      if (projectId === null) {
        proposal = buildSetupProposal(form.name, activeRepoPath);
      } else {
        proposal = buildAddedRepoProposal(projectName, addedRepos.map((repo) => repo.id), activeRepoPath);
      }
      screen = 'proposal';
      busy = false;
      publish();
    },
    openProjectFromSummary: async () => {
      if (projectId === null || busy) return;
      busy = true;
      publish();
      await deps.reloadTree?.();
      const tree: unknown = await api.query({ type: 'project.tree' });
      done = { target: targetOf(tree, projectId), toastKey: 'newProject.created' };
      busy = false;
      publish();
    },
    showAddChooser: () => {
      screen = 'add_chooser';
      publish();
    },
    showRepoList: () => {
      screen = 'repo_list';
      publish();
    },
    backFromMulti: () => {
      screen = projectId === null ? 'choose' : 'summary';
      publish();
    },
    setCopySource: (id) => {
      copySourceId = id;
      copyErrorKey = null;
      publish();
    },
    setCopyTarget: (path) => {
      copyTargetPath = path;
      copyErrorKey = null;
      publish();
    },
    loadCopyProposal: async () => {
      if (projectId === null || copySourceId === '' || copyTargetPath.trim() === '' || busy) return;
      busy = true;
      copyErrorKey = null;
      publish();
      const reply: unknown = await api.query({
        type: 'setup.copyProposal',
        project: projectId,
        source: copySourceId,
        path: copyTargetPath.trim(),
      });
      busy = false;
      if (isQueryFailure(reply)) {
        copyErrorKey = `error.${reply.code}` as LabelKey;
        publish();
        return;
      }
      proposal = reply as SetupProposal;
      activeRepoPath = copyTargetPath.trim();
      screen = 'proposal';
      publish();
    },
    setImportMode: (mode) => {
      importMode = mode;
      publish();
    },
    setImportParent: (path) => {
      importParent = path;
      publish();
    },
    pickImportFolders: async () => {
      if (deps.pickFolders === undefined || busy) return;
      importLoading = true;
      publish();
      const picked = await deps.pickFolders({ multiple: true });
      importLoading = false;
      if (picked.canceled) {
        publish();
        return;
      }
      queueFromFound(
        picked.paths.map((path) => ({
          name: folderName(path),
          path,
          isGit: true,
        })),
      );
      publish();
    },
    scanImportParent: async () => {
      if (importParent.trim() === '' || busy) return;
      importLoading = true;
      publish();
      const reply: unknown = await api.query({ type: 'repos.discover', parent: importParent.trim() });
      importLoading = false;
      if (isQueryFailure(reply)) {
        importSkippedTotal += 1;
        publish();
        return;
      }
      const body = reply as { readonly found: readonly { readonly name: string; readonly path: string; readonly isGit: boolean }[] };
      queueFromFound(body.found);
      publish();
    },
    reviewImportRow: (path) => {
      const row = importQueue.find((entry) => entry.path === path);
      if (row?.proposal === undefined) return;
      proposal = row.proposal;
      activeRepoPath = path;
      screen = 'proposal';
      publish();
    },
    approveImportRow: async (path) => {
      const row = importQueue.find((entry) => entry.path === path);
      if (row?.proposal === undefined || row.status !== 'ready' || busy) return;
      busy = true;
      publish();
      const okApply = await applyConfirmedRepo(path, row.proposal);
      busy = false;
      if (okApply) {
        importQueue = importQueue.map((entry) =>
          entry.path === path ? { ...entry, status: 'added' as const, proposal: undefined } : entry,
        );
      }
      publish();
    },
    approveAllImport: async () => {
      if (busy || importQueue.some((row) => row.status === 'review')) return;
      const ready = importQueue.filter((row) => row.status === 'ready' && row.proposal !== undefined);
      for (const row of ready) {
        if (row.proposal === undefined) continue;
        busy = true;
        publish();
        const okApply = await applyConfirmedRepo(row.path, row.proposal);
        busy = false;
        if (okApply) {
          importQueue = importQueue.map((entry) =>
            entry.path === row.path ? { ...entry, status: 'added' as const, proposal: undefined } : entry,
          );
        }
        publish();
      }
    },
    continueImportToSummary: () => {
      screen = 'summary';
      importQueue = [];
      importOverflow = 0;
      publish();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
