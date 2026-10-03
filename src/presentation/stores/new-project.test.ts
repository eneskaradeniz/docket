// new-project.test.ts — U-40: the "Yeni proje" page's form rules and the store's sequencing. The
// api is a scripted fake that records every command and query.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import {
  DISABLED_CARDS,
  START_FORM,
  commandOf,
  createNewProjectStore,
  failureOf,
  folderName,
  isSelectableCard,
  pickCard,
  reasonOf,
  typeName,
  typeParent,
  typePath,
  type NewProjectCard,
  type NewProjectStore,
} from './new-project';

const actor: Actor = { kind: 'user', id: 'user-1' };

interface Fake extends Pick<Api, 'query' | 'command'> {
  readonly commands: Command[];
  readonly queries: Query[];
  reply(type: Command['type'], result: CommandResult): void;
}

const oneRepoTree = [
  { project: 'atolye', name: 'Atölye', mainRepo: 'atolye', repos: [{ repo: 'atolye', name: 'atolye', main: true, active: 0, status: 'idle' }], active: 0, running: 0, waiting: 0, status: 'idle' },
];

const fakeApi = (tree: unknown = oneRepoTree): Fake => {
  const commands: Command[] = [];
  const queries: Query[] = [];
  const replies = new Map<string, CommandResult>();
  return {
    commands,
    queries,
    reply: (type, result) => replies.set(type, result),
    query: (query) => {
      queries.push(query);
      return Promise.resolve(tree);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(replies.get(command.type) ?? { ok: true, id: 'atolye' });
    },
  };
};

const setup = (tree?: unknown): { readonly api: Fake; readonly store: NewProjectStore; readonly reloads: { count: number } } => {
  const api = fakeApi(tree);
  const reloads = { count: 0 };
  const store = createNewProjectStore({
    api,
    actor,
    reloadTree: () => {
      reloads.count += 1;
      return Promise.resolve();
    },
  });
  return { api, store, reloads };
};

describe('Yeni proje page', () => {
  it('U-40: "Var olan klasör" is the default card', () => {
    expect(START_FORM.mode).toBe('existing');
    expect(setup().store.state().form.mode).toBe('existing');
  });

  it('U-40: the disabled cards (Birlikte sıfırdan başla, Git\'ten klonla) are never selectable and send nothing', async () => {
    expect(DISABLED_CARDS).toEqual(['together', 'clone']);
    const cards: readonly NewProjectCard[] = ['together', 'clone'];
    for (const card of cards) {
      expect(isSelectableCard(card)).toBe(false);
      expect(pickCard(START_FORM, card)).toBe(START_FORM);
    }
    const { api, store } = setup();
    store.pickCard('blank');
    store.pickCard('together');
    store.pickCard('clone');
    expect(store.state().form.mode).toBe('blank');
    await store.submit();
    await store.attachExisting();
    expect(api.commands).toEqual([]);
  });

  it('U-40: the name is pre-filled with the folder\'s last path segment and stays editable', () => {
    expect(folderName('/Users/e/proje')).toBe('proje');
    expect(folderName('/Users/e/proje/')).toBe('proje');
    expect(folderName('C:\\work\\atolye')).toBe('atolye');
    expect(folderName('/')).toBe('');
    expect(folderName('')).toBe('');

    const typed = typePath(START_FORM, '/Users/e/atolye');
    expect(typed.name).toBe('atolye');
    // Typing on keeps following the path until the user edits the name.
    expect(typePath(typed, '/Users/e/atolye-2').name).toBe('atolye-2');
    const edited = typeName(typed, 'Benim Atölyem');
    expect(typePath(edited, '/Users/e/baska').name).toBe('Benim Atölyem');
  });

  it('U-40: the reason line names the missing input and the primary stays disabled until it is satisfied', () => {
    expect(reasonOf(START_FORM)).toBe('newProject.gate.folder');
    expect(TR['newProject.gate.folder']).toBe('Bir klasör seç.');
    const withPath = typePath(START_FORM, '/Users/e/atolye');
    expect(reasonOf(withPath)).toBeNull();
    expect(reasonOf(typeName(withPath, '   '))).toBe('newProject.gate.name');
    expect(TR['newProject.gate.name']).toBe('Projeye bir ad ver.');

    const blank = pickCard(START_FORM, 'blank');
    expect(reasonOf(blank)).toBe('newProject.gate.name');
    const named = typeName(blank, 'Yeni');
    expect(reasonOf(named)).toBe('newProject.gate.location');
    expect(reasonOf(typeParent(named, '/Users/e/work'))).toBeNull();

    expect(commandOf(START_FORM)).toBeNull();
    expect(commandOf(named)).toBeNull();
  });

  it('U-40: each mode sends its own project.create intent with the trimmed inputs', async () => {
    const existing = setup();
    existing.store.setPath(' /Users/e/atolye ');
    existing.store.setName(' Atölye ');
    await existing.store.submit();
    expect(existing.api.commands).toEqual([{ type: 'project.create', mode: 'existing', path: '/Users/e/atolye', name: 'Atölye' }]);

    const blank = setup();
    blank.store.pickCard('blank');
    blank.store.setName('Yeni');
    blank.store.setParent('/Users/e/work');
    await blank.store.submit();
    expect(blank.api.commands).toEqual([{ type: 'project.create', mode: 'blank', parent: '/Users/e/work', name: 'Yeni' }]);
  });

  it('U-40: each refusal maps to its label under the field it concerns', () => {
    const cases: readonly [code: string, mode: 'existing' | 'blank', field: string, tr: string | null][] = [
      ['invalid_name', 'existing', 'name', null],
      ['invalid_name', 'blank', 'name', null],
      ['not_a_repo', 'existing', 'path', 'Bu klasör bir git deposu değil.'],
      ['not_a_folder', 'existing', 'path', null],
      ['not_a_folder', 'blank', 'parent', null],
      ['folder_exists', 'blank', 'name', null],
      ['docket_folder_exists', 'existing', 'path', 'Bu klasörde yarım bir .docket var; elle düzelt.'],
      ['io_failed', 'existing', 'path', null],
      ['io_failed', 'blank', 'parent', null],
      ['definitions_invalid', 'existing', 'name', null],
      ['project_exists', 'existing', 'path', 'Bu klasör zaten bir Docket projesi.'],
    ];
    for (const [code, mode, field, tr] of cases) {
      const failure = failureOf(code, mode);
      expect(failure.key, code).toBe(`error.${code}`);
      expect(failure.field, `${code} in ${mode}`).toBe(field);
      expect(TR[failure.key].length).toBeGreaterThan(0);
      expect(EN[failure.key].length).toBeGreaterThan(0);
      if (tr !== null) expect(TR[failure.key]).toBe(tr);
    }
    // An unknown code never reaches the user raw.
    expect(failureOf('mystery', 'existing').key).toBe('error.unknown');
  });

  it('U-40: a refusal stays on the page and clears when the form is edited', async () => {
    const { api, store } = setup();
    api.reply('project.create', { ok: false, code: 'not_a_repo' });
    store.setPath('/Users/e/duz');
    await store.submit();
    expect(store.state().failure?.key).toBe('error.not_a_repo');
    expect(store.state().failure?.field).toBe('path');
    expect(store.state().done).toBeNull();
    expect(store.state().busy).toBe(false);
    store.setPath('/Users/e/git');
    expect(store.state().failure).toBeNull();
  });

  it('U-40: project_exists offers "Bağla", which sends project.attach for the same path', async () => {
    const { api, store } = setup();
    api.reply('project.create', { ok: false, code: 'project_exists' });
    store.setPath('/Users/e/atolye');
    await store.submit();
    expect(store.state().failure?.offerAttach).toBe(true);
    expect(TR['newProject.attach']).toBe('Bağla');

    await store.attachExisting();
    expect(api.commands[1]).toEqual({ type: 'project.attach', path: '/Users/e/atolye' });
    expect(store.state().done?.target).toEqual({ kind: 'board', repo: 'atolye' });

    // Other refusals offer nothing to attach.
    const other = setup();
    other.api.reply('project.create', { ok: false, code: 'not_a_repo' });
    other.store.setPath('/Users/e/duz');
    await other.store.submit();
    expect(other.store.state().failure?.offerAttach).toBe(false);
    await other.store.attachExisting();
    expect(other.api.commands.map((command) => command.type)).toEqual(['project.create']);
  });

  it('U-40: success reloads the tree and opens the new project\'s board with the one toast', async () => {
    const { api, store, reloads } = setup();
    store.setPath('/Users/e/atolye');
    await store.submit();
    expect(reloads.count).toBe(1);
    expect(api.queries).toEqual([{ type: 'project.tree' }]);
    expect(store.state().done).toEqual({ target: { kind: 'board', repo: 'atolye' }, toastKey: 'newProject.created' });
    expect(TR['newProject.created']).toBe("Proje oluşturuldu. Test komutlarını .docket/repo.yaml'a yaz; yazılana kadar test kapısı bekler.");

    store.reset();
    expect(store.state().done).toBeNull();
    expect(store.state().form).toEqual(START_FORM);
  });

  it('U-40: a multi-repo project opens its roadmap; an unlisted project has no target', async () => {
    const multi = [{ ...oneRepoTree[0], repos: [oneRepoTree[0].repos[0], { ...oneRepoTree[0].repos[0], repo: 'api', main: false }] }];
    const a = setup(multi);
    a.store.setPath('/Users/e/atolye');
    await a.store.submit();
    expect(a.store.state().done?.target).toEqual({ kind: 'roadmap', project: 'atolye' });

    const b = setup([]);
    b.store.setPath('/Users/e/atolye');
    await b.store.submit();
    expect(b.store.state().done?.target).toBeNull();
  });

  it('U-40: a second submit while one is in flight sends nothing more', async () => {
    const { api, store } = setup();
    store.setPath('/Users/e/atolye');
    const first = store.submit();
    const second = store.submit();
    await Promise.all([first, second]);
    expect(api.commands.length).toBe(1);
  });
});
