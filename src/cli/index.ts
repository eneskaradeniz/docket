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
import { formatRoadmapDraftLine, formatRoadmapShow, formatRoadmapValidate, resolveTaskRef } from './roadmap';
import type { DraftDriveInput } from '../core/runner';
import { roadmapDiagnostics } from '../core/roadmap-md';
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
  // WO-0048: --task must name a task of the workspace's roadmap — refused (never silently dropped)
  // when unknown, listing the valid ids; an absent/unparsable roadmap fails closed.
  let taskRef: string | undefined;
  if (draft.task !== undefined) {
    const res = resolveTaskRef(await store.getRoadmapMd(ws.id), draft.task);
    if (!res.ok) {
      process.stderr.write(`✗ ${res.error}\n`);
      return 1;
    }
    taskRef = draft.task;
  }
  try {
    const wo = await store.createWorkOrder({
      workspaceId: ws.id,
      title: draft.title,
      description: draft.description,
      trackRepos: tracks.tracks.map((t) => rid(t)),
      reviewMode: draft.reviewMode,
      contextFiles: draft.contextFiles,
      ...(taskRef !== undefined ? { taskRef } : {}),
    });
    process.stdout.write(`created ${wo.id} "${wo.title}" — workspace ${ws.id}; tracks: ${tracks.tracks.join(', ')}; review: ${draft.reviewMode}${taskRef ? `; task: ${taskRef}` : ''}\n`);
    return 0;
  } catch (e) {
    process.stderr.write(`✗ ${String(e)}\n`);
    return 1;
  }
}

// WO-0048 — `roadmap show|validate --workspace W`: the spine, verifiable without GUI. show is a
// VIEW (exit 0 for absent/invalid — it prints the surface); validate is the gate (exit 1 on any
// error diagnostic, the doctorCommand posture). An absent roadmap validates clean: the invitation
// state is legitimate, not broken. WO-0050 adds the DRAFT pair: `draft` drives the WO-less
// architect session (ONE mechanism — --docs is the only import/generate distinction, paths into
// the prompt, never contents), `approve` is Onayla (the parse-guarded write; commit stays the
// operator's).
async function roadmapCommand(sub: string | undefined, opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  if (sub === 'draft') return await roadmapDraftCommand(opts, store);
  if (sub === 'approve') return await roadmapApproveCommand(opts, store);
  if (sub !== 'show' && sub !== 'validate') {
    process.stderr.write('usage: roadmap <show|validate|draft|approve> --workspace <id-or-label>\n');
    return 2;
  }
  const arg = typeof opts.workspace === 'string' ? opts.workspace : undefined;
  if (!arg) {
    process.stderr.write('✗ missing required --workspace <id-or-label>\n');
    return 2;
  }
  const workspaces = await store.getWorkspaces();
  const ws = workspaces.find((w) => w.id === arg) ?? workspaces.find((w) => w.label === arg);
  if (!ws) {
    const known = workspaces.map((w) => `${w.id} (${w.label})`).join(', ') || 'none yet — run create-workspace first';
    process.stderr.write(`✗ no workspace "${arg}" — known: ${known}\n`);
    return 1;
  }
  if (sub === 'show') {
    process.stdout.write(formatRoadmapShow(await store.getRoadmap(ws.id)) + '\n');
    return 0;
  }
  const md = await store.getRoadmapMd(ws.id);
  const diags = md === '' ? ('absent' as const) : roadmapDiagnostics(md, { workspaceSlug: ws.id, knownRepos: ws.repos.map((r) => r as string) });
  const out = formatRoadmapValidate(diags);
  process.stdout.write(out.text + '\n');
  return out.exitCode;
}

// The workspace arg every roadmap subcommand shares: id (slug) first, label as the friendly spelling.
async function resolveWorkspaceArg(arg: string | undefined, store: ReturnType<typeof createStore>): Promise<{ ws: Awaited<ReturnType<typeof store.getWorkspaces>>[number] } | { error: number }> {
  if (!arg) {
    process.stderr.write('✗ missing required --workspace <id-or-label>\n');
    return { error: 2 };
  }
  const workspaces = await store.getWorkspaces();
  const ws = workspaces.find((w) => w.id === arg) ?? workspaces.find((w) => w.label === arg);
  if (!ws) {
    const known = workspaces.map((w) => `${w.id} (${w.label})`).join(', ') || 'none yet — run create-workspace first';
    process.stderr.write(`✗ no workspace "${arg}" — known: ${known}\n`);
    return { error: 1 };
  }
  return { ws };
}

// WO-0050 — `roadmap draft --workspace W --note TXT [--docs a,b,c] [--explore] [--fake SCRIPT]`: drive the
// WO-less architect plan session headlessly. Prompt assembly, the budget gate, and the plan_ready →
// roadmap_draft write all happen INSIDE the pipeline (the same store-side path as the GUI — one
// mechanism, one implementation); this command only collects the operator's input and streams.
// WO-0051: --explore is the serbest keşif opt-in; the DEPO scan is a GUI affordance (explicit
// paths are the terminal's native channel).
async function roadmapDraftCommand(opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  const resolved = await resolveWorkspaceArg(typeof opts.workspace === 'string' ? opts.workspace : undefined, store);
  if ('error' in resolved) return resolved.error;
  const ws = resolved.ws;
  const note = typeof opts.note === 'string' ? opts.note.trim() : '';
  if (!note) {
    process.stderr.write('usage: roadmap draft --workspace <id-or-label> --note <TXT> [--docs <a,b,c>] [--explore] [--fake SCRIPT] [--format stream|jsonl|quiet]\n');
    return 2;
  }
  const docPaths = typeof opts.docs === 'string' && opts.docs.trim() ? opts.docs.split(',').map((d) => d.trim()).filter(Boolean) : [];
  // WO-0051 / D1: the serbest keşif opt-in (--explore → the prompt's ONE exploration sentence).
  // The DEPO scan stays a GUI affordance — the terminal's paths are explicit by construction.
  const freeExplore = opts.explore === true;
  const format: DriveFormat = opts.format === 'jsonl' || opts.format === 'quiet' ? opts.format : 'stream';
  const usingFake = typeof opts.fake === 'string';
  if (!usingFake) {
    const quick = quickProviderCheck();
    if (quick === 'unknown') {
      process.stderr.write('✗ provider auth not found (no key set, no provider login) — set a key via `npm run cli -- doctor` or the GUI settings, or log in to the provider CLI.\n');
      return 2;
    }
  }
  const runner = usingFake
    ? createFakeRunner(opts.fake as string).runner
    : createRunner((await store.getProviderKey()) !== undefined ? { env: providerEnvForKey((await store.getProviderKey())!) } : {});
  const pipeline = createPipeline({ runner, store, permission: autoAllowPolicy() });
  const input: DraftDriveInput = {
    role: 'architect',
    workspaceId: ws.id,
    mode: 'plan',
    prompt: '',
    goalNote: note,
    docPaths,
    freeExplore: freeExplore ? true : undefined,
    cwd: typeof opts.cwd === 'string' ? opts.cwd : process.cwd(),
  };
  const summary = await runDrive(input, pipeline, (ev) => {
    const line = formatEvent(ev, format);
    if (line !== undefined) process.stdout.write(line + '\n');
  });
  if (summary.error) {
    process.stderr.write(`✗ ${summary.error}\n`);
    return 1;
  }
  if (format !== 'quiet') {
    const draft = await store.getRoadmapDraft(ws.id);
    process.stdout.write(
      draft
        ? `draft pending — ${formatRoadmapDraftLine(draft.md)}\nrun: roadmap approve --workspace ${ws.id}\n`
        : 'draft session ended without a proposal — no pending row was written\n',
    );
  }
  return 0;
}

// WO-0050 — `roadmap approve --workspace W`: Onayla from the terminal. The parse-guard lives in the
// store (approveRoadmapDraft is the atomic decision: refuse-and-name, or write + re-read +
// clear). The commit stays the operator's.
async function roadmapApproveCommand(opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  const resolved = await resolveWorkspaceArg(typeof opts.workspace === 'string' ? opts.workspace : undefined, store);
  if ('error' in resolved) return resolved.error;
  const ws = resolved.ws;
  const draft = await store.getRoadmapDraft(ws.id);
  if (!draft) {
    process.stderr.write(`no pending draft for ${ws.id} — run 'roadmap draft --workspace ${ws.id} --note ...' first\n`);
    return 1;
  }
  try {
    await store.approveRoadmapDraft(ws.id);
  } catch (e) {
    process.stderr.write(`✗ ${String(e)}\n`);
    return 1;
  }
  const md = await store.getRoadmapMd(ws.id);
  process.stdout.write(`draft approved — ${formatRoadmapDraftLine(md)} — written to roadmap.md\nthe git commit is yours.\n`);
  return 0;
}

// WO-0048 — `docs-root --workspace W [--root DIR] [--clear]`: the structure-root switch, no GUI
// needed. Docket NEVER moves files and NEVER writes .gitignore (ADR-0016) — the command says so at
// every change, because the failure mode (an empty new root) silently restarts WO numbering.
async function docsRootCommand(opts: Record<string, string | true>, store: ReturnType<typeof createStore>): Promise<number> {
  const arg = typeof opts.workspace === 'string' ? opts.workspace : undefined;
  if (!arg) {
    process.stderr.write('usage: docs-root --workspace <id-or-label> [--root <dir>] [--clear]\n');
    return 2;
  }
  if (opts.root !== undefined && opts.clear === true) {
    process.stderr.write('✗ pass either --root <dir> or --clear, not both\n');
    return 2;
  }
  const workspaces = await store.getWorkspaces();
  const ws = workspaces.find((w) => w.id === arg) ?? workspaces.find((w) => w.label === arg);
  if (!ws) {
    const known = workspaces.map((w) => `${w.id} (${w.label})`).join(', ') || 'none yet — run create-workspace first';
    process.stderr.write(`✗ no workspace "${arg}" — known: ${known}\n`);
    return 1;
  }
  try {
    if (opts.clear === true) {
      await store.setDocsRoot(ws.id, undefined);
      process.stdout.write(`structure root: docs (cleared — the default)\n`);
      return 0;
    }
    if (typeof opts.root === 'string') {
      await store.setDocsRoot(ws.id, opts.root);
      process.stdout.write(
        `structure root: ${await store.getDocsRoot(ws.id)} — documents DO NOT move; WO numbering restarts at WO-0001 under the new root until you move the folders yourself. Docket never moves files, never writes .gitignore.\n`,
      );
      return 0;
    }
    process.stdout.write(`structure root: ${await store.getDocsRoot(ws.id)}\n`);
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

export async function showCommand(woIdArg: string | undefined, store: ReturnType<typeof createStore>): Promise<number> {
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
  // WO-0052: the usage floor. Per session: the ctx line and the last-usage line ONLY when the row
  // observed them, plus a per-turn tail (one line per session_usage row) — an ABSENT field prints
  // NOTHING, never a zero. This section is the operator's verification instrument for the floor;
  // the usage/limit screens (queues 3-4) render it properly later.
  if (wo.sessions.length > 0) {
    process.stdout.write('\n');
    const usageRows = store.usageRowsFor(woId);
    for (const s of wo.sessions) {
      const head = [
        `session ${s.providerSessionId ?? '(unkeyed)'}`,
        s.role,
        s.status,
        ...(s.cost ? [`in ${s.cost.tokensIn} out ${s.cost.tokensOut} · $${s.cost.usd}`] : []),
      ].join(' · ');
      process.stdout.write(`  ${head}\n`);
      if (s.ctx) process.stdout.write(`    ctx ${s.ctx.usedTokens}/${s.ctx.maxTokens}\n`);
      if (s.finalUsage) process.stdout.write(`    ${finalUsageLine(s.finalUsage)}\n`);
      for (const r of usageRows.filter((x) => x.providerSessionId === s.providerSessionId)) {
        const parts = [`turn ${r.at}`, `in ${r.tokensIn} out ${r.tokensOut}`, `$${r.usd}`];
        if (r.cacheRead !== undefined) parts.push(`cache r ${r.cacheRead}`);
        if (r.cacheCreation !== undefined) parts.push(`cache c ${r.cacheCreation}`);
        if (r.model) parts.push(r.model);
        else if ((r.modelUsage?.length ?? 0) > 1) parts.push(`${r.modelUsage!.length} models`);
        process.stdout.write(`    ${parts.join(' · ')}\n`);
      }
    }
  }
  return 0;
}

/** WO-0052: the session row's LAST observed usage, one compact line — every absent field omitted. */
function finalUsageLine(u: { cacheRead?: number; cacheCreation?: number; numTurns?: number; durationMs?: number; durationApiMs?: number; modelUsage?: Array<{ model: string; tokensIn: number; tokensOut: number; usd: number }> }): string {
  const parts: string[] = [];
  if (u.numTurns !== undefined) parts.push(`turns ${u.numTurns}`);
  if (u.durationMs !== undefined) parts.push(`${u.durationMs}ms`);
  if (u.durationApiMs !== undefined) parts.push(`api ${u.durationApiMs}ms`);
  if (u.cacheRead !== undefined) parts.push(`cache r ${u.cacheRead}`);
  if (u.cacheCreation !== undefined) parts.push(`cache c ${u.cacheCreation}`);
  if (u.modelUsage?.length === 1) parts.push(u.modelUsage[0]!.model);
  else if ((u.modelUsage?.length ?? 0) > 1) parts.push(`${u.modelUsage!.length} models`);
  return `last usage: ${parts.join(' · ')}`;
}

const HELP_TEXT =
  'docket CLI — drive the plan-driven pipeline headlessly (WO-0024)\n' +
  'commands:\n' +
  '  create-workspace --label L --repo PATH [--repo PATH]... [--decision-store PATH]\n' +
  '          create a workspace (a fresh --db works: the file is created + migrated)\n' +
  '  create-work-order --workspace W --title T [--description D] [--track SLUG]...\n' +
  '          [--review-mode gates|every-step] [--task <roadmap-task-id>]\n' +
  '          author a work order into the workspace decision store (W = id or label;\n' +
  '          tracks default to all code repos — the decision store excluded; --task links\n' +
  '          it to a roadmap task — refused when the id is not on the roadmap)\n' +
  '  drive <woId> [--plan | --step N | --review N | --prompt TXT] [--cwd PATH] [--fake SCRIPT]\n' +
  '          [--policy auto|ask] [--format stream|jsonl|quiet] [--approve-plan auto] [--resume SID]\n' +
  '  approve-plan <woId>                      approve the pending plan\n' +
  '  close <woId> [--note TXT]                close a finished WO (attested; stage → closed)\n' +
  '  remove-workspace <id-or-label> [--yes]   delete a workspace + its WOs (refuses without --yes)\n' +
  '  roadmap <show|validate> --workspace W    the derived faz/task view / hand-edit diagnostics\n' +
  '  roadmap draft --workspace W --note TXT [--docs a,b,c] [--explore] [--fake SCRIPT]\n' +
  '          the WO-less architect draft session (--docs = import, else generate; --explore = the\n' +
  '          opt-in repo exploration sentence; paths into the prompt, never contents)\n' +
  '  roadmap approve --workspace W            Onayla: the parse-guarded roadmap.md write (commit is yours)\n' +
  '  docs-root --workspace W [--root DIR|--clear]\n' +
  '          the structure root (default docs/; .docket one setting away — files never move)\n' +
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
    case 'roadmap': return await roadmapCommand(positional[1], opts, store!);
    case 'docs-root': return await docsRootCommand(opts, store!);
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
