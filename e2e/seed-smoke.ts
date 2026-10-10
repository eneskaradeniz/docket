// seed-smoke.ts — the deterministic seed for the v2 smoke (`npm run test:ui`). Run by the harness
// with `npx tsx`; it prints a `SEED={json}` manifest line the harness parses.
//
// What it builds, and why each piece exists:
//   <home>/                     a throwaway tree staging everything the walk needs
//   <home>/.docket/             the launched app's data dir, handed over as DOCKET_DATA_DIR
//   <home>/.docket/docket.db    seeded through the REAL createNodeDeps + use-cases/repos, so the
//                               rows are encoded exactly the way the app writes them
//   <home>/duman-repo/          a real git repo (the run's worktree anchors to its HEAD) carrying
//                               the repo's YAML definitions under .docket/
//   <home>/bin/duman-agent      the scripted ACP agent the discovery override points at
//
// Determinism: a fixed clock plus a zero random source — the ULID generator is monotonic within
// one millisecond, so ids stay distinct and reproducible run over run.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert';
import type { AccountId, Actor, ProjectSlug, RoleSlug, RepoSlug } from '../src/domain/index';
import { deriveWorkOrderState } from '../src/domain/index';
import { attachProject } from '../src/application/use-cases/projects';
import { DISPATCH_MODE_KEY } from '../src/application/use-cases/settings';
import { openWorkOrder } from '../src/application/use-cases/work-orders';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

const here = dirname(fileURLToPath(import.meta.url));

if (process.platform === 'win32') {
  throw new Error('the smoke seed relies on POSIX paths and script shebangs');
}

const REPO = 'duman' as RepoSlug;
// Project ≡ repo: the project.yaml names the same slug as its main repo, the shape the walk's
// single-repo tree can carry.
const PROJECT = 'duman' as ProjectSlug;
const ROLE = 'isci' as RoleSlug;
const WORK_ORDER_TITLE = 'Duman testi iş emri';
// 'HESAP' (account) stays inside the ULID alphabet; the repeat keeps the id at exactly 26 chars.
const ACCOUNT_ID = ('01DUMNHESAP' + '0'.repeat(13) + 'A1') as AccountId;
// A fixed instant: every seeded timestamp and every seeded ULID's time part derive from it, so
// the database is byte-for-byte reproducible.
const FIXED_NOW = Date.UTC(2026, 0, 12, 9, 0, 0);
const OPERATOR: Actor = { kind: 'user', id: 'duman-operatoru', label: 'Duman operatörü' };

const run = (command: string, args: readonly string[], cwd: string): void => {
  execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
};

const home = mkdtempSync(join(tmpdir(), 'docket-smoke-home-'));
const dataDir = join(home, '.docket');
const repo = join(home, 'duman-repo');
mkdirSync(repo, { recursive: true });

// --- the repo with its definitions ---------------------------------------------------------
try {
  run('git', ['init', '--quiet', '--initial-branch=main'], repo);
} catch {
  // An older git without --initial-branch: whatever branch it picks still has a HEAD to anchor a
  // worktree to, which is all the run needs.
  run('git', ['init', '--quiet'], repo);
}
writeFileSync(join(repo, 'README.md'), '# duman\n\nThe smoke repo.\n');
run('git', ['-c', 'user.name=Docket Smoke', '-c', 'user.email=smoke@docket.local', 'add', '-A'], repo);
run(
  'git',
  ['-c', 'user.name=Docket Smoke', '-c', 'user.email=smoke@docket.local', 'commit', '--quiet', '-m', 'seed'],
  repo,
);

const defs = join(repo, '.docket');
mkdirSync(join(defs, 'roles'), { recursive: true });
mkdirSync(join(defs, 'flows'), { recursive: true });

// The project layer above the repo: without it no work order can open (the project is the
// membership authority between the work order and its repo).
writeFileSync(
  join(defs, 'project.yaml'),
  [
    'id: duman',
    'name: Duman projesi',
    'mainRepo: duman',
    'repos: [duman]',
    '',
  ].join('\n'),
);

// The flow the whole walk rides on: a human-only review stage (its pending gate is what surfaces
// the work order in the cockpit at boot, before any run exists), then a runnable stage whose run
// is the one that asks.
writeFileSync(
  join(defs, 'repo.yaml'),
  [
    'id: duman',
    'name: Duman çalışma alanı',
    'repos: []',
    'flows: [duman-akisi]',
    'defaultFlow: duman-akisi',
    'commandSets: {}',
    'roleOverrides: []',
    'docsRoot: docs',
    'testGlobs: []',
    '',
  ].join('\n'),
);
writeFileSync(
  join(defs, 'roles', 'isci.yaml'),
  [
    'id: isci',
    'name: İşçi',
    'instructions: Duman testini çalıştır.',
    'writeScope:',
    '  kind: repo',
    'capabilities: []',
    'active: true',
    '',
  ].join('\n'),
);
writeFileSync(
  join(defs, 'flows', 'duman-akisi.yaml'),
  [
    'id: duman-akisi',
    'name: Duman akışı',
    'stages:',
    '  - id: inceleme',
    '    name: İnceleme',
    '    role: null',
    '    exit:',
    '      - kind: human',
    '        id: onay',
    '        label: İnsan onayı',
    '  - id: uygulama',
    '    name: Uygulama',
    '    role: isci',
    '    exit: []',
    '',
  ].join('\n'),
);

// --- the database, written through the app's own composition and use-cases ---------------------------
const node = createNodeDeps({
  dataDir,
  // Cipher and transport stubs: the smoke seeds no secrets and starts no run from here — the
  // launched app brings the real ones.
  cipher: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (blob: Uint8Array) => Buffer.from(blob).toString('utf8'),
  },
  transports: { forAccount: async () => undefined },
  notifier: { notify: () => undefined },
  commandEnv: {},
  clock: { now: () => FIXED_NOW },
  random: (length: number) => new Uint8Array(length),
});
assert(node.ok, `seed could not open deps: ${JSON.stringify(node.error)}`);
const deps = node.value.deps;
// The world must not depend on the host's load: pin the fixed dispatch mode.
await deps.settings.set(DISPATCH_MODE_KEY, 'fixed');

// Attach the way the app does — the use case persists the project def, registers the main repo
// and writes the audit entry — so the rows match a real attach, not a hand-made mirror.
const attached = await attachProject(deps, { path: repo, actor: OPERATOR });
assert(attached.ok, `seed could not attach the project: ${attached.error}`);

// The account names the provider whose CLI definition the smoke impersonates: an ACP transport
// with an env-var config mechanism and no auth probe, so a scripted binary is enough.
await deps.accounts.save({
  id: ACCOUNT_ID,
  provider: 'opencode',
  label: 'Duman hesabı',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});
await deps.bindings.save({ level: 'global' }, { role: ROLE, accounts: [{ accountId: ACCOUNT_ID }] });

const opened = await openWorkOrder(
  deps,
  { project: PROJECT, repo: REPO, title: WORK_ORDER_TITLE, actor: OPERATOR },
);
assert(opened.ok, `seed could not open the work order: ${opened.error}`);
const workOrderId = opened.value;

// --- self-checks: the seed refuses to hand the harness a state the walk cannot ride ------------------
const loaded = await deps.definitions.load(REPO);
assert(loaded.ok, `definitions did not load: ${JSON.stringify(loaded.error)}`);
const flow = loaded.value.flows.find((candidate) => candidate.id === 'duman-akisi');
assert(flow !== undefined, 'the seeded flow is missing from the definitions');

const state = deriveWorkOrderState(flow, await deps.workOrders.events(workOrderId));
assert.equal(state.status, 'awaiting_human', 'the work order must wait on its human gate at boot');
assert.equal(state.stage, 'inceleme');
assert.deepEqual(state.pendingGates, ['onay']);

const binding = await deps.bindings.get({ level: 'global' }, ROLE);
assert(binding !== undefined && binding.accounts.length === 1, 'the role binding did not persist');
const account = await deps.accounts.get(ACCOUNT_ID);
assert(account !== undefined && account.provider === 'opencode', 'the account did not persist');

node.value.close();

// --- the scripted agent binary -----------------------------------------------------------------------
const agentBin = join(home, 'bin', 'duman-agent');
mkdirSync(dirname(agentBin), { recursive: true });
copyFileSync(resolve(here, 'smoke-agent.mjs'), agentBin);
chmodSync(agentBin, 0o755);

const manifest = {
  home,
  dataDir,
  repo,
  agentBin,
  workOrderId,
  accountId: ACCOUNT_ID,
  title: WORK_ORDER_TITLE,
  fixedNow: FIXED_NOW,
};
console.log(`# repo ${repo}`);
console.log(`# work order ${workOrderId}`);
console.log(`SEED=${JSON.stringify(manifest)}`);
