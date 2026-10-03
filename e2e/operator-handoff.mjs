// e2e/operator-handoff.mjs — `npm run operator-handoff [-- --cap-usd <n>]`: ONE real three-leg
// limit handoff through Docket's own services (real node deps, real dispatcher, real executor,
// real transports, real buildHandoff), for the operator to record as the closing gate of #581.
// Leg 1 runs claude-code (reads CLAUDE.md natively) until its first committed file change, where
// the harness stops the CLI and records the run as a limit stop — that limit signal is the ONLY
// simulated part of the whole run. Leg 2 continues on codex (reads AGENTS.md natively, never
// CLAUDE.md) from the handoff pack the real launch path builds. Leg 3 is a short review-style run
// back on claude-code. Everything runs under tsx (the npm script), so every import of src/ is
// dynamic and inside main(); the first half below is pure and loads under plain `node --test`.
//
// Layout and safety logic follow e2e/operator-run.mjs; the reusable helpers (consent, cap
// refusal, the permission prompt, redaction, the output file name) are imported from it, not
// forked. Nothing here runs a provider CLI before the operator has typed `yes`, except the
// read-only probes discovery already makes (version / auth status).
import { execFileSync, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import {
  capRequirement,
  isYes,
  parsePermissionAnswer,
  permissionPrompt,
  redact,
  requiresCap,
  summaryFileName,
} from './operator-run.mjs';

/** The fixed pair (issue #706): X reads CLAUDE.md natively, Y does not — other pairs are out of
 *  scope. The registry data itself is re-checked before anything runs (below). */
export const PROVIDER_X = 'claude-code';
export const PROVIDER_Y = 'codex';
const ROUTE_KIND_X = 'anthropic-subscription';
const ROUTE_KIND_Y = 'codex-subscription';
const LABEL_X = 'operator-handoff claude-code';
const LABEL_Y = 'operator-handoff codex';

const USAGE = 'usage: npm run operator-handoff [--cap-usd <n>]';

/** The fixture task: step 1 creates notes.txt (the marker line), the sleep gives the checkpoint
 *  cadence (A-57: 30 s between commits) a due boundary after the write, step 2 needs step 1's
 *  content — it is what leg 2 must finish from the pack alone. */
export const workerInstructions = (token) =>
  'Two steps, in order.\n' +
  `Step 1: create a file named notes.txt whose only line is exactly: ${token}\n` +
  'Then run the shell command `sleep 45` once and let it finish; step 1 is done when it returns.\n' +
  'Step 2: create a file named answer.txt whose only line is exactly the characters of notes.txt in reverse order.\n' +
  'Change nothing else.';

export const CHECKER_INSTRUCTIONS =
  'You are reviewing a completed two-step task. Read notes.txt and answer.txt in this repository. ' +
  'Reply with the single word ok if notes.txt holds exactly one line and answer.txt holds exactly that line ' +
  'reversed; otherwise reply with the single word no. Change nothing.';

/** Pure: the unique canary sentence planted in the fixture CLAUDE.md. Reported only as
 *  present/absent anywhere the script or the record speaks. */
export const canarySentence = (seed) =>
  `DOCKET-HANDOFF-CANARY-${seed}: this sentence must reach the second provider only as quoted data.`;

// --- pure: arguments --------------------------------------------------------------------------------

/** Pure: argv → options. No positional exists (the provider pair is fixed); an unknown flag, a
 *  flag without value or a bad cap is an error so a typo cannot start a different run. */
export function parseArgs(argv) {
  const options = { capUsd: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--cap-usd') {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('--cap-usd needs a value');
      const cap = Number(value);
      if (!Number.isFinite(cap) || cap <= 0) throw new Error('--cap-usd must be a positive number');
      options.capUsd = cap;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown argument: ${arg}`);
    throw new Error(`unexpected argument: ${arg}`);
  }
  return options;
}

// --- pure: refusal rules ------------------------------------------------------------------------------

/** Pure: the cap rule over both legs' routes (P-46), composed from operator-run's own helpers —
 *  only a route billed `included` runs without a spend cap. */
export function missingCap({ billingX, billingY }, capUsd) {
  return capRequirement(billingX, capUsd) ?? capRequirement(billingY, capUsd);
}

/** Pure: a provider the probe saw logged out cannot serve its leg; `null` (unknown) stays
 *  allowed — the run itself will say. */
export function loginProblem({ loggedInX, loggedInY }) {
  if (loggedInX === false) return `${PROVIDER_X} is not logged in; run its own login command first`;
  if (loggedInY === false) return `${PROVIDER_Y} is not logged in; run its own login command first`;
  return undefined;
}

/** Pure: the provider pair is checked, not assumed (the A-66 rule): X must read CLAUDE.md
 *  natively (leg 3 inlines nothing of it) and Y must not (leg 2's inline check is only meaningful
 *  for a CLAUDE.md-blind Y — a both-files Y would make it vacuous). */
export function pairProblem({ nativeX, nativeY }) {
  if (!nativeX.includes('CLAUDE.md')) {
    return `${PROVIDER_X} no longer reads CLAUDE.md natively, so leg 3's inline check would be vacuous`;
  }
  if (nativeY.includes('CLAUDE.md')) {
    return `${PROVIDER_Y} reads CLAUDE.md natively, so leg 2's inline check would be vacuous`;
  }
  return undefined;
}

// --- pure: the consent plan ---------------------------------------------------------------------------

/** Pure: the text shown before the `yes` question — every leg, account by name, billing class,
 *  the prompts, the one simulated part, the fixtures and the spend cap. The canary sentence is
 *  not an input of this function; no plan can ever print it. */
export function consentText(plan) {
  const lines = [
    'operator-handoff will run THREE real legs through Docket\'s own launch path:',
    `  leg 1    ${PROVIDER_X} — account "${plan.labelX}" (route ${ROUTE_KIND_X}, subscription)`,
    `           billing ${plan.billingX}; logged in ${plan.loggedInX}`,
    `           prompt ${JSON.stringify(plan.workerText)}`,
    '           stop   after the first committed file change the run is stopped and recorded as a',
    '           limit stop — that limit signal is SIMULATED, and it is the only simulated part',
    '           of the whole run.',
    `  leg 2    ${PROVIDER_Y} — account "${plan.labelY}" (route ${ROUTE_KIND_Y}, subscription)`,
    `           billing ${plan.billingY}; logged in ${plan.loggedInY}`,
    '           prompt the handoff pack buildHandoff renders from leg 1\'s stored state (real cwd,',
    '           a fresh session, no resume)',
    `  leg 3    ${PROVIDER_X} — the leg-1 account, a short review-style run`,
    `           prompt ${JSON.stringify(plan.checkerText)}`,
    `  repo     a throwaway git repo under ${plan.tempRoot} (CLAUDE.md + AGENTS.md fixtures; the`,
    '           worktree, the checkpoints and the pack ride the real services)',
    '  canary   a unique sentence inside the fixture CLAUDE.md; reported only as present/absent',
    `  spend cap ${plan.capUsd === undefined ? 'none (both routes bill included)' : `$${plan.capUsd} per day, recorded on the account that bills beyond its plan`}`,
    'The runs may use quota' + (requiresCap(plan.billingX) || requiresCap(plan.billingY) ? ' and may cost real money.' : '.'),
    'Type `yes` to start; anything else starts nothing.',
  ];
  return lines.join('\n');
}

// --- pure: the simulated limit ------------------------------------------------------------------------

/** Far enough out that waiting is not a remedy this run could accidentally take. */
export const SIMULATED_RESET_MS = 30 * 24 * 3_600_000;

/** Pure: fire once, and only once a checkpoint exists — the pack's code state is the diff since
 *  that commit, so stopping any earlier would hand leg 2 nothing. */
export const shouldSimulateLimit = ({ injected, checkpointed }) => !injected && checkpointed;

/** Pure: the synthetic event, shaped exactly like a real window-exhausted hit. */
export const simulatedLimitEvent = (at, resetsAt) => ({
  type: 'limit_hit',
  at,
  hit: { class: 'window_exhausted', remedies: ['wait'], resetsAt },
});

// --- pure: facts read back from the prompt actually sent ----------------------------------------------

const CONTEXT_HEADING = '## Project context';

/** Pure: the file names inlined under the quoted-data heading of a prompt (composed or pack). */
export function inlineNames(prompt) {
  const names = [];
  let inContext = false;
  for (const line of prompt.split('\n')) {
    if (line.startsWith(CONTEXT_HEADING)) {
      inContext = true;
      continue;
    }
    if (inContext && line.startsWith('## ')) break;
    const heading = inContext ? /^### (.+)$/.exec(line) : undefined;
    if (heading !== null && heading !== undefined) names.push(heading[1]);
  }
  return names;
}

/** Pure: the pack facts the gate wants stated, read back from the pack prompt the transport
 *  received — size, the checks-first line (R-57), inlined and truncated names (A-55/A-56), and
 *  whether the definitions-change note rode along (A-62). */
export function packStats(prompt) {
  return {
    chars: prompt.length,
    checksFirst: prompt.split('\n')[0] ?? '',
    inlined: inlineNames(prompt),
    truncated: [...prompt.matchAll(/\[\.\.\. (.+?) truncated — /g)].map((found) => found[1]),
    definitionsChanged: prompt.includes('Definition changed since the first leg'),
  };
}

const collapse = (text) => String(text).replace(/\s+/g, ' ').trim();

/** Pure: does the prompt carry the canary? Returns a boolean only — the sentence itself is never
 *  echoed by any code path that reports this. */
export const canaryIn = (text, canary) => collapse(text).includes(collapse(canary));

/** Pure: the first-output latency of one leg, from the run's stored events. */
export function firstOutputOf(events, startedAt) {
  const first = events.find((event) => event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call');
  return first === undefined ? { seen: false } : { seen: true, afterMs: Math.max(0, first.at - startedAt) };
}

// --- pure: the second step ----------------------------------------------------------------------------

const oneLine = (text) => collapse(text);

/** Pure: did the work survive leg 1 and did leg 2 write the reversed answer? Whitespace around
 *  the single line is tolerated; anything else is a no. */
export function stepTwoState({ notes, answer, token }) {
  return {
    notesIntact: oneLine(notes) === token,
    answerWritten: oneLine(answer) === [...token].reverse().join(''),
  };
}

// --- pure: the outcome and the record ------------------------------------------------------------------

/** Pure: an executor result → one plain word for the plan, the stdout lines and the record. */
export function outcomeText(result) {
  if (result.kind === 'finished') return result.outcome;
  if (result.kind === 'transport_error') return `transport_error:${result.error.code}`;
  if (result.kind === 'refused') return `refused:${result.error}`;
  return 'limit';
}

/** Pure: the result record — per leg outcome, first-output latency, pack stats, canary
 *  present/absent, whether Y finished the second step from the pack alone, and the audit actions
 *  in order. Only names, numbers and booleans; no prompt text, no canary, no environment value. */
export function buildRecord(input) {
  const [legOne, legTwo, legThree] = input.legs;
  // The leg number is positional — the caller cannot mislabel a leg.
  const base = (leg, number) => ({
    leg: number,
    provider: leg.provider,
    account: leg.account,
    outcome: leg.outcome,
    firstOutput: leg.firstOutput,
    canaryInPrompt: leg.canaryInPrompt,
    inlined: leg.inlined,
    // Redaction here too, not only at the caller: the record cannot carry an unmasked error.
    errors: leg.errors.map((error) => ({ class: error.class, message: redact(error.message) })),
  });
  const secondStep = legTwo.secondStep;
  return {
    kind: 'operator-handoff',
    date: input.date,
    providers: { leg1: legOne.provider, leg2: legTwo.provider, leg3: legThree.provider },
    accounts: { leg1: legOne.account, leg2: legTwo.account, leg3: legThree.account },
    /** `simulated` = the harness injected it; `real` = the CLI hit a limit on its own; `none` = leg 1
     *  never became a limit stop and the handoff could not happen. */
    limitSource: input.limitSource,
    legs: [
      base(legOne, 1),
      {
        ...base(legTwo, 2),
        pack: legTwo.pack,
        resumed: legTwo.resumed,
        secondStep,
        completedSecondStepFromPack:
          legTwo.resumed === false && secondStep.answerWritten === true && secondStep.alreadyDoneAfterLegOne !== true,
      },
      base(legThree, 3),
    ],
    auditActions: input.auditActions,
  };
}

/** Pure: the printed form — one line per leg, the audit actions in order, the simulation note. */
export function recordLines(record) {
  const legLine = (leg, suffix = '') =>
    `leg ${leg.leg}   ${leg.provider.padEnd(11)} outcome ${leg.outcome}${suffix}; first output ${
      leg.firstOutput.seen ? `after ${leg.firstOutput.afterMs} ms` : 'never'
    }; canary: ${leg.canaryInPrompt ? 'present' : 'absent'}`;
  const legTwo = record.legs[1];
  return [
    legLine(record.legs[0], record.limitSource === 'simulated' ? ' (simulated)' : ''),
    `leg 2   ${legTwo.provider.padEnd(11)} outcome ${legTwo.outcome}; pack ${legTwo.pack?.chars ?? 0} chars; inlined: ${
      legTwo.pack?.inlined.join(', ') ?? 'none'
    }; second step from the pack: ${legTwo.completedSecondStepFromPack ? 'yes' : 'no'}`,
    legLine(record.legs[2]),
    `audit   ${record.auditActions.join(' → ')}`,
    `limit source: ${record.limitSource} — the only simulated part of the run`,
  ];
}

// --- impure shell --------------------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPERATOR = { kind: 'user', id: 'operator-handoff', label: 'operator-handoff' };
const REPO = 'handoff-repo';
const PROJECT = 'operator-handoff';

// The allowlist the app gives agent CLIs — the same names and values as operator-run.mjs (not
// exported there); keep the two lists identical when either changes. CLAUDE_CONFIG_DIR is named
// on purpose — the claude CLI's machine login lives where its own override variable points.
const CHILD_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SHELL',
  'USER',
  'CLAUDE_CONFIG_DIR',
];
const pick = (names) => Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
const parentEnv = () => Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));

/** stdin as a queue of lines, so the consent question and every permission ask read from one
 *  interface — the same plumbing as operator-run.mjs (not exported there). */
function createLineReader() {
  const rl = createInterface({ input: process.stdin });
  const lines = [];
  const waiting = [];
  let closed = false;
  rl.on('line', (line) => {
    const next = waiting.shift();
    if (next !== undefined) next(line);
    else lines.push(line);
  });
  rl.on('close', () => {
    closed = true;
    for (const next of waiting.splice(0)) next(null);
  });
  return {
    ask: (question) => {
      process.stdout.write(question);
      if (lines.length > 0) return Promise.resolve(lines.shift());
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () => rl.close(),
  };
}

/** An in-memory-keyed cipher for the throwaway database — the same plumbing as operator-run.mjs
 *  (not exported there): a stored key never rests in the clear and dies with the process. */
function throwawayCipher() {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plain) => {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]);
    },
    decryptString: (blob) => {
      const buffer = Buffer.from(blob);
      const decipher = createDecipheriv('aes-256-gcm', key, buffer.subarray(0, 12));
      decipher.setAuthTag(buffer.subarray(12, 28));
      return Buffer.concat([decipher.update(buffer.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

const git = (cwd, args) =>
  execFileSync('git', ['-c', 'user.name=operator-handoff', '-c', 'user.email=operator-handoff@docket.local', ...args], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

/** The throwaway repo: one commit carrying the fixtures — CLAUDE.md with the canary, AGENTS.md,
 *  and the .docket definitions of a two-stage flow (implement → review) whose worker role carries
 *  the two-step task and whose checker role carries the review question. */
function buildRepo(repoDir, stringify, fixture) {
  const write = (relative, value) => {
    const target = join(repoDir, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, stringify(value));
  };
  mkdirSync(repoDir, { recursive: true });
  try {
    git(repoDir, ['init', '--quiet', '--initial-branch=main']);
  } catch {
    git(repoDir, ['init', '--quiet']);
  }
  writeFileSync(join(repoDir, 'README.md'), '# operator-handoff\n\nA throwaway repo for one three-leg run.\n');
  writeFileSync(
    join(repoDir, 'CLAUDE.md'),
    `# Ground rules\n\nA throwaway repository for one operator-handoff run.\n\n${fixture.canary}\n`,
  );
  writeFileSync(join(repoDir, 'AGENTS.md'), '# Agent notes\n\nA throwaway repository for one operator-handoff run.\n');
  write('.docket/project.yaml', { id: PROJECT, name: 'Operator handoff', mainRepo: REPO, repos: [REPO] });
  write('.docket/repo.yaml', {
    id: REPO,
    name: REPO,
    flows: ['handoff-demo'],
    defaultFlow: 'handoff-demo',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  });
  write('.docket/flows/handoff-demo.yaml', {
    id: 'handoff-demo',
    name: 'Handoff demo',
    stages: [
      { id: 'implement', name: 'Implement', role: 'worker', exit: [] },
      { id: 'review', name: 'Review', role: 'checker', reviewOf: 'implement', exit: [] },
    ],
  });
  write('.docket/roles/worker.yaml', {
    id: 'worker',
    name: 'Worker',
    instructions: fixture.workerText,
    writeScope: { kind: 'repo' },
    capabilities: [],
    active: true,
  });
  write('.docket/roles/checker.yaml', {
    id: 'checker',
    name: 'Checker',
    instructions: CHECKER_INSTRUCTIONS,
    writeScope: { kind: 'none' },
    capabilities: [],
    active: true,
  });
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '--quiet', '-m', 'operator-handoff seed']);
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const { stringify } = await import('yaml');
  const app = await import('../src/application/index.ts');
  const infra = await import('../src/infrastructure/index.ts');
  const domain = await import('../src/domain/index.ts');

  const defX = infra.BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === PROVIDER_X);
  const defY = infra.BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === PROVIDER_Y);
  if (defX === undefined || defY === undefined) {
    console.error(`the built-in provider definitions must carry ${PROVIDER_X} and ${PROVIDER_Y}`);
    process.exit(2);
  }

  // The temp root is the only thing this script creates besides the output JSON.
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'docket-operator-handoff-')));
  const dataDir = join(tempRoot, '.docket');
  const repoDir = join(tempRoot, 'repo');
  mkdirSync(dataDir, { recursive: true });
  const reader = createLineReader();
  let node;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    reader.close();
    node?.value?.close();
    rmSync(tempRoot, { recursive: true, force: true });
  };

  let consented = false;
  const canary = canarySentence(randomBytes(4).toString('hex'));
  const token = `DOCKET-HANDOFF-${randomBytes(4).toString('hex')}`;
  const workerText = workerInstructions(token);

  try {
    // Every start() the real launch path makes is captured here — prompts stay in memory and are
    // never printed; only derived facts (canary present/absent, pack stats) leave this array.
    const requests = [];
    let accountIdA;
    let accountIdB;
    const simState = { injected: false };

    // Filled by discovery below; the transports wrapper reads it lazily, so a run that starts
    // only after discovery always sees the real bin paths.
    const discovered = {};
    let transports;
    const discoveredTransports = {
      forAccount: async (accountId) => {
        if (node?.ok !== true) return undefined;
        if (transports === undefined) {
          transports = infra.createProviderTransportFactory({
            defs: [defX, defY],
            accounts: node.value.deps.accounts,
            secrets: node.value.deps.secrets,
            clock: node.value.deps.clock,
            baseEnv: pick(CHILD_ENV_ALLOWLIST),
            binPaths: { [PROVIDER_X]: discovered[PROVIDER_X]?.binPath ?? null, [PROVIDER_Y]: discovered[PROVIDER_Y]?.binPath ?? null },
          });
        }
        const transport = await transports.forAccount(accountId);
        if (transport === undefined) return undefined;
        const recording = {
          start: async (request) => {
            const started = await transport.start(request);
            if (started.ok) requests.push({ runId: request.runId, accountId, prompt: request.prompt, resumed: request.resume !== undefined });
            return started;
          },
        };
        if (accountId !== accountIdA) return recording;
        // Leg 1 only: the stream the executor drinks passes through the simulator. After each
        // tool_result the generator resumes only once the executor processed it (the checkpoint
        // commit included), so `stageBase` — the first changed commit — is the exact stop signal.
        return {
          start: async (request) => {
            const started = await transport.start(request);
            if (!started.ok) return started;
            requests.push({ runId: request.runId, accountId, prompt: request.prompt, resumed: request.resume !== undefined });
            const handle = started.value;
            const events = (async function* () {
              for await (const event of handle.events) {
                yield event;
                if (event.type === 'finished') return;
                if (event.type !== 'tool_result') continue;
                const checkpointed = (await node.value.deps.runs.stageBase(request.runId)) !== undefined;
                if (!shouldSimulateLimit({ injected: simState.injected, checkpointed })) continue;
                simState.injected = true;
                await handle.stop();
                yield simulatedLimitEvent(Date.now(), Date.now() + SIMULATED_RESET_MS);
                return;
              }
            })();
            return {
              ok: true,
              value: {
                events,
                answerPermission: (askId, decision) => handle.answerPermission(askId, decision),
                steer: (note) => handle.steer(note),
                stop: () => handle.stop(),
              },
            };
          },
        };
      },
    };

    node = infra.createNodeDeps({
      dataDir,
      cipher: throwawayCipher(),
      transports: discoveredTransports,
      notifier: { notify: () => undefined },
      commandEnv: pick(CHILD_ENV_ALLOWLIST),
    });
    if (!node.ok) throw new Error(`storage could not be opened: ${JSON.stringify(node.error)}`);
    const deps = node.value.deps;

    // The pair is checked against the live registry, not assumed (A-66's rule).
    const pair = pairProblem({
      nativeX: deps.capabilities.nativeInstructionFiles(PROVIDER_X),
      nativeY: deps.capabilities.nativeInstructionFiles(PROVIDER_Y),
    });
    if (pair !== undefined) {
      console.error(pair);
      cleanup();
      process.exit(2);
    }

    buildRepo(repoDir, stringify, { canary, workerText });

    // Discovery over the two providers only: its read-only probes (version, auth status) are the
    // only CLI calls before consent.
    console.log(`[operator-handoff] probing ${PROVIDER_X} and ${PROVIDER_Y} (read-only: version and login status)…`);
    await infra
      .createPathDiscovery(
        [defX, defY],
        (command, args, spawnOptions) => spawn(command, [...args], spawnOptions),
        parentEnv(),
        homedir(),
      )
      .discover((result) => {
        discovered[result.defId] = result;
      });
    for (const id of [PROVIDER_X, PROVIDER_Y]) {
      if (discovered[id]?.binPath == null) throw new Error(`the ${id} CLI was not found on this machine's PATH`);
    }
    const loginIssue = loginProblem({
      loggedInX: discovered[PROVIDER_X]?.loggedIn ?? null,
      loggedInY: discovered[PROVIDER_Y]?.loggedIn ?? null,
    });
    if (loginIssue !== undefined) {
      console.error(loginIssue);
      cleanup();
      process.exit(2);
    }

    // The two accounts: subscription machine logins, both created through the use case the app
    // itself uses. Leg 1's policy is the one the recorded decision path follows.
    accountIdA = deps.ids.next('account');
    const savedA = await app.saveAccount(deps, {
      record: {
        id: accountIdA,
        provider: PROVIDER_X,
        label: LABEL_X,
        authMode: 'subscription',
        routeKind: ROUTE_KIND_X,
        limitPolicy: 'fallback_account',
        caps: [],
      },
      actor: OPERATOR,
    });
    if (!savedA.ok) throw new Error(`the ${PROVIDER_X} account did not save: ${savedA.error}`);
    accountIdB = deps.ids.next('account');
    const savedB = await app.saveAccount(deps, {
      record: {
        id: accountIdB,
        provider: PROVIDER_Y,
        label: LABEL_Y,
        authMode: 'subscription',
        routeKind: ROUTE_KIND_Y,
        limitPolicy: 'ask',
        caps: [],
      },
      actor: OPERATOR,
    });
    if (!savedB.ok) throw new Error(`the ${PROVIDER_Y} account did not save: ${savedB.error}`);

    // Billing decides whether a cap is mandatory; the same registry reading the executor's gate
    // uses (P-40/P-46). No model is pinned, so no catalog call is needed before consent.
    const billingX = app.defaultBillingOf(deps.capabilities, await deps.accounts.get(accountIdA));
    const billingY = app.defaultBillingOf(deps.capabilities, await deps.accounts.get(accountIdB));
    const capMissing = missingCap({ billingX, billingY }, options.capUsd);
    if (capMissing !== undefined) {
      console.error(capMissing);
      cleanup();
      process.exit(2);
    }

    console.log(
      consentText({
        labelX: LABEL_X,
        labelY: LABEL_Y,
        billingX,
        billingY,
        capUsd: options.capUsd,
        tempRoot,
        workerText,
        checkerText: CHECKER_INSTRUCTIONS,
        loggedInX: discovered[PROVIDER_X].loggedIn === true ? 'yes' : 'unknown',
        loggedInY: discovered[PROVIDER_Y].loggedIn === true ? 'yes' : 'unknown',
      }),
    );
    if (!isYes(await reader.ask('> '))) {
      console.log('No `yes` given — nothing was started.');
      cleanup();
      return;
    }
    consented = true;

    // A route that may spend money gets the recorded consent and the cap (P-40).
    const consentGranted = [];
    for (const [accountId, billing] of [
      [accountIdA, billingX],
      [accountIdB, billingY],
    ]) {
      if (!requiresCap(billing)) continue;
      const granted = await app.grantSpendConsent(deps, {
        accountId,
        model: app.DEFAULT_MODEL_CONSENT,
        cap: { scope: 'account_day', cap: { amountUsd: options.capUsd, warnPercent: 80 } },
        actor: OPERATOR,
      });
      if (!granted.ok) throw new Error(`spend consent did not save: ${granted.error}`);
      consentGranted.push(accountId);
    }

    // Project, bindings, work order — all through the use cases the app itself calls. The worker
    // chain is [A, B] so B is the fallback; the checker chain is [B, A] so leg 3 landing on A can
    // only be orderForReview's doing (R-52) — B wrote the stage.
    const attached = await app.attachProject(deps, { path: repoDir, actor: OPERATOR });
    if (!attached.ok) throw new Error(`project did not attach: ${attached.error}`);
    const boundWorker = await app.saveBinding(deps, {
      scope: { level: 'global' },
      binding: { role: 'worker', accounts: [{ accountId: accountIdA }, { accountId: accountIdB }] },
      actor: OPERATOR,
    });
    if (!boundWorker.ok) throw new Error(`the worker binding did not save: ${boundWorker.error}`);
    const boundChecker = await app.saveBinding(deps, {
      scope: { level: 'global' },
      binding: { role: 'checker', accounts: [{ accountId: accountIdB }, { accountId: accountIdA }] },
      actor: OPERATOR,
    });
    if (!boundChecker.ok) throw new Error(`the checker binding did not save: ${boundChecker.error}`);
    const opened = await app.openWorkOrder(deps, { project: PROJECT, repo: REPO, title: 'operator handoff', actor: OPERATOR });
    if (!opened.ok) throw new Error(`work order did not open: ${opened.error}`);
    const workOrderId = opened.value;

    const permissions = [];
    const gate = {
      onAsk: async (_runId, ask) => {
        let decision;
        while (decision === undefined) decision = parsePermissionAnswer(await reader.ask(permissionPrompt(ask)));
        permissions.push({ tool: ask.tool, decision });
        return decision;
      },
    };

    const tickOnce = async () => {
      let started;
      const tick = await app.dispatcherTick(deps, { limits: { global: 1, perRepo: 1, perAccount: {} } }, (item) => {
        started = item;
      });
      if (started === undefined) throw new Error(`the dispatcher started nothing: ${JSON.stringify(tick.decisions)}`);
      return started;
    };
    const startStage = async () => {
      const queued = await app.enqueueStage(deps, { id: workOrderId });
      if (!queued.ok) throw new Error(`the stage did not enqueue: ${queued.error}`);
      return tickOnce();
    };

    /** One started item the composition root's way: the role from the definitions, the prompt
     *  from the single prompt entry point, the worktree from the worktrees port. A handoff item's
     *  composed prompt is discarded inside the executor for the pack — composing it anyway is
     *  what the composition root does for every started item. */
    const runItem = async (item) => {
      const loaded = await deps.definitions.load(REPO);
      if (!loaded.ok) throw new Error('definitions did not load');
      const flow = loaded.value.flows.find((candidate) => candidate.id === 'handoff-demo');
      const stage = flow?.stages.find((candidate) => candidate.id === item.stage);
      const roleId = stage?.role ?? null;
      const role = roleId === null ? undefined : loaded.value.roles.find((candidate) => candidate.id === roleId);
      if (role === undefined) throw new Error(`the stage ${item.stage} has no runnable role`);
      const worktree = await deps.worktrees.ensure(REPO, workOrderId);
      if (!worktree.ok) throw new Error(`no worktree (${worktree.error})`);
      const composed = await app.composeRunPrompt(deps, {
        repo: REPO,
        workOrderId,
        cwd: worktree.value.path,
        stage: item.stage,
        role: role.id,
        route: item.route,
      });
      if (!composed.ok) throw new Error(`prompt composition failed (${composed.error})`);
      const result = await app.executeRun(deps, gate, {
        item,
        role,
        prompt: composed.value.prompt,
        cwd: worktree.value.path,
        capabilities: [],
      });
      return { result, cwd: worktree.value.path };
    };

    const legData = async (run, result) => {
      const request = requests.find((entry) => entry.runId === run.id);
      const events = await deps.runs.events(run.id);
      return {
        provider: (await deps.accounts.get(run.route.accountId))?.provider ?? '?',
        account: (await deps.accounts.get(run.route.accountId))?.label ?? run.route.accountId,
        outcome: outcomeText(result),
        firstOutput: firstOutputOf(events, run.startedAt),
        canaryInPrompt: request === undefined ? false : canaryIn(request.prompt, canary),
        inlined: request === undefined ? [] : inlineNames(request.prompt),
        errors: events
          .filter((event) => event.type === 'error')
          .map((event) => ({ class: event.class, message: redact(event.message) })),
      };
    };

    // --- leg 1: X runs until its first committed file change, then the simulated limit --------
    console.log('[operator-handoff] leg 1 — claude-code runs the two-step task…');
    const itemOne = await startStage();
    if (itemOne.route.accountId !== accountIdA) throw new Error('leg 1 did not start on the claude-code account');
    const legOne = await runItem(itemOne);
    const implementRuns = async () =>
      (await deps.runs.listForWorkOrder(workOrderId)).filter((run) => run.stage === 'implement');
    const runOne = (await implementRuns()).at(-1);
    if (runOne === undefined) throw new Error('leg 1 left no run record');
    const worktreeOf = async () => {
      const ensured = await deps.worktrees.ensure(REPO, workOrderId);
      return ensured.ok ? ensured.value.path : undefined;
    };
    const answerAfterLegOne = await worktreeOf().then((path) => path !== undefined && existsSync(join(path, 'answer.txt')));
    if (runOne.outcome !== 'limit' || legOne.result.kind !== 'limit') {
      throw new Error(
        `leg 1 ended as ${runOne.outcome ?? outcomeText(legOne.result)} — the simulated limit never landed (checkpoint reached: ${simState.injected})`,
      );
    }
    console.log(`[operator-handoff] leg 1 stopped as a limit (${simState.injected ? 'simulated' : 'real'} signal).`);

    // --- the caller's re-routing decision: the executor holds no role binding (A-65) -----------
    const routed = await app.resolveRoute(deps, { repo: REPO, workOrderId, role: 'worker' });
    if (!routed.ok) throw new Error(`the worker route did not resolve: ${JSON.stringify(routed.error)}`);
    const routeB = routed.value.chain.find((route) => route.accountId === accountIdB);
    if (routeB === undefined) throw new Error('the worker chain does not carry the codex account');
    const decision = domain.decideOnLimit(
      { accountId: accountIdA, at: Date.now(), class: 'window_exhausted', remedies: ['wait'], resetsAt: Date.now() + SIMULATED_RESET_MS },
      {
        policy: 'fallback_account',
        autoResumesUsed: runOne.autoResumesUsed,
        maxAutoResumes: 3,
        alternativePools: [],
        fallbackAccounts: [{ route: routeB, billing: billingY, consented: billingY === 'included' || consentGranted.includes(accountIdB) }],
        now: Date.now(),
      },
    );
    if (decision.kind !== 'fallback') {
      throw new Error(`the limit decision was not a fallback (${decision.kind}${decision.kind === 'ask' ? `: ${decision.reason}` : ''})`);
    }
    const applied = await app.applyLimitDecision(deps, { runId: runOne.id, decision });
    if (!applied.ok) throw new Error(`the fallback item did not queue: ${applied.error}`);

    // --- leg 2: Y continues from the pack through the real launch path ------------------------
    console.log('[operator-handoff] leg 2 — codex continues from the handoff pack…');
    const itemTwo = await tickOnce();
    if (itemTwo.route.accountId !== accountIdB) throw new Error('the queued fallback did not start on the codex account');
    if (itemTwo.handoffOf !== runOne.id) throw new Error('the fallback item does not name leg 1 as its handoff source');
    const legTwo = await runItem(itemTwo);
    const runTwo = (await implementRuns()).at(-1);
    if (runTwo === undefined) throw new Error('leg 2 left no run record');
    const requestTwo = requests.find((entry) => entry.runId === runTwo.id);
    if (requestTwo === undefined) throw new Error('leg 2 never reached the transport');
    const statsTwo = packStats(requestTwo.prompt);
    console.log(`[operator-handoff] leg 2 pack: ${statsTwo.chars} chars; inlined: ${statsTwo.inlined.join(', ') || 'none'}; truncated: ${statsTwo.truncated.join(', ') || 'none'}`);
    console.log(`[operator-handoff] leg 2 checks-first line: ${JSON.stringify(statsTwo.checksFirst)}; definitionsChanged: ${statsTwo.definitionsChanged ? 'yes' : 'no'}`);
    console.log(`[operator-handoff] leg 2 canary in prompt: ${canaryIn(requestTwo.prompt, canary) ? 'present' : 'absent'}; resume field: ${requestTwo.resumed ? 'set' : 'absent'}`);

    // The second step's verdict comes from the worktree leg 2 left behind.
    const worktreePath = await worktreeOf();
    const readIfExists = (name) =>
      worktreePath === undefined || !existsSync(join(worktreePath, name)) ? undefined : readFileSync(join(worktreePath, name), 'utf8');

    // --- leg 3: X reviews — orderForReview puts the non-writer first (R-52) -------------------
    console.log('[operator-handoff] leg 3 — claude-code reviews…');
    const itemThree = await startStage();
    if (itemThree.route.accountId !== accountIdA) {
      console.error(`[operator-handoff] leg 3 started on the codex account, not the claude-code one (orderForReview)`);
    }
    const legThree = await runItem(itemThree);
    const runThree = (await deps.runs.listForWorkOrder(workOrderId)).filter((run) => run.stage === 'review').at(-1);
    if (runThree === undefined) throw new Error('leg 3 left no run record');
    const requestThree = requests.find((entry) => entry.runId === runThree.id);
    const inlinedThree = requestThree === undefined ? [] : inlineNames(requestThree.prompt);
    console.log(
      `[operator-handoff] leg 3 inlined: ${inlinedThree.join(', ') || 'nothing'}; CLAUDE.md inlined: ${
        requestThree !== undefined && inlinedThree.includes('CLAUDE.md') ? 'yes' : 'no (claude-code reads it natively)'
      }`,
    );

    // --- the record ------------------------------------------------------------------------------
    const allowed = permissions.filter((entry) => entry.decision === 'allow').length;
    console.log(`[operator-handoff] permission asks answered: ${permissions.length} (${allowed} allow, ${permissions.length - allowed} deny)`);
    const one = await legData(runOne, legOne.result);
    const two = await legData(runTwo, legTwo.result);
    const secondStep = {
      ...stepTwoState({ notes: readIfExists('notes.txt') ?? '', answer: readIfExists('answer.txt') ?? '', token }),
      alreadyDoneAfterLegOne: answerAfterLegOne,
    };
    const three = await legData(runThree, legThree.result);

    const subjects = [
      { kind: 'work_order', id: workOrderId },
      { kind: 'run', id: runOne.id },
      { kind: 'run', id: runTwo.id },
      { kind: 'run', id: runThree.id },
    ];
    const entries = (await Promise.all(subjects.map((subject) => deps.log.list(subject, 200)))).flat();
    const auditActions = entries
      .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
      .map((entry) => entry.action);

    const date = new Date().toISOString().slice(0, 10);
    const record = buildRecord({
      date,
      limitSource: simState.injected ? 'simulated' : 'real',
      legs: [
        one,
        { ...two, pack: statsTwo, resumed: requestTwo.resumed, secondStep },
        three,
      ],
      auditActions,
    });
    const outDir = join(homedir(), 'source', 'docket-tasarim', 'operator-runs');
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, summaryFileName(date, 'handoff', (name) => existsSync(join(outDir, name))));
    writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
    console.log(['', ...recordLines(record), '', `written to ${file}`].join('\n'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (consented) {
      // A partial record still tells the architect where the run broke; only derived facts.
      const date = new Date().toISOString().slice(0, 10);
      const outDir = join(homedir(), 'source', 'docket-tasarim', 'operator-runs');
      mkdirSync(outDir, { recursive: true });
      const file = join(outDir, summaryFileName(date, 'handoff', (name) => existsSync(join(outDir, name))));
      writeFileSync(file, `${JSON.stringify({ kind: 'operator-handoff', date, failed: redact(message) }, null, 2)}\n`);
      console.error(`operator-handoff failed: ${message}\na failure record was written to ${file}`);
    } else {
      console.error(`operator-handoff failed: ${message}`);
    }
    process.exitCode = 1;
  } finally {
    cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`operator-handoff failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
