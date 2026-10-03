// stores/new-project.ts — the "Yeni proje" page's machine (U-40). Everything the page decides is a
// pure function over a small form record: which card is selected (the disabled cards never are),
// the folder-name prefill, the reason line, the `project.create` intent, and where each refusal
// shows. The store only sequences the calls: create, the `project_exists` → attach offer, the
// tree refresh and the board to open. Docket never overwrites a user's files — the backend decides
// that; this file maps its answers to copy.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { ProjectTreeItem } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure } from './results';

/** The cards in the prototype's order. */
export type NewProjectCard = 'together' | 'existing' | 'clone' | 'blank';

/** The cards that can be selected today; the rest are shown dim with a "Yakında" tag. */
export type NewProjectMode = 'existing' | 'blank';

export const NEW_PROJECT_CARDS: readonly NewProjectCard[] = ['together', 'existing', 'clone', 'blank'];

/** Phase 7 (#658) brings the guided start; cloning has no use case yet. */
export const DISABLED_CARDS: readonly NewProjectCard[] = ['together', 'clone'];

export const isSelectableCard = (card: NewProjectCard): card is NewProjectMode => !DISABLED_CARDS.includes(card);

export type NewProjectField = 'path' | 'name' | 'parent';

export interface NewProjectForm {
  readonly mode: NewProjectMode;
  /** The existing folder (mode existing). */
  readonly path: string;
  readonly name: string;
  /** Once the user has typed a name, the folder's name no longer follows the path. */
  readonly nameEdited: boolean;
  /** The parent folder a blank project is created in (mode blank). */
  readonly parent: string;
}

export const START_FORM: NewProjectForm = { mode: 'existing', path: '', name: '', nameEdited: false, parent: '' };

/** The last path segment, trailing separators ignored; '' for an empty or root path. */
export const folderName = (path: string): string => {
  const segments = path.trim().split(/[\\/]+/).filter((segment) => segment !== '');
  return segments.length === 0 ? '' : segments[segments.length - 1];
};

/** A disabled card is ignored: the form comes back unchanged. */
export const pickCard = (form: NewProjectForm, card: NewProjectCard): NewProjectForm =>
  isSelectableCard(card) ? { ...form, mode: card } : form;

export const typePath = (form: NewProjectForm, path: string): NewProjectForm =>
  form.nameEdited ? { ...form, path } : { ...form, path, name: folderName(path) };

export const typeName = (form: NewProjectForm, name: string): NewProjectForm => ({ ...form, name, nameEdited: true });

export const typeParent = (form: NewProjectForm, parent: string): NewProjectForm => ({ ...form, parent });

/** The first missing input, in the order the page asks for it; null when the primary is enabled. */
export const reasonOf = (form: NewProjectForm): LabelKey | null => {
  if (form.mode === 'existing') {
    if (form.path.trim() === '') return 'newProject.gate.folder';
    return form.name.trim() === '' ? 'newProject.gate.name' : null;
  }
  if (form.name.trim() === '') return 'newProject.gate.name';
  return form.parent.trim() === '' ? 'newProject.gate.location' : null;
};

export const canSubmit = (form: NewProjectForm): boolean => reasonOf(form) === null;

/** The `project.create` intent of the form; null while an input is missing. */
export const commandOf = (form: NewProjectForm): Command | null => {
  if (reasonOf(form) !== null) return null;
  const name = form.name.trim();
  return form.mode === 'existing'
    ? { type: 'project.create', mode: 'existing', path: form.path.trim(), name }
    : { type: 'project.create', mode: 'blank', parent: form.parent.trim(), name };
};

export interface NewProjectFailure {
  readonly code: string;
  readonly field: NewProjectField;
  readonly key: LabelKey;
  /** `project_exists`: the folder is already a Docket project, so "Bağla" is offered. */
  readonly offerAttach: boolean;
}

/** The field a refusal concerns (U-40): the folder or location for path problems, the name for
 *  name problems; a code with no clearer owner sits under the form's first field. */
export const fieldOfFailure = (code: string, mode: NewProjectMode): NewProjectField => {
  const place: NewProjectField = mode === 'existing' ? 'path' : 'parent';
  switch (code) {
    case 'invalid_name':
    case 'folder_exists':
    case 'definitions_invalid':
      return 'name';
    default:
      return place;
  }
};

export const failureOf = (code: string, mode: NewProjectMode, command: Command['type'] = 'project.create'): NewProjectFailure => ({
  code,
  field: fieldOfFailure(code, mode),
  key: commandResultKey(command, { ok: false, code }),
  offerAttach: code === 'project_exists' && mode === 'existing',
});

/** Where a created or attached project opens: a multi-repo project its roadmap, a one-repo project
 *  its board (as the wizard's attach does). Null when the tree does not list it. */
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
  /** The one toast the success carries. */
  readonly toastKey: LabelKey;
}

export interface NewProjectState {
  readonly form: NewProjectForm;
  readonly busy: boolean;
  readonly reasonKey: LabelKey | null;
  readonly failure: NewProjectFailure | null;
  /** Set on success: the page is left, the shell opens `target` and shows the toast. */
  readonly done: NewProjectDone | null;
}

export interface NewProjectStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  /** Re-queries the sidebar tree: a creation appends no work-order event, so nothing else would. */
  readonly reloadTree?: () => Promise<void>;
}

export interface NewProjectStore {
  state(): NewProjectState;
  /** A fresh form: the page opens (or closes) with nothing carried over. */
  reset(): void;
  pickCard(card: NewProjectCard): void;
  setPath(path: string): void;
  setName(name: string): void;
  setParent(parent: string): void;
  /** "Oluştur": `project.create` in the selected mode. */
  submit(): Promise<void>;
  /** "Bağla" after `project_exists`: `project.attach` for the same path. */
  attachExisting(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

export const createNewProjectStore = (deps: NewProjectStoreDeps): NewProjectStore => {
  const { api, actor } = deps;
  let form: NewProjectForm = START_FORM;
  let busy = false;
  let failure: NewProjectFailure | null = null;
  let done: NewProjectDone | null = null;
  let snapshot: NewProjectState | null = null;
  const listeners = new Set<() => void>();

  const publish = (): void => {
    snapshot = null;
    for (const listener of listeners) listener();
  };

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

  const run = async (command: Command, mode: NewProjectMode): Promise<void> => {
    if (busy) return;
    busy = true;
    failure = null;
    publish();
    const result = await api.command(actor, command);
    if (result.ok) {
      await finish(result, command.type === 'project.create' ? 'newProject.created' : 'success.project.attach');
    } else {
      failure = failureOf(result.code, mode, command.type);
    }
    busy = false;
    publish();
  };

  return {
    state: () => {
      snapshot ??= { form, busy, reasonKey: reasonOf(form), failure, done };
      return snapshot;
    },
    reset: () => {
      form = START_FORM;
      busy = false;
      failure = null;
      done = null;
      publish();
    },
    pickCard: (card) => edit(pickCard(form, card)),
    setPath: (path) => edit(typePath(form, path)),
    setName: (name) => edit(typeName(form, name)),
    setParent: (parent) => edit(typeParent(form, parent)),
    submit: async () => {
      const command = commandOf(form);
      if (command === null) return;
      await run(command, form.mode);
    },
    attachExisting: async () => {
      if (failure === null || !failure.offerAttach) return;
      await run({ type: 'project.attach', path: form.path.trim() }, form.mode);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
