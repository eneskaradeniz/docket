// e2e/operator-run.mjs — `npm run operator-run -- <provider-def-id> [options]`: ONE real run
// through Docket's own launch path (real node deps, real dispatcher tick, real executor, real
// transport), for the operator to record as a gate-G6 run. It runs under tsx (the npm script),
// because the composition it builds is TypeScript; every import of src/ is therefore dynamic and
// inside main(), so the pure parts below load under plain `node --test` without touching a CLI.
//
// Layout: the first half is pure (argument parsing, consent, the permission prompt, canary
// search, redaction, summary); main() is the thin impure shell. Nothing here runs a provider CLI
// before the operator has typed `yes`, except the read-only probes discovery and the model
// catalog already make (version / auth status / model list).
import { execFileSync, spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** The fixed prompt: the cheapest possible turn that still proves launch, output and finish. */
export const PROMPT = 'Reply with the single word ok and do nothing else.';

export const EFFORT_LEVELS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

/** The keychain service the operator stores an API key under for this script (macOS). */
export const KEYCHAIN_SERVICE = 'docket-operator-run';

const USAGE =
  'usage: npm run operator-run -- <provider-def-id> [--account <route-kind>] [--model <id>] ' +
  '[--effort <level>] [--cap-usd <n>] [--canary <sentence>]';

// --- pure: arguments -----------------------------------------------------------------------------

/** Pure: argv → options. An unknown flag, a flag without value, or a second positional is an error
 *  so a typo cannot start a run that is not the one the operator meant. */
export function parseArgs(argv) {
  const options = { provider: undefined, account: undefined, model: undefined, effort: undefined, capUsd: undefined, canary: undefined, help: false };
  const valued = { '--account': 'account', '--model': 'model', '--effort': 'effort', '--cap-usd': 'capUsd', '--canary': 'canary' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    const key = valued[arg];
    if (key !== undefined) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`);
      options[key] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) throw new Error(`unknown argument: ${arg}`);
    if (options.provider !== undefined) throw new Error(`unexpected extra argument: ${arg}`);
    options.provider = arg;
  }
  if (options.help) return options;
  if (options.provider === undefined) throw new Error(`a provider definition id is required\n${USAGE}`);
  if (options.effort !== undefined && !EFFORT_LEVELS.includes(options.effort)) {
    throw new Error(`--effort must be one of ${EFFORT_LEVELS.join(', ')}`);
  }
  if (options.capUsd !== undefined) {
    const cap = Number(options.capUsd);
    if (!Number.isFinite(cap) || cap <= 0) throw new Error('--cap-usd must be a positive number');
    options.capUsd = cap;
  }
  if (options.canary !== undefined && options.canary.trim() === '') throw new Error('--canary must not be blank');
  return options;
}

// --- pure: consent -------------------------------------------------------------------------------

/** Pure: only a billing of `included` runs without a spend cap; metered and unknown never do (P-40). */
export const requiresCap = (billing) => billing !== 'included';

/** Pure: the refusal text when the run needs a cap and none was given; undefined when fine. */
export function capRequirement(billing, capUsd) {
  if (!requiresCap(billing) || capUsd !== undefined) return undefined;
  return `the model's billing is "${billing}", so the run may spend money: pass --cap-usd <n> (recorded as the account's daily cap)`;
}

/** Pure: the text shown before the `yes` question — what will run, where, and what it may cost. */
export function consentText(plan) {
  const lines = [
    'operator-run will start ONE real run:',
    `  provider        ${plan.provider}`,
    `  route kind      ${plan.routeKind} (${plan.authMode})`,
    `  model           ${plan.model ?? '(the CLI default)'}`,
    `  effort          ${plan.effort ?? '(the binding default)'}`,
    `  billing         ${plan.billing}`,
    `  prompt          ${JSON.stringify(PROMPT)}`,
    `  working repo    a throwaway git repo under ${plan.tempRoot}`,
    `  spend cap       ${plan.capUsd === undefined ? 'none (included model)' : `$${plan.capUsd} per day, recorded on the account`}`,
    `  canary check    ${plan.canary === undefined ? 'off' : 'on'}`,
    'The run may use quota' + (requiresCap(plan.billing) ? ' and may cost real money.' : '.'),
    'Type `yes` to start; anything else starts nothing.',
  ];
  return lines.join('\n');
}

/** Pure: only the exact word `yes` (surrounding blanks and letter case ignored) consents; `y`,
 *  `ok`, an empty line and end of input (null) do not. */
export const isYes = (line) => typeof line === 'string' && line.trim().toLowerCase() === 'yes';

// --- pure: the permission prompt -------------------------------------------------------------------

/** Pure: the text printed for a permission ask. The target is the run's own event text. */
export function permissionPrompt(ask) {
  const target = ask.target === undefined ? '' : ` on ${ask.target}`;
  const options = Array.isArray(ask.options) && ask.options.length > 0 ? ` (agent offers: ${ask.options.join(', ')})` : '';
  return `The agent asks permission to use ${ask.tool}${target}${options}.\nAnswer \`allow\` or \`deny\`: `;
}

/** Pure: a typed line → a decision, or undefined when it is neither (the caller asks again).
 *  Short forms are not accepted: an approval must be spelled out. End of input (null) denies. */
export function parsePermissionAnswer(line) {
  if (line === null) return 'deny';
  const word = line.trim().toLowerCase();
  return word === 'allow' || word === 'deny' ? word : undefined;
}

// --- pure: canary --------------------------------------------------------------------------------

const collapse = (text) => text.replace(/\s+/g, ' ').trim();

/** Pure: the searchable text of one event, by event kind. Only fields that carry free text. */
function eventFields(event) {
  switch (event.type) {
    case 'text':
    case 'thinking':
      return [event.delta];
    case 'tool_call':
      return [event.name, event.target ?? ''];
    case 'permission_ask':
      return [event.tool, event.target ?? '', ...(event.options ?? [])];
    case 'error':
      return [event.message];
    case 'raw':
      return [event.line];
    default:
      return [];
  }
}

/** Pure: P-44 — does the sentence the operator planted in their own instructions file show up in
 *  the run's events (the answer's text deltas, tool targets, raw lines)? Deltas of one kind are
 *  joined first, so a sentence split across stream chunks is still found. The verdict names only
 *  the event kinds, never the sentence or its surroundings. */
export function searchCanary(events, canary) {
  if (canary === undefined) return { checked: false, verdict: 'not checked', seenIn: [] };
  const needle = collapse(canary);
  const byKind = new Map();
  for (const event of events) {
    const fields = eventFields(event);
    if (fields.length === 0) continue;
    byKind.set(event.type, `${byKind.get(event.type) ?? ''}${fields.join(' ')}`);
  }
  const seenIn = [...byKind].filter(([, text]) => collapse(text).includes(needle)).map(([kind]) => kind);
  return { checked: true, verdict: seenIn.length > 0 ? 'leaked' : 'not seen', seenIn };
}

// --- pure: redaction and the summary ---------------------------------------------------------------

const MESSAGE_LIMIT = 200;

/** Pure: text that goes into the JSON passes through here. Token-shaped strings, bearer headers,
 *  `KEY=value` pairs of secret-looking names and long opaque runs are masked, then it is cut. */
export function redact(text) {
  const masked = String(text)
    .replace(/\bauthorization\s*[:=]\s*(?:bearer\s+)?\S+/gi, 'authorization [redacted]')
    .replace(/\bbearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/\b([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[A-Za-z0-9_]*)\s*=\s*\S+/gi, '$1=[redacted]')
    .replace(/\b(?:sk|pk|ghp|gho|github_pat|xox[a-z]|AIza|ya29)[-_A-Za-z0-9.]{12,}/g, '[redacted]')
    .replace(/\b[A-Za-z0-9+/_-]{32,}={0,2}/g, '[redacted]');
  return masked.length > MESSAGE_LIMIT ? `${masked.slice(0, MESSAGE_LIMIT - 1)}…` : masked;
}

/** Pure: what discovery plus the run's events say about the login. An `auth` error event is the
 *  strongest evidence; otherwise the probe's answer stands; otherwise a session that started
 *  proves a login the probe could not read. */
export function loginState(discoveredLoggedIn, events) {
  if (events.some((event) => event.type === 'error' && event.class === 'auth')) return 'no';
  if (discoveredLoggedIn === true) return 'yes';
  if (discoveredLoggedIn === false) return 'no';
  return events.some((event) => event.type === 'session_started') ? 'yes' : 'unknown';
}

/** Pure: the summary the operator reads and the architect records. Facts about the run only —
 *  counts, timings, the outcome, the agent's own short answer and redacted error text. No
 *  environment value, no token, nothing read from any file: the inputs are the run's events and
 *  the probe results, and the output names no other source. */
export function buildSummary(input) {
  const { events } = input;
  const startedAt = input.startedAt;
  const firstOutput = events.find((event) => event.type === 'text' || event.type === 'thinking' || event.type === 'tool_call');
  const usages = events.filter((event) => event.type === 'usage');
  const answer = collapse(events.filter((event) => event.type === 'text').map((event) => event.delta).join(''));
  const counts = {};
  for (const event of events) counts[event.type] = (counts[event.type] ?? 0) + 1;
  const totalOf = (field) => usages.reduce((sum, event) => sum + (event[field] ?? 0), 0);
  const costs = usages.filter((event) => event.costUsd !== undefined);
  return {
    date: input.date,
    provider: input.provider,
    routeKind: input.routeKind,
    model: input.model ?? null,
    effort: input.effort ?? null,
    providerVersion: input.version === undefined || input.version === null ? null : redact(input.version),
    loggedIn: loginState(input.discoveredLoggedIn, events),
    firstOutput: firstOutput === undefined ? { seen: false } : { seen: true, afterMs: Math.max(0, firstOutput.at - startedAt) },
    permission: {
      asked: input.permissions.length,
      waitedMs: input.permissions.reduce((sum, entry) => sum + entry.waitedMs, 0),
      answers: input.permissions.map((entry) => ({ tool: entry.tool, decision: entry.decision, waitedMs: entry.waitedMs })),
    },
    usage:
      usages.length === 0
        ? { seen: false }
        : {
            seen: true,
            inputTokens: totalOf('inputTokens'),
            outputTokens: totalOf('outputTokens'),
            ...(costs.length > 0 ? { costUsd: costs.reduce((sum, event) => sum + event.costUsd, 0) } : {}),
          },
    canary: searchCanary(events, input.canary),
    answer: redact(answer),
    errors: events
      .filter((event) => event.type === 'error')
      .map((event) => ({ class: event.class, ...(event.reason === undefined ? {} : { reason: event.reason }), message: redact(event.message) })),
    eventCounts: counts,
    outcome: input.outcome,
  };
}

/** Pure: the output file name; an existing name gets -2, -3 … so a rerun never overwrites. */
export function summaryFileName(date, provider, exists) {
  const base = `${date}-${provider}`;
  let name = `${base}.json`;
  for (let n = 2; exists(name); n += 1) name = `${base}-${n}.json`;
  return name;
}

/** Pure: the printed form of the summary — one line per question the operator cares about. */
export function summaryLines(summary) {
  const yn = (flag) => (flag ? 'yes' : 'no');
  return [
    `logged in?        ${summary.loggedIn}`,
    `first output?     ${summary.firstOutput.seen ? `yes (after ${summary.firstOutput.afterMs} ms)` : 'no'}`,
    `permission waited ${summary.permission.asked === 0 ? 'no ask' : `${summary.permission.asked} ask(s), ${summary.permission.waitedMs} ms`}`,
    `usage seen?       ${yn(summary.usage.seen)}`,
    `canary            ${summary.canary.verdict}${summary.canary.seenIn.length > 0 ? ` (in ${summary.canary.seenIn.join(', ')})` : ''}`,
    `outcome           ${summary.outcome}`,
  ];
}

// --- impure shell ----------------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OPERATOR = { kind: 'user', id: 'operator-run', label: 'operator-run' };

/** The allowlist the app gives agent CLIs: an allowlist cannot leak a variable it never named. */
const CHILD_ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TERM', 'SHELL', 'USER'];
const pick = (names) => Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
const parentEnv = () => Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));

/** stdin as a queue of lines, so the consent question and every permission ask read from one
 *  interface. End of input answers every pending and later question with null. */
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

/** An in-memory-keyed cipher for the throwaway database: a key stored there never rests in the
 *  clear, and the key dies with the process. */
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

/** The API key of an api-key route comes from the macOS keychain item the operator created, and
 *  goes straight into the vault; it is never printed, logged or put in a record. */
function readKeychainSecret(routeKind) {
  if (process.platform !== 'darwin') throw new Error('api-key routes read the key from the macOS keychain; this platform is not supported');
  try {
    return execFileSync('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', routeKind, '-w'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new Error(
      `no keychain item for route kind ${routeKind}: create it with\n` +
        `  security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${routeKind} -w`,
    );
  }
}

const git = (cwd, args) =>
  execFileSync('git', ['-c', 'user.name=operator-run', '-c', 'user.email=operator-run@docket.local', ...args], {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

/** The throwaway repo: one commit carrying the .docket definitions of a one-stage flow whose only
 *  role has no capabilities. Written with the same files the real loader reads. */
function buildRepo(repoDir, stringify) {
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
  writeFileSync(join(repoDir, 'README.md'), '# operator-run\n\nA throwaway repo for one real run.\n');
  write('.docket/project.yaml', { id: 'operator-run', name: 'Operator run', mainRepo: 'operator-run-repo', repos: ['operator-run-repo'] });
  write('.docket/repo.yaml', {
    id: 'operator-run-repo',
    name: 'operator-run-repo',
    flows: ['single-run'],
    defaultFlow: 'single-run',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  });
  write('.docket/flows/single-run.yaml', {
    id: 'single-run',
    name: 'Single run',
    stages: [{ id: 'run', name: 'Run', role: 'operator', exit: [] }],
  });
  write('.docket/roles/operator.yaml', {
    id: 'operator',
    name: 'Operator',
    instructions: PROMPT,
    writeScope: { kind: 'repo' },
    capabilities: [],
    active: true,
  });
  git(repoDir, ['add', '-A']);
  git(repoDir, ['commit', '--quiet', '-m', 'operator-run seed']);
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

  const def = infra.BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === options.provider);
  if (def === undefined) {
    console.error(`unknown provider definition id: ${options.provider} (known: ${infra.BUILTIN_PROVIDER_DEFS.map((d) => d.id).join(', ')})`);
    process.exit(2);
  }

  // The temp root is the only thing this script creates besides the output JSON.
  const tempRoot = realpathSync(mkdtempSync(join(tmpdir(), 'docket-operator-run-')));
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

  try {
    buildRepo(repoDir, stringify);

    // Discovery runs over the one chosen provider only: its read-only probes (version, auth
    // status) are the only CLI calls before consent.
    const env = parentEnv();
    const discovered = {};
    let transports;
    const discoveredTransports = {
      forAccount: async (accountId) => {
        if (node?.ok !== true) return undefined;
        if (transports === undefined) {
          transports = infra.createProviderTransportFactory({
            defs: [def],
            accounts: node.value.deps.accounts,
            secrets: node.value.deps.secrets,
            clock: node.value.deps.clock,
            baseEnv: pick(CHILD_ENV_ALLOWLIST),
            binPaths: { [def.id]: discovered.binPath ?? null },
          });
        }
        return transports.forAccount(accountId);
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

    console.log(`[operator-run] probing ${def.id} (read-only: version and login status)…`);
    await infra
      .createPathDiscovery(
        [def],
        (command, args, spawnOptions) => spawn(command, [...args], spawnOptions),
        env,
        homedir(),
      )
      .discover((result) => Object.assign(discovered, result));
    if (discovered.binPath === null || discovered.binPath === undefined) {
      throw new Error(`the ${def.id} CLI was not found on this machine's PATH`);
    }

    // The account: the machine login by default; an api-key route only when asked for by name.
    const routeKindId =
      options.account ?? deps.capabilities.routeKindOf({ provider: def.id, authMode: 'subscription' });
    const routeKind = routeKindId === undefined ? undefined : deps.capabilities.routeKind(routeKindId);
    if (routeKind === undefined || routeKind.providerId !== def.id) {
      throw new Error(`no route kind ${routeKindId ?? '(default subscription)'} for provider ${def.id}`);
    }
    const accountId = deps.ids.next('account');
    const secret = routeKind.authMode === 'subscription' ? undefined : readKeychainSecret(routeKind.id);
    const record = {
      id: accountId,
      provider: def.id,
      label: `operator-run ${def.id}`,
      authMode: routeKind.authMode,
      routeKind: routeKind.id,
      limitPolicy: 'ask',
      ...(secret === undefined ? {} : { secretRef: `operator-run/${accountId}` }),
      caps: [],
    };
    const saved = await app.saveAccount(deps, { record, ...(secret === undefined ? {} : { secret }), actor: OPERATOR });
    if (!saved.ok) throw new Error(`account did not save: ${saved.error}`);

    // Billing decides whether a cap is mandatory; the same reading the executor's gate uses.
    console.log('[operator-run] reading the model catalog (read-only)…');
    const stored = await deps.accounts.get(accountId);
    let billing;
    if (options.model !== undefined) {
      const catalog = await app.catalogOrEmpty(() => deps.modelCatalog.list(accountId));
      billing = domain.billingFromPools(
        catalog.find((entry) => entry.id === options.model)?.billing ?? 'unknown',
        app.matchIdFor(catalog, options.model),
        await deps.accounts.pools(accountId),
      );
    } else {
      billing = app.defaultBillingOf(deps.capabilities, stored);
    }
    const missingCap = capRequirement(billing, options.capUsd);
    if (missingCap !== undefined) {
      console.error(missingCap);
      cleanup();
      process.exit(2);
    }

    console.log(
      consentText({
        provider: def.id,
        routeKind: routeKind.id,
        authMode: routeKind.authMode,
        model: options.model,
        effort: options.effort,
        billing,
        capUsd: options.capUsd,
        canary: options.canary,
        tempRoot,
      }),
    );
    if (!isYes(await reader.ask('> '))) {
      console.log('No `yes` given — nothing was started.');
      cleanup();
      return;
    }

    if (requiresCap(billing)) {
      const granted = await app.grantSpendConsent(deps, {
        accountId,
        model: options.model ?? app.DEFAULT_MODEL_CONSENT,
        cap: { scope: 'account_day', cap: { amountUsd: options.capUsd, warnPercent: 80 } },
        actor: OPERATOR,
      });
      if (!granted.ok) throw new Error(`spend consent did not save: ${granted.error}`);
    }

    // Project, binding, work order, queue — all through the use cases the app itself calls.
    const attached = await app.attachProject(deps, { path: repoDir, actor: OPERATOR });
    if (!attached.ok) throw new Error(`project did not attach: ${attached.error}`);
    const bound = await app.saveBinding(deps, {
      scope: { level: 'global' },
      binding: {
        role: 'operator',
        accounts: [{ accountId, ...(options.model === undefined ? {} : { model: options.model }) }],
        ...(options.effort === undefined ? {} : { thinking: { effort: options.effort } }),
      },
      actor: OPERATOR,
    });
    if (!bound.ok) throw new Error(`binding did not save: ${bound.error}`);
    const opened = await app.openWorkOrder(deps, {
      project: 'operator-run',
      repo: 'operator-run-repo',
      title: 'operator run',
      actor: OPERATOR,
    });
    if (!opened.ok) throw new Error(`work order did not open: ${opened.error}`);
    const queued = await app.enqueueStage(deps, { id: opened.value });
    if (!queued.ok) throw new Error(`stage did not enqueue: ${JSON.stringify(queued.error)}`);

    let started;
    const tick = await app.dispatcherTick(deps, { limits: { global: 1, perRepo: 1, perAccount: {} } }, (item) => {
      started = item;
    });

    const permissions = [];
    const gate = {
      onAsk: async (_runId, ask) => {
        const askedAt = Date.now();
        let decision;
        while (decision === undefined) decision = parsePermissionAnswer(await reader.ask(permissionPrompt(ask)));
        permissions.push({ tool: ask.tool, decision, waitedMs: Date.now() - askedAt });
        return decision;
      },
    };

    let outcome = 'not_dispatched';
    let runStartedAt = Date.now();
    if (started === undefined) {
      console.error(`the dispatcher did not start the run: ${JSON.stringify(tick.decisions)}`);
    } else {
      const loaded = await deps.definitions.load('operator-run-repo');
      if (!loaded.ok) throw new Error('definitions did not load');
      const role = loaded.value.roles.find((candidate) => candidate.id === 'operator');
      const worktree = await deps.worktrees.ensure('operator-run-repo', opened.value);
      if (role === undefined || !worktree.ok) throw new Error('the run could not be prepared (role or worktree)');
      console.log('[operator-run] started — waiting for the run…');
      runStartedAt = Date.now();
      const result = await app.executeRun(deps, gate, {
        item: started,
        role,
        prompt: PROMPT,
        cwd: worktree.value.path,
        capabilities: [],
      });
      outcome =
        result.kind === 'finished'
          ? result.outcome
          : result.kind === 'transport_error'
            ? `transport_error:${result.error.code}`
            : result.kind === 'refused'
              ? result.error
              : 'limit';
    }

    const runs = await deps.runs.listForWorkOrder(opened.value);
    const run = runs[runs.length - 1];
    const events = run === undefined ? [] : await deps.runs.events(run.id);
    const date = new Date().toISOString().slice(0, 10);
    const summary = buildSummary({
      date,
      provider: def.id,
      routeKind: routeKind.id,
      model: options.model,
      effort: options.effort,
      version: discovered.version,
      discoveredLoggedIn: discovered.loggedIn,
      events,
      startedAt: run?.startedAt ?? runStartedAt,
      permissions,
      canary: options.canary,
      outcome,
    });

    const outDir = join(homedir(), 'source', 'docket-tasarim', 'operator-runs');
    mkdirSync(outDir, { recursive: true });
    const file = join(outDir, summaryFileName(date, def.id, (name) => existsSync(join(outDir, name))));
    writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`);
    console.log(['', ...summaryLines(summary), '', `written to ${file}`].join('\n'));
  } finally {
    cleanup();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`operator-run failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
