// seed-wizard.ts — the wizard world: a throwaway data dir that holds exactly two adopted
// accounts and nothing else — no project, which is the wizard's own precondition. Each account's
// identityDir points at a fixture config directory the caller created, so the launched app's
// capability scan (I-42) reads fixture files, never the operator's own. Run with
// `npx tsx e2e/seed-wizard.ts <dataDir> <dirA> <dirB>`; prints a `SEED={json}` line carrying the
// data dir and the two account ids, the same shape seed-design.ts prints for the harness.
import { mkdirSync } from 'node:fs';

import assert from 'node:assert';

import type { AccountId, Actor } from '../src/domain/index';
import type { AccountRecord } from '../src/application/index';
import { saveAccount } from '../src/application/use-cases/accounts';
import { DISPATCH_MODE_KEY } from '../src/application/use-cases/settings';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

const OPERATOR: Actor = { kind: 'user', id: 'user-1' };

const [dataDir, dirA, dirB] = process.argv.slice(2);
assert(dataDir !== undefined && dirA !== undefined && dirB !== undefined, 'usage: seed-wizard.ts <dataDir> <dirA> <dirB>');
mkdirSync(dataDir, { recursive: true });

// The database through the app's own composition (createNodeDeps) and use-cases, like the design
// seed: cipher and transport stubs — the wizard world stores no secrets and starts no run.
const node = createNodeDeps({
  dataDir,
  cipher: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (blob: Uint8Array) => Buffer.from(blob).toString('utf8'),
  },
  transports: { forAccount: async () => undefined },
  notifier: { notify: () => undefined },
  commandEnv: {},
  clock: { now: () => 1_700_000_000_000 },
  random: (length: number) => new Uint8Array(length),
});
if (!node.ok) throw new Error(`wizard seed could not open deps: ${JSON.stringify(node.error)}`);
const deps = node.value.deps;
// The world must not depend on the host's load: pin the fixed dispatch mode.
await deps.settings.set(DISPATCH_MODE_KEY, 'fixed');

// Two claude-code subscriptions whose identity directories are the fixtures: the capability scan
// has rows for that provider only (I-42), and identityDir is a subscription-route field (A-43).
const accounts: { id: AccountId; label: string }[] = [];
for (const [identityDir, label] of [
  [dirA, 'Kişisel'],
  [dirB, 'İş'],
] as const) {
  const id = deps.ids.next<'account'>();
  const record: AccountRecord = {
    id,
    provider: 'claude-code',
    label,
    authMode: 'subscription',
    limitPolicy: 'wait_resume',
    caps: [],
    identityDir,
  };
  const saved = await saveAccount(deps, { record, actor: OPERATOR });
  assert(saved.ok, `account ${label} did not save`);
  accounts.push({ id, label });
}

console.log(`SEED=${JSON.stringify({ dataDir, accounts })}`);
