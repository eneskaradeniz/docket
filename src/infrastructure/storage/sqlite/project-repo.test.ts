// Project repository over SQLite: the parity suite runs the same behaviour cases against the
// in-memory fake and the SQLite adapter (I-5); the path views over the registries are tested on
// the SQLite side, where the membership join lives.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ProjectRepo } from '../../../application/index';
import { createFakeProjectRepo } from '../../../application/ports/fakes/index';
import type { ProjectDef, ProjectSlug, RepoSlug } from '../../../domain/index';
import { parseSlug } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteProjectPaths, createSqliteProjectRepo } from './project-repo';
import { createSqliteRepoRegistry } from './repo-registry';

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ATOLYE: ProjectSlug = slugOf<'project'>('atolye');
const BYPASS: ProjectSlug = slugOf<'project'>('bypass');
const MAIN: RepoSlug = slugOf<'repo'>('main');
const ACME: RepoSlug = slugOf<'repo'>('acme');

const def = (id: ProjectSlug, repos: readonly RepoSlug[] = [MAIN, ACME], main: RepoSlug = MAIN): ProjectDef => ({
  id,
  name: `Project ${id}`,
  mainRepo: main,
  repos,
  ...(id === ATOLYE ? { budget: { amountUsd: 50, warnPercent: 80 } } : {}),
});

let tmp = '';
const openDbs: DocketDb[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-project-repo-'));
});

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openMemory(): DocketDb {
  const opened = openDatabase(':memory:');
  if (!opened.ok) throw new Error('openDatabase(:memory:) must succeed');
  openDbs.push(opened.value);
  return opened.value;
}

interface Suite {
  readonly repo: ProjectRepo;
}

const suites: readonly (readonly [string, () => Suite])[] = [
  ['fake', (): Suite => ({ repo: createFakeProjectRepo() })],
  ['sqlite', (): Suite => ({ repo: createSqliteProjectRepo(openMemory()) })],
];

describe.each(suites)('project repository (%s)', (_kind, make) => {
  it('I-5: save upserts, get and list round-trip the records, and an unknown id is undefined', async () => {
    const { repo } = make();

    expect(await repo.get(ATOLYE)).toBeUndefined();

    await repo.save(def(ATOLYE));
    await repo.save(def(BYPASS, [slugOf<'repo'>('bypass-main')]));
    // A second save replaces the first: the mirror follows a project.yaml change.
    await repo.save(def(ATOLYE, [MAIN]));

    expect(await repo.get(ATOLYE)).toEqual(def(ATOLYE, [MAIN]));
    expect((await repo.list()).map((project) => project.id)).toEqual([ATOLYE, BYPASS]);
    expect(await repo.get(slugOf<'project'>('ghost'))).toBeUndefined();
  });

  it('I-5: projectOfRepo answers the owning project through membership, and undefined for outsiders', async () => {
    const { repo } = make();
    await repo.save(def(ATOLYE));

    expect((await repo.projectOfRepo(ACME))?.id).toBe(ATOLYE);
    expect((await repo.projectOfRepo(MAIN))?.id).toBe(ATOLYE);
    expect(await repo.projectOfRepo(slugOf<'repo'>('ghost'))).toBeUndefined();
  });

  it('I-5: a membership change is atomic with the def — a moved repo answers its new project', async () => {
    const { repo } = make();
    const MOVED: RepoSlug = slugOf<'repo'>('moved');
    await repo.save(def(ATOLYE, [MAIN, MOVED]));
    expect((await repo.projectOfRepo(MOVED))?.id).toBe(ATOLYE);

    // A move rewrites both projects: the old one drops the repo in the same save.
    await repo.save(def(ATOLYE, [MAIN]));
    await repo.save(def(BYPASS, [MOVED]));
    expect((await repo.projectOfRepo(MOVED))?.id).toBe(BYPASS);
  });

  it('I-6: a record read back deep-equals the record written — absent optionals stay absent', async () => {
    const { repo } = make();
    await repo.save(def(ATOLYE));
    const read = await repo.get(ATOLYE);
    expect(read).toEqual({ id: ATOLYE, name: 'Project atolye', mainRepo: MAIN, repos: [MAIN, ACME], budget: { amountUsd: 50, warnPercent: 80 } });

    await repo.save(def(BYPASS, [MAIN]));
    expect(await repo.get(BYPASS)).toEqual({ id: BYPASS, name: 'Project bypass', mainRepo: MAIN, repos: [MAIN] });
  });

  it('remove drops the project and its membership rows', async () => {
    const { repo } = make();
    await repo.save(def(ATOLYE));

    await repo.remove(ATOLYE);

    expect(await repo.get(ATOLYE)).toBeUndefined();
    expect((await repo.list())).toEqual([]);
    expect(await repo.projectOfRepo(ACME)).toBeUndefined();
  });
});

describe('createSqliteProjectPaths', () => {
  it('answers projectOf and mainRepoPath over the membership and registry tables', async () => {
    const db = openMemory();
    const projects = createSqliteProjectRepo(db);
    const registry = createSqliteRepoRegistry(db);
    const paths = createSqliteProjectPaths(db);

    await registry.register(MAIN, join(tmp, 'main'));
    await registry.register(ACME, join(tmp, 'acme'));
    await projects.save(def(ATOLYE));

    expect(await paths.projectOf(ACME)).toBe(ATOLYE);
    expect(await paths.projectOf(slugOf<'repo'>('ghost'))).toBeUndefined();
    expect(await paths.mainRepoPath(ATOLYE)).toBe(join(tmp, 'main'));
    // A project whose main repo is not registered locally has no main path.
    expect(await paths.mainRepoPath(slugOf<'project'>('ghost'))).toBeUndefined();
  });

  it('I-8: the path views survive a close and reopen on the same file', async () => {
    const file = join(tmp, 'docket.db');
    const first = openDatabase(file);
    if (!first.ok) throw new Error('open must succeed');
    await createSqliteRepoRegistry(first.value).register(MAIN, join(tmp, 'main'));
    await createSqliteProjectRepo(first.value).save(def(ATOLYE));
    first.value.close();

    const second = openDatabase(file);
    if (!second.ok) throw new Error('reopen must succeed');
    openDbs.push(second.value);
    const paths = createSqliteProjectPaths(second.value);
    expect(await paths.projectOf(ACME)).toBe(ATOLYE);
    expect(await paths.mainRepoPath(ATOLYE)).toBe(join(tmp, 'main'));
  });
});
