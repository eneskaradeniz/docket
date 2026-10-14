// stores/new-project.ts — Phase 7 project setup (U-286, U-287, U-272 … U-279): three entry paths
// and import converge on one SetupProposal review; permission prompts are session-only. Import and
// create still map to the existing project commands until the setup proposal api lands (#1021).
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { ProjectTreeItem, Query, SettingsAccountsView } from '../../api/queries';
import type { Actor, FlowDef, LimitPolicy, RepoFlow, SetupWarning } from '../../domain/index';
import { BUILTIN_FLOWS } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure } from './results';

export type SetupPathMode = 'docket_ai' | 'quick' | 'detailed';

export type SetupEntryPath = SetupPathMode | 'import';

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

export type SetupScreen = 'choose' | 'form' | 'proposal' | 'ai';

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

export const hasDraft = (form: NewProjectForm, screen: SetupScreen, proposal: SetupProposal | null): boolean =>
  screen !== 'choose' || proposal !== null || form.path !== null || form.repoPath.trim() !== '';

export const connectedProviderOf = (view: unknown): boolean => {
  if (isQueryFailure(view)) return false;
  const accounts = (view as SettingsAccountsView).accounts;
  return Array.isArray(accounts) && accounts.length > 0;
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

export interface NewProjectState {
  readonly screen: SetupScreen;
  readonly form: NewProjectForm;
  readonly connectedProvider: boolean;
  readonly busy: boolean;
  readonly reasonKey: LabelKey | null;
  readonly failure: NewProjectFailure | null;
  readonly proposal: SetupProposal | null;
  readonly permission: SetupPermissionPrompt | null;
  readonly deniedPaths: readonly string[];
  readonly secretNotices: number;
  readonly done: NewProjectDone | null;
}

export interface NewProjectStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly reloadTree?: () => Promise<void>;
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
  toggleSection(section: SetupDetailSection): void;
  attachExisting(): Promise<void>;
  submit(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export const createNewProjectStore = (deps: NewProjectStoreDeps): NewProjectStore => {
  const { api, actor } = deps;
  let screen: SetupScreen = 'choose';
  let form: NewProjectForm = START_FORM;
  let connectedProvider = false;
  let busy = false;
  let failure: NewProjectFailure | null = null;
  let proposal: SetupProposal | null = null;
  let permission: SetupPermissionPrompt | null = null;
  let deniedPaths = new Set<string>();
  let secretNotices = 0;
  let done: NewProjectDone | null = null;
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
    busy,
    reasonKey: reasonOf(form, screen),
    failure,
    proposal,
    permission,
    deniedPaths: [...deniedPaths],
    secretNotices,
    done,
  });

  const edit = (next: NewProjectForm): void => {
    form = next;
    failure = null;
    publish();
  };

  const finish = async (result: Extract<CommandResult, { readonly ok: true }>, toastKey: LabelKey): Promise<void> => {
    await deps.reloadTree?.();
    const tree: unknown = await api.query({ type: 'project.tree' });
    done = { target: targetOf(tree, result.id), toastKey };
  };

  const run = async (command: Command, importMode: boolean): Promise<void> => {
    if (busy) return;
    busy = true;
    failure = null;
    publish();
    const result = await api.command(actor, command);
    if (result.ok) {
      await finish(result, command.type === 'project.create' ? 'newProject.created' : 'success.project.attach');
      resetSessionDisclosure();
      form = START_FORM;
      screen = 'choose';
      proposal = null;
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
      permission = null;
      deniedPaths = new Set();
      secretNotices = 0;
      sessionGrants.clear();
      done = null;
      publish();
    },
    refreshProvider: async () => {
      const reply: unknown = await api.query({ type: 'settings.accounts', catalog: 'skip' } satisfies Query);
      connectedProvider = connectedProviderOf(reply);
      publish();
    },
    resumeDraft: () => {
      if (proposal !== null) screen = 'proposal';
      else if (form.path === 'docket_ai') screen = 'ai';
      else if (form.path !== null) screen = 'form';
      publish();
    },
    pickPath: (path) => {
      if (path === 'docket_ai' && !connectedProvider) return;
      form = pickPath(form, path);
      failure = null;
      screen = path === 'docket_ai' ? 'ai' : 'form';
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
      proposal = buildSetupProposal(form.name, form.repoPath.trim());
      screen = 'proposal';
      busy = false;
      publish();
    },
    discardProposal: () => {
      proposal = null;
      screen = form.path === null ? 'choose' : 'form';
      publish();
    },
    acceptProposal: async () => {
      if (proposal === null || busy) return;
      const name = proposal.project.name;
      const path = form.repoPath.trim();
      if (form.path === 'import') {
        await run({ type: 'project.attach', path }, true);
        return;
      }
      if (form.path === 'detailed' && form.parent.trim() !== '') {
        await run({ type: 'project.create', mode: 'blank', parent: form.parent.trim(), name }, false);
        return;
      }
      await run({ type: 'project.create', mode: 'existing', path, name }, false);
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
      publish();
    },
    denyPermission: () => {
      if (permission === null) return;
      deniedPaths = new Set(permissionAfterDeny(deniedPaths, permission.path));
      permission = null;
      publish();
    },
    allowPermission: () => {
      if (permission === null) return;
      sessionGrants.add(permission.path);
      permission = null;
      publish();
    },
    toggleSection: (section) => {
      toggleDisclosure(section);
      publish();
    },
    attachExisting: async () => {
      if (failure === null || !failure.offerAttach) return;
      await run({ type: 'project.attach', path: form.repoPath.trim() }, true);
    },
    submit: async () => {
      if (screen !== 'form' || busy || reasonOf(form, screen) !== null) return;
      busy = true;
      failure = null;
      publish();
      proposal = buildSetupProposal(form.name, form.repoPath.trim());
      screen = 'proposal';
      busy = false;
      publish();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
