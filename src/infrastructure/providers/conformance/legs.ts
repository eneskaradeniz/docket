// Wiring for the conformance suite: one leg per built-in definition, built exactly as the
// composition root builds it — the real transport factory over the real definition — with the
// transport's scripted fake standing in for the CLI. A spawned fake is reached through a tiny
// shell wrapper that records what the definition's own launch produced (argv, pid) and then
// execs the fake, so the definition's real argument builder is exercised without a vendor CLI.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AccountRecord, RunHandle, RunRequest } from '../../../application/index';
import {
  parseSlug,
  parseUlid,
  type AccountId,
  type RoleDef,
  type RunId,
} from '../../../domain/index';
import { createSystemClock } from '../../system/index';
import type { ProviderDef, ProviderTransport } from '../defs/index';
import { createProviderTransportFactory } from '../discovery/transport-factory';
import { createSdkFake, type SdkFake } from './sdk-fake';

export type ScenarioId = 'launch' | 'mapping' | 'permission' | 'resume' | 'stop' | 'watchdog';

/** The scripted behaviours a fake can play, named once for every transport. */
export type FakeScenario = 'happy' | 'permission' | 'resume' | 'hang' | 'steady';

export const PROMPT_SENTINEL = 'PROMPT-SENTINEL-7f3a91 implement the thing';

/** Short timeouts for the watchdog scenario: a steady stream outlasts them, no gap approaches them. */
export const WATCHDOG_MS = 1000;

const FIXTURES = {
  acp: fileURLToPath(new URL('../transports/acp/fake-agent.cjs', import.meta.url)),
  'app-server': fileURLToPath(new URL('../transports/app-server/fixtures/fake-app-server.cjs', import.meta.url)),
} as const;

// A stream-json fake speaks exactly one dialect, so the fixture is keyed by the dialect id, not
// the transport; each dialect lands with its own scripted CLI.
const STREAM_JSON_FIXTURES: Readonly<Record<string, string>> = {
  agy: fileURLToPath(new URL('../transports/stream-json/fixtures/fake-agy-cli.cjs', import.meta.url)),
};

/** What each spawned transport's fake calls each scripted behaviour. */
const FAKE_SCENARIOS: Readonly<
  Record<'acp' | 'app-server' | 'stream-json', Readonly<Record<FakeScenario, string>>>
> = {
  acp: { happy: 'happy', permission: 'permission', resume: 'load-ok', hang: 'hang', steady: 'steady' },
  'app-server': { happy: 'tools', permission: 'approval', resume: 'happy', hang: 'steer', steady: 'steady' },
  'stream-json': { happy: 'happy', permission: 'happy', resume: 'happy', hang: 'hang', steady: 'steady' },
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const RUN_ID: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ACCOUNT_ID: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'Follow the work order exactly.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

export interface LegRun {
  readonly handle: RunHandle;
  /** The arguments the process was launched with; undefined for the in-process leg. */
  readonly argv: () => readonly string[] | undefined;
  /** Everything the launch itself carried (argv, or the SDK options) as one text. */
  readonly launchText: () => string;
  /** Everything the fake received from the transport: protocol log, stdin lines or prompt stream. */
  readonly received: () => string;
  /** True when the session ref reached the launch itself (argv entry, SDK option). */
  readonly resumeInLaunch: (sessionRef: string) => boolean;
  /** True once nothing of the run is left: every process of the group, or the aborted session. */
  readonly gone: () => Promise<boolean>;
}

export interface Leg {
  readonly def: ProviderDef;
  readonly start: (scenario: FakeScenario, options?: { readonly resume?: string; readonly def?: ProviderDef }) => Promise<LegRun>;
}

const readText = (path: string): string => (existsSync(path) ? readFileSync(path, 'utf8') : '');

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const pidsIn = (dir: string): readonly number[] =>
  ['pid.txt', 'child.txt']
    .map((name) => Number.parseInt(readText(join(dir, name)).trim(), 10))
    .filter((pid) => Number.isInteger(pid) && pid > 0);

/** The shell wrapper a spawned fake runs behind: records the definition's argv and the pids of the
 * process and of a background child in the same group, then execs the fake under its scenario. */
const writeWrapper = (dir: string, fixture: string, scenario: string, logPath: string): string => {
  const wrapper = join(dir, 'bin.sh');
  const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(
    wrapper,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > ${quote(join(dir, 'argv.txt'))}`,
      `echo $$ > ${quote(join(dir, 'pid.txt'))}`,
      // A stand-in for a tool subprocess: stop must take the whole group down, not just the leader.
      'sleep 300 </dev/null >/dev/null 2>&1 &',
      `echo $! > ${quote(join(dir, 'child.txt'))}`,
      `exec ${quote(process.execPath)} ${quote(fixture)} ${quote(scenario)} ${quote(logPath)} "$@"`,
      '',
    ].join('\n'),
  );
  chmodSync(wrapper, 0o755);
  return wrapper;
};

const spawnedTransport = (transport: ProviderTransport): transport is 'acp' | 'app-server' | 'stream-json' =>
  transport === 'acp' || transport === 'app-server' || transport === 'stream-json';

/** The scripted fake a spawned definition runs against: per transport, per dialect for stream-json. */
const fixtureOf = (def: ProviderDef): string => {
  if (def.transport === 'stream-json') return STREAM_JSON_FIXTURES[def.streamDialect ?? ''];
  if (def.transport === 'acp' || def.transport === 'app-server') return FIXTURES[def.transport];
  throw new Error(`no scripted fake exists for transport "${def.transport}" of ${def.id}`);
};

/** True when a scripted fake exists for the definition's transport (and, for stream-json, its dialect). */
export const hasFake = (def: ProviderDef): boolean =>
  def.transport === 'sdk' ||
  def.transport === 'acp' ||
  def.transport === 'app-server' ||
  (def.transport === 'stream-json' && (def.streamDialect ?? '') in STREAM_JSON_FIXTURES);

export function createLegs(root: string, defs: readonly ProviderDef[]): readonly Leg[] {
  let runCount = 0;
  const clock = createSystemClock();

  const account = (def: ProviderDef): AccountRecord => ({
    id: ACCOUNT_ID,
    provider: def.id,
    label: `conformance ${def.id}`,
    authMode: 'subscription',
    limitPolicy: 'wait_resume',
    caps: [],
  });

  const resolverFor = (
    def: ProviderDef,
    binPath: string | null,
    query?: SdkFake['query'],
  ) =>
    createProviderTransportFactory({
      defs: [def],
      accounts: { get: async () => account(def) },
      secrets: { get: async () => undefined },
      clock,
      baseEnv: {},
      binPaths: { [def.id]: binPath },
      ...(query === undefined ? {} : { query }),
    });

  const requestOf = (cwd: string, resume: string | undefined): RunRequest => ({
    runId: RUN_ID,
    cwd,
    role: ROLE,
    route: { accountId: ACCOUNT_ID },
    prompt: PROMPT_SENTINEL,
    capabilities: [],
    ...(resume === undefined ? {} : { resume: { sessionRef: resume } }),
  });

  const nextDir = (): string => {
    runCount += 1;
    const dir = join(root, `run-${runCount}`);
    mkdirSync(dir, { recursive: true });
    return dir;
  };

  const start = async (
    resolver: ReturnType<typeof resolverFor>,
    request: RunRequest,
    defId: string,
  ): Promise<RunHandle> => {
    const transport = await resolver.forAccount(ACCOUNT_ID);
    if (transport === undefined) throw new Error(`no transport resolved for ${defId}`);
    const started = await transport.start(request);
    if (!started.ok) throw new Error(`${defId} did not start: ${started.error.code} ${started.error.message}`);
    return started.value;
  };

  return defs.map((def): Leg => {
    if (def.transport === 'sdk') {
      return {
        def,
        start: async (scenario, options) => {
          const dir = nextDir();
          const fake = createSdkFake(scenario);
          const effective = options?.def ?? def;
          const handle = await start(resolverFor(effective, null, fake.query), requestOf(dir, options?.resume), def.id);
          return {
            handle,
            argv: () => undefined,
            launchText: () => JSON.stringify(fake.options() ?? {}),
            received: () => fake.promptLog(),
            resumeInLaunch: (ref) => fake.options()?.resume === ref,
            gone: async () => fake.options()?.abortController?.signal.aborted === true,
          };
        },
      };
    }
    return {
      def,
      start: async (scenario, options) => {
        if (!spawnedTransport(def.transport)) {
          throw new Error(`no fake is wired for transport "${def.transport}" of ${def.id}; add one to conformance/legs.ts`);
        }
        const dir = nextDir();
        const logPath = join(dir, 'fake.log');
        const wrapper = writeWrapper(dir, fixtureOf(def), FAKE_SCENARIOS[def.transport][scenario], logPath);
        const effective = options?.def ?? def;
        const handle = await start(resolverFor(effective, wrapper), requestOf(dir, options?.resume), def.id);
        return {
          handle,
          argv: () => readText(join(dir, 'argv.txt')).split('\n').filter((line) => line !== ''),
          launchText: () => readText(join(dir, 'argv.txt')),
          received: () => readText(logPath),
          resumeInLaunch: (ref) => readText(join(dir, 'argv.txt')).split('\n').includes(ref),
          gone: async () => {
            for (let waited = 0; waited < 3000; waited += 50) {
              const pids = pidsIn(dir);
              if (pids.length > 0 && pids.every((pid) => !alive(pid))) return true;
              await sleep(50);
            }
            return false;
          },
        };
      },
    };
  });
}
