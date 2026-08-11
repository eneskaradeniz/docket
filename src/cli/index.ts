// src/cli/index.ts — the CLI host, a second composition root (WO-0024). Mirrors electron/main.ts minus IPC:
// builds the store + runner + pipeline (with an autoAllow policy for headless runs) and drives the pipeline
// directly. Run via `npm run cli -- <command> ...` (tsx). This is what lets the pipeline run without Electron,
// without a human at the keyboard for permission asks, and — with `--fake` — without SDK cost.
//
// Commands are primitives (`drive` / `approve-plan` / `ls` / `show`); a whole-WO run is sequenced by the caller
// (a test or shell script). The reusable, testable core lives in ./drive.ts; this file is I/O + wiring only.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRunner } from '../adapters/runner';
import { createStore } from '../adapters/store';
import { woid } from '../adapters/ids';
import { askOperatorPolicy, autoAllowPolicy, createPipeline } from '../core/pipeline';
import type { SessionRole } from '../core/types';
import { buildDriveInput, formatEvent, runDrive, type DriveFormat, type DriveOptions } from './drive';
import { createFakeRunner } from './fake-runner';

// --- tiny argv parser (no commander/yargs — a test harness, small surface) ---
function parseArgs(argv: string[]): { positional: string[]; opts: Record<string, string | true> } {
  const positional: string[] = [];
  const opts: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) opts[key] = true;
      else {
        opts[key] = next;
        i++;
      }
    } else positional.push(a);
  }
  return { positional, opts };
}

/** The Electron app's userData/docket.db, computed per-platform (the same db the GUI uses). */
function defaultDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const base =
    process.platform === 'darwin' ? join(home, 'Library', 'Application Support', 'docket')
      : process.platform === 'win32' ? join(home, 'AppData', 'Roaming', 'docket')
        : join(home, '.config', 'docket');
  return join(base, 'docket.db');
}

function roleOf(v: string | true | undefined): SessionRole | undefined {
  return typeof v === 'string' && (v === 'implementer' || v === 'architect' || v === 'verifier') ? v : undefined;
}

async function driveCommand(woIdArg: string | undefined, opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  if (!woIdArg) {
    process.stderr.write('usage: drive <woId> [--plan | --step N | --review N | --prompt TXT] [--cwd PATH] [--fake SCRIPT] [--format stream|jsonl|quiet] [--approve-plan auto]\n');
    return 2;
  }
  const woId = woid(woIdArg);
  const format: DriveFormat = opts.format === 'jsonl' || opts.format === 'quiet' ? opts.format : 'stream';
  const runner = typeof opts.fake === 'string' ? createFakeRunner(opts.fake).runner : createRunner();
  // Headless default is auto-allow (the agent is fully privileged; the fence is a tripwire, not a boundary).
  // Interactive `--policy ask` is a follow-up; for now it falls back to auto-allow with a warning.
  const permission = opts.policy === 'ask' ? askOperatorPolicy() : autoAllowPolicy();
  if (opts.policy === 'ask') process.stderr.write('note: --policy ask is not interactive yet in this build; permission asks will hang if any surfaces — prefer the default auto for headless runs.\n');
  const pipeline = createPipeline({ runner, store, permission });

  const driveOpts: DriveOptions = {
    cwd: typeof opts.cwd === 'string' ? opts.cwd : process.cwd(),
    plan: opts.plan === true,
    step: typeof opts.step === 'string' ? Number(opts.step) : undefined,
    review: typeof opts.review === 'string' ? Number(opts.review) : undefined,
    prompt: typeof opts.prompt === 'string' ? opts.prompt : undefined,
    role: roleOf(opts.role),
    resume: typeof opts.resume === 'string' ? opts.resume : undefined,
  };
  const input = await buildDriveInput(woId, driveOpts, store);
  const summary = await runDrive(input, pipeline, (ev) => {
    const line = formatEvent(ev, format);
    if (line !== undefined) process.stdout.write(line + '\n');
  });

  if (driveOpts.plan && opts['approve-plan'] === 'auto' && summary.planText) {
    await store.approvePlan(woId, summary.planText);
    if (format !== 'quiet') process.stdout.write('📋 approved plan.md (gate_plan_approved flipped)\n');
  }
  if (summary.error) {
    process.stderr.write(`✗ ${summary.error}\n`);
    return 1;
  }
  return 0;
}

async function approvePlanCommand(woIdArg: string | undefined, store: ReturnType<typeof createStore>): Promise<number> {
  if (!woIdArg) {
    process.stderr.write('usage: approve-plan <woId>\n');
    return 2;
  }
  const woId = woid(woIdArg);
  const docs = await store.getWorkOrderDocs(woId);
  if (!docs.plan) {
    process.stderr.write(`no pending plan for ${woIdArg} — run 'drive ${woIdArg} --plan' first\n`);
    return 1;
  }
  await store.approvePlan(woId, docs.plan);
  process.stdout.write(`approved plan.md for ${woIdArg} (gate_plan_approved flipped)\n`);
  return 0;
}

async function lsCommand(store: ReturnType<typeof createStore>): Promise<number> {
  const wos = await store.getWorkOrders();
  if (!wos.length) {
    process.stdout.write('(no work orders)\n');
    return 0;
  }
  for (const wo of wos) process.stdout.write(`${wo.id}\t${wo.stage}\t${wo.title}\n`);
  return 0;
}

async function showCommand(woIdArg: string | undefined, store: ReturnType<typeof createStore>): Promise<number> {
  if (!woIdArg) {
    process.stderr.write('usage: show <woId>\n');
    return 2;
  }
  const woId = woid(woIdArg);
  const wo = await store.getWorkOrder(woId);
  if (!wo) {
    process.stderr.write(`no such work order: ${woIdArg}\n`);
    return 1;
  }
  process.stdout.write(`${wo.id}  ${wo.title}  [stage ${wo.stage}]\n`);
  const steps = await store.getWorkOrderSteps(woId);
  for (const s of steps) {
    const v = s.verdict ? ` · ${s.verdict}` : '';
    process.stdout.write(`  step ${s.idx}  ${s.role}  ${s.status}${v}\n`);
  }
  return 0;
}

function help(): number {
  process.stdout.write(
    'docket CLI — drive the plan-driven pipeline headlessly (WO-0024)\n' +
      'commands:\n' +
      '  drive <woId> [--plan | --step N | --review N | --prompt TXT] [--cwd PATH] [--fake SCRIPT]\n' +
      '          [--policy auto|ask] [--format stream|jsonl|quiet] [--approve-plan auto] [--resume SID]\n' +
      '  approve-plan <woId>                      approve the pending plan\n' +
      '  ls                                       list work orders\n' +
      '  show <woId>                              show a work order + its steps\n' +
      'global: --db PATH (default the GUI app userData docket.db)\n',
  );
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { positional, opts } = parseArgs(argv);
  const cmd = positional[0];
  if (!cmd) return help();

  const dbPath = typeof opts.db === 'string' ? opts.db : defaultDbPath();
  if (!existsSync(dbPath)) {
    process.stderr.write(
      `no docket db at ${dbPath}\n` +
        `pass --db <path>, or set it to the GUI app's userData/docket.db (run the GUI once first to create it).\n`,
    );
    return 2;
  }
  const store = createStore(dbPath);

  switch (cmd) {
    case 'drive': return await driveCommand(positional[1], opts, store);
    case 'approve-plan': return await approvePlanCommand(positional[1], store);
    case 'ls': return await lsCommand(store);
    case 'show': return await showCommand(positional[1], store);
    default:
      process.stderr.write(`unknown command: ${cmd}\n`);
      return help();
  }
}

const isEntry = fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
if (isEntry) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`✗ ${String(e)}\n`);
      process.exit(1);
    });
}
