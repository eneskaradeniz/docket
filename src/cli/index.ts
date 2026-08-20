// src/cli/index.ts — the CLI host, a second composition root (WO-0024). Mirrors electron/main.ts minus IPC:
// builds the store + runner + pipeline (with an autoAllow policy for headless runs) and drives the pipeline
// directly. Run via `npm run cli -- <command> ...` (tsx). This is what lets the pipeline run without Electron,
// without a human at the keyboard for permission asks, and — with `--fake` — without SDK cost.
//
// Commands are primitives (`drive` / `approve-plan` / `close` / `remove-workspace` / `doctor` / `ls` /
// `show`, plus the
// bootstrap pair `create-workspace` / `create-work-order` — TD-032's first half: with them the CLI spans
// workspace → WO → drive end-to-end, GUI never opened); a whole-WO run is sequenced by the caller (a test
// or shell script). The reusable, testable cores live in ./drive.ts and ./create.ts; this file is I/O +
// wiring only — the one place outside adapters/ that brands identities (widened composition root).
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkProvider, createRunner, providerEnvForKey, quickProviderCheck } from '../adapters/runner';
import { createStore } from '../adapters/store';
import { rid, woid } from '../adapters/ids';
import { autoAllowPolicy, createPipeline } from '../core/pipeline';
import type { SessionRole } from '../core/types';
import { buildDriveInput, formatEvent, runDrive, type DriveFormat, type DriveOptions } from './drive';
import { parseCreateWorkOrderArgs, parseCreateWorkspaceArgs, resolveTracks } from './create';
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
  const usingFake = typeof opts.fake === 'string';
  if (!usingFake) {
    // Preflight (WO-0025 / B1): fail fast with guidance instead of a raw provider throw mid-drive.
    const quick = quickProviderCheck();
    if (quick === 'unknown') {
      process.stderr.write('✗ provider auth not found (no key set, no provider login) — set a key via `npm run cli -- doctor` or the GUI settings, or log in to the provider CLI.\n');
      return 2;
    }
  }
  const runner = usingFake
    ? createFakeRunner(opts.fake as string).runner
    : createRunner((await store.getProviderKey()) !== undefined ? { env: providerEnvForKey((await store.getProviderKey())!) } : {});
  // Headless default is auto (the agent is fully privileged; the fence is a tripwire, not a boundary).
  // WO-0029 / B18: cadence is per-drive now — the GUI resolves its stored setting the same way in main.
  const permission = autoAllowPolicy();
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
  // WO-0031c: --policy carries the per-drive permission rule (ask=ask_every, auto=risky_excluded default).
  if (opts.policy === 'ask') input.permissionRule = 'ask_every';
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

async function closeCommand(woIdArg: string | undefined, opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  if (!woIdArg) {
    process.stderr.write('usage: close <woId> [--note TXT]\n');
    return 2;
  }
  const note = typeof opts.note === 'string' && opts.note.trim() ? opts.note.trim() : 'closed';
  try {
    await store.closeWorkOrder(woid(woIdArg), note);
  } catch (e) {
    process.stderr.write(`✗ ${String(e)}\n`);
    return 1;
  }
  process.stdout.write(`closed ${woIdArg}: order.md ## Closure note written; merges attested; stage → closed\n`);
  return 0;
}

// WO-0032: the destructive workspace delete. `--yes` is the CLI's confirm dialog — without it the
// command refuses, naming the blast radius; with it the store cascade runs (rows + the Docket-authored
// decision-store dirs). The store's running-session guard still applies either way.
async function removeWorkspaceCommand(arg: string | undefined, opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  if (!arg) {
    process.stderr.write('usage: remove-workspace <id-or-label> [--yes]\n');
    return 2;
  }
  const workspaces = await store.getWorkspaces();
  // id (slug) first, label as the friendly spelling — the create-work-order resolution.
  const ws = workspaces.find((w) => w.id === arg) ?? workspaces.find((w) => w.label === arg);
  if (!ws) {
    const known = workspaces.map((w) => `${w.id} (${w.label})`).join(', ') || 'none yet — run create-workspace first';
    process.stderr.write(`✗ no workspace "${arg}" — known: ${known}\n`);
    return 1;
  }
  const n = (await store.getWorkOrders()).filter((w) => w.workspace === ws.id).length;
  if (opts.yes !== true) {
    process.stderr.write(`refusing: would delete workspace ${ws.id} (${ws.label}) and its ${n} work order(s) — DB rows + decision-store folders. Pass --yes to delete.\n`);
    return 2;
  }
  try {
    await store.deleteWorkspace(ws.id);
  } catch (e) {
    process.stderr.write(`✗ ${String(e)}\n`);
    return 1;
  }
  process.stdout.write(`deleted workspace ${ws.id} (${ws.label}) — ${n} work order(s) cascaded (rows + decision-store folders)\n`);
  return 0;
}

// --- bootstrap commands (WO-0024 / TD-032): the mappers in ./create.ts shape argv (pure); these
//     handlers own the store + identity side — branding (rid) and the data-dependent resolutions the
//     mappers can't do: --workspace by id then label, --track slugs against the workspace's repos. ---

async function createWorkspaceCommand(argv: string[], store: ReturnType<typeof createStore>): Promise<number> {
  const parsed = parseCreateWorkspaceArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`✗ ${parsed.error}\nusage: create-workspace --label <text> --repo <path> [--repo <path>]... [--decision-store <path>]\n`);
    return 2;
  }
  let ws;
  try {
    ws = await store.createWorkspace(parsed.input);
  } catch (e) {
    process.stderr.write(`✗ ${String(e)}\n`);
    return 1;
  }
  process.stdout.write(`created workspace ${ws.id} "${ws.label}" — repos: ${ws.repos.join(', ')}; decision store: ${ws.decisionStore}\n`);
  return 0;
}

async function createWorkOrderCommand(argv: string[], store: ReturnType<typeof createStore>): Promise<number> {
  const parsed = parseCreateWorkOrderArgs(argv);
  if (!parsed.ok) {
    process.stderr.write(`✗ ${parsed.error}\nusage: create-work-order --workspace <id-or-label> --title <text> [--description <text>] [--track <repo-slug>]... [--review-mode gates|every-step]\n`);
    return 2;
  }
  const draft = parsed.input;
  const workspaces = await store.getWorkspaces();
  // --workspace accepts the id (slug) or the label — exact id first, label as the friendly spelling.
  const ws = workspaces.find((w) => w.id === draft.workspace) ?? workspaces.find((w) => w.label === draft.workspace);
  if (!ws) {
    const known = workspaces.map((w) => `${w.id} (${w.label})`).join(', ') || 'none yet — run create-workspace first';
    process.stderr.write(`✗ no workspace "${draft.workspace}" — known: ${known}\n`);
    return 1;
  }
  const tracks = resolveTracks(ws.repos, ws.decisionStore, draft.tracks);
  if (!tracks.ok) {
    process.stderr.write(`✗ ${tracks.error}\n`);
    return 1;
  }
  try {
    const wo = await store.createWorkOrder({
      workspaceId: ws.id,
      title: draft.title,
      description: draft.description,
      trackRepos: tracks.tracks.map((t) => rid(t)),
      reviewMode: draft.reviewMode,
      contextFiles: draft.contextFiles,
    });
    process.stdout.write(`created ${wo.id} "${wo.title}" — workspace ${ws.id}; tracks: ${tracks.tracks.join(', ')}; review: ${draft.reviewMode}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`✗ ${String(e)}\n`);
    return 1;
  }
}

async function doctorCommand(opts: Record<string, string | true>, dbPath: string, store: ReturnType<typeof createStore> | undefined): Promise<number> {
  process.stdout.write(`db: ${dbPath}${store ? '' : ' (NOT FOUND — GUI once, or --db)'}\n`);
  const quick = quickProviderCheck();
  process.stdout.write(`provider (quick): ${quick}\n`);
  if (opts.verify === true || opts.verify === 'true') {
    const key = store ? await store.getProviderKey() : undefined;
    const full = await checkProvider(key !== undefined ? providerEnvForKey(key) : undefined);
    process.stdout.write(full.ok ? `provider (full handshake): ok (${full.source}) — zero tokens spent\n` : `provider (full handshake): FAILED (${full.code}) — ${full.message}\n`);
    return full.ok ? 0 : 1;
  }
  return quick === 'unknown' ? 1 : 0;
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

const HELP_TEXT =
  'docket CLI — drive the plan-driven pipeline headlessly (WO-0024)\n' +
  'commands:\n' +
  '  create-workspace --label L --repo PATH [--repo PATH]... [--decision-store PATH]\n' +
  '          create a workspace (a fresh --db works: the file is created + migrated)\n' +
  '  create-work-order --workspace W --title T [--description D] [--track SLUG]...\n' +
  '          [--review-mode gates|every-step]\n' +
  '          author a work order into the workspace decision store (W = id or label;\n' +
  '          tracks default to all code repos — the decision store excluded)\n' +
  '  drive <woId> [--plan | --step N | --review N | --prompt TXT] [--cwd PATH] [--fake SCRIPT]\n' +
  '          [--policy auto|ask] [--format stream|jsonl|quiet] [--approve-plan auto] [--resume SID]\n' +
  '  approve-plan <woId>                      approve the pending plan\n' +
  '  close <woId> [--note TXT]                close a finished WO (attested; stage → closed)\n' +
  '  remove-workspace <id-or-label> [--yes]   delete a workspace + its WOs (refuses without --yes)\n' +
  '  doctor [--verify]                        db + provider readiness (full handshake with --verify)\n' +
  '  ls                                       list work orders\n' +
  '  show <woId>                              show a work order + its steps\n' +
  'global: --db PATH (default the GUI app userData docket.db)\n';

function help(): number {
  process.stdout.write(HELP_TEXT);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { positional, opts } = parseArgs(argv);
  const cmd = positional[0];
  if (!cmd) return help();

  const dbPath = typeof opts.db === 'string' ? opts.db : defaultDbPath();
  // A `--fake` run is deterministic/testing traffic — it must NOT write the operator's real (GUI) db unless
  // the operator explicitly aims it there with --db. The default path IS the GUI's db, so refuse instead.
  if (typeof opts.fake === 'string' && typeof opts.db !== 'string' && dbPath === defaultDbPath()) {
    process.stderr.write(
      'refusing to run --fake against the default (GUI) db — pass an explicit --db <path> (e.g. a scratch db)\n',
    );
    return 2;
  }
  // `create-workspace` bootstraps a db as easily as it bootstraps a workspace: createStore creates +
  // migrates a fresh file, so a not-yet-existing --db is exactly the headless starting point (TD-032).
  if (!existsSync(dbPath) && cmd !== 'doctor' && cmd !== 'create-workspace') {
    process.stderr.write(
      `no docket db at ${dbPath}\n` +
        `pass --db <path>, or set it to the GUI app's userData/docket.db (run the GUI once first to create it).\n`,
    );
    return 2;
  }
  const store = cmd === 'create-workspace' || existsSync(dbPath) ? createStore(dbPath) : undefined;
  if (!store) {
    if (cmd === 'doctor') return await doctorCommand(opts, dbPath, undefined);
    return 2; // unreachable (guarded above) — kept for type completeness
  }

  switch (cmd) {
    case 'create-workspace': return await createWorkspaceCommand(argv, store!);
    case 'create-work-order': return await createWorkOrderCommand(argv, store!);
    case 'drive': return await driveCommand(positional[1], opts, store!);
    case 'approve-plan': return await approvePlanCommand(positional[1], store!);
    case 'close': return await closeCommand(positional[1], opts, store!);
    case 'remove-workspace': return await removeWorkspaceCommand(positional[1], opts, store!);
    case 'doctor': return await doctorCommand(opts, dbPath, store);
    case 'ls': return await lsCommand(store!);
    case 'show': return await showCommand(positional[1], store!);
    case 'help': return help();
    default:
      // An unknown command is a usage error: say so on stderr, show the usage, exit non-zero (WO item 3).
      process.stderr.write(`unknown command: ${cmd}\n\n${HELP_TEXT}`);
      return 2;
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
