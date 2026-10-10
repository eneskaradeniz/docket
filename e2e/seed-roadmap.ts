// seed-roadmap.ts — the roadmap world (J-10): a throwaway data dir holding one project, two real
// git repos and a four-phase roadmap that shows every run-control state of the page — a done
// phase, a paused phase with an attention work order, a phase blocked by it, and a planned phase
// with two runnable tasks. Run with `npx tsx e2e/seed-roadmap.ts <home>`; it prints a
// `SEED={json}` line (dataDir, project name, the attention work order's code and task title).
//
// Hermetic by construction: no account exists in this world, so the launched app has nothing to
// run an agent on — pressing Başlat opens work orders that cannot queue (the page then shows the
// warn toast too), and no secret is stored anywhere. The seed writes through the app's own
// composition (createNodeDeps) and use-cases, like the design seed; the only direct port writes
// are the facts no use-case produces at seed time: the finished run events of the done task and
// the paused phase's autoRun record.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import assert from 'node:assert';
import { stringify } from 'yaml';

import type { Actor, GateSlug, PhaseSlug, ProjectSlug, RepoSlug, StageSlug, TaskSlug } from '../src/domain/index';
import { decideHumanGate } from '../src/application/use-cases/gates';
import { attachProject } from '../src/application/use-cases/projects';
import { openWorkOrder } from '../src/application/use-cases/work-orders';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

const OPERATOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const [home] = process.argv.slice(2);
assert(home !== undefined, 'usage: seed-roadmap.ts <home>');

const MINUTE = 60_000;
// Three hours before the real clock at seed time: work-order numbers rank by creation time, so
// every seeded order must sort before the ones the app opens later, on any day the seed runs.
const NOW = Date.now() - 3 * 60 * MINUTE;
let clockNow = NOW - 60 * MINUTE;

const PROJECT = { id: 'atolye', name: 'Atölye', main: 'atolye-api', repos: ['atolye-api', 'atolye-web'] } as const;
const FLOW_ID = 'tek-asama';
const STAGE = 'is';
const ROLE = 'gelistirici';
const GATE = 'onay';

const dataDir = join(home, '.docket');
mkdirSync(dataDir, { recursive: true });
const repoPath = (slug: string): string => join(home, 'repos', slug);

const run = (command: string, args: readonly string[], cwd: string): void => {
  execFileSync(command, [...args], { cwd, stdio: 'ignore' });
};
const IDENTITY = ['-c', 'user.name=Seed', '-c', 'user.email=seed@example.invalid'];

const writeYaml = (dir: string, relative: string, value: unknown): void => {
  const target = join(dir, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stringify(value));
};

// --- the roadmap ----------------------------------------------------------------------------------
const task = (id: string, title: string, targets: readonly string[]) => ({
  id,
  title,
  dependsOn: [],
  acceptance: [`${title} tamamlandı`],
  targets,
});
const ROADMAP = {
  phases: [
    { id: 'temel', name: 'Temel altyapı', blockedBy: [], tasks: [task('iskelet', 'Depo iskeleti', ['atolye-api'])] },
    { id: 'odeme', name: 'Ödeme akışı', blockedBy: [], tasks: [task('odeme-modeli', 'Ödeme modeli', ['atolye-api']), task('makbuz', 'Makbuz e-postası', ['atolye-api'])] },
    { id: 'bildirim', name: 'Bildirimler', blockedBy: ['odeme'], tasks: [task('tercihler', 'Bildirim tercihleri', ['atolye-api'])] },
    {
      id: 'yayin',
      name: 'Yayın hazırlığı',
      blockedBy: ['temel'],
      tasks: [task('yuk-testi', 'Yük testi', ['atolye-api', 'atolye-web']), task('surum-notlari', 'Sürüm notları', ['atolye-api'])],
    },
  ],
};

for (const slug of PROJECT.repos) {
  const dir = repoPath(slug);
  mkdirSync(dir, { recursive: true });
  try {
    run('git', ['init', '--quiet', '--initial-branch=main'], dir);
  } catch {
    run('git', ['init', '--quiet'], dir);
  }
  writeFileSync(join(dir, 'README.md'), `# ${slug}\n`);
  writeYaml(dir, '.docket/repo.yaml', {
    id: slug,
    name: slug,
    flows: [FLOW_ID],
    defaultFlow: FLOW_ID,
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  });
  writeYaml(dir, `.docket/flows/${FLOW_ID}.yaml`, {
    id: FLOW_ID,
    name: 'Tek aşamalı akış',
    stages: [{ id: STAGE, name: 'İş', role: ROLE, exit: [{ kind: 'human', id: GATE, label: 'Onay' }] }],
  });
  writeYaml(dir, `.docket/roles/${ROLE}.yaml`, {
    id: ROLE,
    name: ROLE,
    instructions: 'İş emrini yürüt.',
    writeScope: { kind: 'repo' },
    capabilities: [],
    active: true,
  });
  if (slug === PROJECT.main) {
    writeYaml(dir, '.docket/project.yaml', { id: PROJECT.id, name: PROJECT.name, mainRepo: PROJECT.main, repos: PROJECT.repos });
    writeYaml(dir, '.docket/roadmap.yaml', ROADMAP);
  }
  run('git', [...IDENTITY, 'add', '-A'], dir);
  run('git', [...IDENTITY, 'commit', '--quiet', '-m', 'seed'], dir);
}

// --- the database, through the app's own composition ------------------------------------------------
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
  clock: { now: () => clockNow },
  random: (length: number) => new Uint8Array(length),
});
if (!node.ok) throw new Error(`roadmap seed could not open deps: ${JSON.stringify(node.error)}`);
const deps = node.value.deps;

const attached = await attachProject(deps, {
  path: repoPath(PROJECT.main),
  actor: OPERATOR,
  repos: [{ repo: 'atolye-web' as RepoSlug, path: repoPath('atolye-web') }],
});
assert(attached.ok, `project did not attach: ${attached.ok ? '' : attached.error}`);

const open = async (title: string, taskId: string): Promise<ReturnType<typeof deps.ids.next<'work-order'>>> => {
  clockNow += MINUTE;
  const opened = await openWorkOrder(deps, {
    project: PROJECT.id as ProjectSlug,
    repo: PROJECT.main as RepoSlug,
    title,
    task: taskId as TaskSlug,
    actor: OPERATOR,
  });
  assert(opened.ok, `${title} did not open: ${opened.ok ? '' : opened.error}`);
  return opened.value;
};

// The done phase: its one task's work order runs its only stage and passes the human gate. The
// run id is minted but no run row is written — the roadmap's status reads the work order's events.
const finished = await open('Depo iskeleti', 'iskelet');
const runId = deps.ids.next<'run'>();
clockNow += MINUTE;
await deps.workOrders.appendEvent(finished, { type: 'run_started', at: clockNow, runId, stage: STAGE as StageSlug, attempt: 1 });
clockNow += MINUTE;
await deps.workOrders.appendEvent(finished, { type: 'run_finished', at: clockNow, runId, outcome: 'succeeded' });
clockNow += MINUTE;
const decided = await decideHumanGate(deps, { id: finished, gate: GATE as GateSlug, decision: 'approved', actor: OPERATOR });
assert(decided.ok, `the gate did not pass: ${decided.ok ? '' : decided.error}`);

// The paused phase: an open work order of its first task is the one that needs attention. The
// record is `paused`, so the dispatcher tick's advance leaves it (and its attention list) alone.
const flagged = await open('Ödeme modeli', 'odeme-modeli');
await deps.phaseAutoRuns.put({
  project: PROJECT.id as ProjectSlug,
  phase: 'odeme' as PhaseSlug,
  state: 'paused',
  startedAt: NOW - 30 * MINUTE,
  attention: [flagged],
});
const number = await deps.workOrders.number(flagged);
assert(number !== undefined, 'the flagged work order did not number');

console.log(`SEED=${JSON.stringify({ home, dataDir, project: PROJECT.name, flaggedNumber: number, flaggedTask: 'Ödeme modeli' })}`);
