// Parity (I-5), round-trip (I-6) and durability (I-8) tests for the SQLite binding repository.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BindingRepo, BindingScope } from '../../../application/index';
import { createFakeBindingRepo } from '../../../application/ports/fakes/index';
import { parseSlug, parseUlid, type AccountId, type RoleBinding, type WorkOrderId, type WorkspaceSlug } from '../../../domain/index';

import { createSqliteBindingRepo } from './binding-repo';
import { openDatabase, type DocketDb } from './database';

const A1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const A2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const A3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const W1 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

const accountId = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const workOrderId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const WS: WorkspaceSlug = slugOf<'workspace'>('acme');
const OTHER_WS: WorkspaceSlug = slugOf<'workspace'>('other');
const ROLE = slugOf<'role'>('implementer');
const REVIEWER = slugOf<'role'>('reviewer');

const GLOBAL: BindingScope = { level: 'global' };
const WORKSPACE: BindingScope = { level: 'workspace', workspace: WS };
const OTHER_WORKSPACE: BindingScope = { level: 'workspace', workspace: OTHER_WS };
const WORK_ORDER: BindingScope = { level: 'workOrder', workOrderId: workOrderId(W1) };

// An absent model must stay absent (I-6), so the key is omitted rather than set to undefined.
const routeFor = (account: string, model?: string): RoleBinding => ({
  role: ROLE,
  accounts: [model === undefined ? { accountId: accountId(account) } : { accountId: accountId(account), model }],
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-binding-'));
  openHandles = [];
});

afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openDb(path: string): DocketDb {
  const result = openDatabase(path);
  if (!result.ok) throw new Error(`expected openDatabase(${path}) to succeed`);
  openHandles.push(result.value);
  return result.value;
}

function closeDb(db: DocketDb): void {
  db.close();
  const index = openHandles.indexOf(db);
  if (index >= 0) openHandles.splice(index, 1);
}

describe('createSqliteBindingRepo', () => {
  describe.each([
    ['fake', (): BindingRepo => createFakeBindingRepo()],
    ['sqlite', (): BindingRepo => createSqliteBindingRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-5: save and get round-trip a binding; an unsaved scope or role is undefined', async () => {
      const repo = makeRepo();
      const saved = routeFor(A1);
      await repo.save(WORKSPACE, saved);

      expect(await repo.get(WORKSPACE, ROLE)).toStrictEqual(saved);
      expect(await repo.get(GLOBAL, ROLE)).toBeUndefined();
      expect(await repo.get(WORKSPACE, REVIEWER)).toBeUndefined();
    });

    it('I-5: the scope levels stay independent for the same role', async () => {
      const repo = makeRepo();
      const global = routeFor(A1);
      const workspace = routeFor(A2);
      const otherWorkspace = routeFor(A3, 'sonar-mini');
      const workOrder = routeFor(A1, 'atlas-max');
      await repo.save(GLOBAL, global);
      await repo.save(WORKSPACE, workspace);
      await repo.save(OTHER_WORKSPACE, otherWorkspace);
      await repo.save(WORK_ORDER, workOrder);

      expect(await repo.get(GLOBAL, ROLE)).toStrictEqual(global);
      expect(await repo.get(WORKSPACE, ROLE)).toStrictEqual(workspace);
      expect(await repo.get(OTHER_WORKSPACE, ROLE)).toStrictEqual(otherWorkspace);
      expect(await repo.get(WORK_ORDER, ROLE)).toStrictEqual(workOrder);
    });

    it('I-5: saving the same scope and role again replaces the binding', async () => {
      const repo = makeRepo();
      await repo.save(GLOBAL, routeFor(A1));
      const replacement = routeFor(A2);
      await repo.save(GLOBAL, replacement);

      expect(await repo.get(GLOBAL, ROLE)).toStrictEqual(replacement);
    });

    it('I-5: different roles under the same scope do not collide', async () => {
      const repo = makeRepo();
      const forImplementer = routeFor(A1);
      const forReviewer: RoleBinding = { role: REVIEWER, accounts: [{ accountId: accountId(A2) }] };
      await repo.save(WORKSPACE, forImplementer);
      await repo.save(WORKSPACE, forReviewer);

      expect(await repo.get(WORKSPACE, ROLE)).toStrictEqual(forImplementer);
      expect(await repo.get(WORKSPACE, REVIEWER)).toStrictEqual(forReviewer);
    });

    it('I-6: a binding read back deep-equals the binding written — the account chain keeps its order and models', async () => {
      const repo = makeRepo();
      const chain: RoleBinding = {
        role: ROLE,
        accounts: [
          { accountId: accountId(A1) },
          { accountId: accountId(A2), model: 'sonar-mini' },
          { accountId: accountId(A3), model: 'atlas-max' },
        ],
      };
      await repo.save(WORK_ORDER, chain);
      expect(await repo.get(WORK_ORDER, ROLE)).toStrictEqual(chain);
    });

    it('I-5: listAll enumerates every saved scope and role with its scope, in save order', async () => {
      const repo = makeRepo();
      const global = routeFor(A1);
      const workspace = routeFor(A2);
      const workOrder = routeFor(A3, 'sonar-mini');
      await repo.save(GLOBAL, global);
      await repo.save(WORKSPACE, workspace);
      await repo.save(WORK_ORDER, workOrder);

      expect(await repo.listAll()).toEqual([
        { scope: GLOBAL, binding: global },
        { scope: WORKSPACE, binding: workspace },
        { scope: WORK_ORDER, binding: workOrder },
      ]);
    });

    it('I-5: listAll keeps one entry per scope and role; a replacement updates it in place', async () => {
      const repo = makeRepo();
      await repo.save(GLOBAL, routeFor(A1));
      await repo.save(OTHER_WORKSPACE, routeFor(A2));
      const replacement = routeFor(A3);
      await repo.save(GLOBAL, replacement);

      const all = await repo.listAll();
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual({ scope: GLOBAL, binding: replacement });
      expect(all[1]).toEqual({ scope: OTHER_WORKSPACE, binding: routeFor(A2) });
    });

    it('I-5: listAll returns nothing when no binding was saved', async () => {
      const repo = makeRepo();

      expect(await repo.listAll()).toEqual([]);
    });
  });

  describe('sqlite on a file', () => {
    it('I-8: bindings survive a close and reopen on the same file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqliteBindingRepo(first);
      const global = routeFor(A1);
      const workspace = routeFor(A2);
      const workOrder = routeFor(A3, 'sonar-mini');
      await repo.save(GLOBAL, global);
      await repo.save(WORKSPACE, workspace);
      await repo.save(WORK_ORDER, workOrder);
      closeDb(first);

      const second = openDb(path);
      const reopened = createSqliteBindingRepo(second);
      expect(await reopened.get(GLOBAL, ROLE)).toStrictEqual(global);
      expect(await reopened.get(WORKSPACE, ROLE)).toStrictEqual(workspace);
      expect(await reopened.get(WORK_ORDER, ROLE)).toStrictEqual(workOrder);
      expect(await reopened.listAll()).toEqual([
        { scope: GLOBAL, binding: global },
        { scope: WORKSPACE, binding: workspace },
        { scope: WORK_ORDER, binding: workOrder },
      ]);
    });
  });
});
