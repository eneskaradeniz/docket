// cli-command live model list tests (P-29 section 3, source 'cli-command'). The provider runs as
// a scripted fake binary through the real child-process machinery (usage-probe style); the output
// fixture is the recorded `agy models` answer of the installed CLI (1.2.14): fourteen
// tab-separated rows of model id and display name, no header, progress noise on stderr, exit 0.
// Above all the tests pin that the listing is a plain subcommand run — never a print-mode prompt,
// so no agent turn starts and no quota is spent.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../application/index';
import type { LiveModel } from '../../../domain/index';
import { parseUlid, type AccountId } from '../../../domain/index';
import { listCliCommandRouteModels, parseCliModelsOutput, parseKiroModelsOutput, type CliModelSpawn } from './cli-command-catalog';

let root: string;
let sequence = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-cli-command-catalog-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function ulidOf(suffix: string): AccountId {
  const parsed = parseUlid<'account'>(`01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

const ACCOUNT: AccountId = ulidOf('AY');

const agyAccount = (overrides?: Partial<AccountRecord>): AccountRecord => ({
  id: ACCOUNT,
  provider: 'agy',
  label: 'main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...(overrides === undefined ? {} : overrides),
});

/** The recorded answer of `agy models` (CLI 1.2.14, 2026-10-02): fourteen rows, id TAB display
 * name, the effort variant parenthesised in the display name where the CLI states one. */
const AGY_MODELS_OUTPUT = [
  'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
  'gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)',
  'gemini-3.8-flash-low\tGemini 3.8 Flash (Low)',
  'gemini-3.7-flash-high\tGemini 3.7 Flash (High)',
  'gemini-3.7-flash-medium\tGemini 3.7 Flash (Medium)',
  'gemini-3.7-flash-low\tGemini 3.7 Flash (Low)',
  'gemini-3.6-flash-high\tGemini 3.6 Flash (High)',
  'gemini-3.6-flash-medium\tGemini 3.6 Flash (Medium)',
  'gemini-3.6-flash-low\tGemini 3.6 Flash (Low)',
  'gemini-3.1-pro-high\tGemini 3.1 Pro (High)',
  'gemini-3.1-pro-low\tGemini 3.1 Pro (Low)',
  'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
  'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
  'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\n');

const EXPECTED_ROWS: readonly LiveModel[] = [
  { id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', efforts: ['high'] },
  { id: 'gemini-3.8-flash-medium', displayName: 'Gemini 3.8 Flash (Medium)', efforts: ['medium'] },
  { id: 'gemini-3.8-flash-low', displayName: 'Gemini 3.8 Flash (Low)', efforts: ['low'] },
  { id: 'gemini-3.7-flash-high', displayName: 'Gemini 3.7 Flash (High)', efforts: ['high'] },
  { id: 'gemini-3.7-flash-medium', displayName: 'Gemini 3.7 Flash (Medium)', efforts: ['medium'] },
  { id: 'gemini-3.7-flash-low', displayName: 'Gemini 3.7 Flash (Low)', efforts: ['low'] },
  { id: 'gemini-3.6-flash-high', displayName: 'Gemini 3.6 Flash (High)', efforts: ['high'] },
  { id: 'gemini-3.6-flash-medium', displayName: 'Gemini 3.6 Flash (Medium)', efforts: ['medium'] },
  { id: 'gemini-3.6-flash-low', displayName: 'Gemini 3.6 Flash (Low)', efforts: ['low'] },
  { id: 'gemini-3.1-pro-high', displayName: 'Gemini 3.1 Pro (High)', efforts: ['high'] },
  { id: 'gemini-3.1-pro-low', displayName: 'Gemini 3.1 Pro (Low)', efforts: ['low'] },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6 (Thinking)' },
  { id: 'claude-opus-4-6-thinking', displayName: 'Claude Opus 4.6 (Thinking)' },
  { id: 'gpt-oss-120b-medium', displayName: 'GPT-OSS 120B (Medium)', efforts: ['medium'] },
];

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeout: number;
}

interface BinScript {
  readonly output?: string; // stdout text (default: the recorded table)
  readonly stderrNoise?: string; // progress noise printed to stderr
  readonly exit?: number; // exit code (default 0)
  readonly hang?: boolean; // never answer
}

const binBody = (script: BinScript): string => {
  if (script.hang === true) return 'exec /bin/sleep 30';
  const lines = [
    `cat <<'DOCKET_MODELS'\n${script.output ?? AGY_MODELS_OUTPUT}\nDOCKET_MODELS`,
    script.stderrNoise === undefined ? '' : `echo "${script.stderrNoise}" >&2`,
    `exit ${script.exit ?? 0}`,
  ];
  return lines.filter((line) => line !== '').join('\n');
};

const makeLister = (
  script: BinScript | undefined,
  options: { readonly timeoutMs?: number; readonly needsLogin?: true; readonly loggedIn?: boolean | null } = {},
): {
  readonly calls: SpawnCall[];
  readonly binPath: string | null;
  readonly list: (account?: AccountRecord) => ReturnType<typeof listCliCommandRouteModels>;
} => {
  sequence += 1;
  const binDir = join(root, `bin-${sequence}`);
  let binPath: string | null = null;
  if (script !== undefined) {
    mkdirSync(binDir, { recursive: true });
    binPath = join(binDir, 'agy');
    writeFileSync(binPath, `#!/bin/sh\n${binBody(script)}\n`);
    chmodSync(binPath, 0o755);
  }
  const calls: SpawnCall[] = [];
  const spawn: CliModelSpawn = (command, args, spawnOptions) => {
    calls.push({ command, args: [...args], timeout: spawnOptions.timeout });
    return nodeSpawn(command, [...args], { timeout: spawnOptions.timeout });
  };
  return {
    calls,
    binPath,
    list: (account = agyAccount()) =>
      listCliCommandRouteModels(account, {
        ...(binPath === null ? {} : { command: binPath }),
        spawn,
        ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
        ...(options.needsLogin === undefined ? {} : { needsLogin: options.needsLogin }),
        ...(options.loggedIn === undefined ? {} : { loggedIn: options.loggedIn }),
      }),
  };
};

describe('parseCliModelsOutput', () => {
  it('P-29: the recorded fourteen-model answer parses to one row per model — id and display name verbatim, the effort variant where the name states a level', () => {
    expect(parseCliModelsOutput(AGY_MODELS_OUTPUT)).toEqual({ ok: true, value: EXPECTED_ROWS });
  });

  it('P-29: an unknown extra column is ignored', () => {
    const result = parseCliModelsOutput('gemini-3.8-flash-high\tGemini 3.8 Flash (High)\ta column the parser does not know');
    expect(result).toEqual({
      ok: true,
      value: [{ id: 'gemini-3.8-flash-high', displayName: 'Gemini 3.8 Flash (High)', efforts: ['high'] }],
    });
  });

  it('P-29: a row without a display name stays a row — the display name is optional data', () => {
    expect(parseCliModelsOutput('gemini-x')).toEqual({ ok: true, value: [{ id: 'gemini-x' }] });
  });

  it('P-29: a duplicate id is listed once', () => {
    const result = parseCliModelsOutput('gemini-x\tGemini X (High)\ngemini-x\tGemini X (High)');
    expect(result).toEqual({ ok: true, value: [{ id: 'gemini-x', displayName: 'Gemini X (High)', efforts: ['high'] }] });
  });

  it('P-29: a carriage return at the row end does not reach the display name', () => {
    expect(parseCliModelsOutput('gemini-x\tGemini X (High)\r\n')).toEqual({
      ok: true,
      value: [{ id: 'gemini-x', displayName: 'Gemini X (High)', efforts: ['high'] }],
    });
  });

  it('P-29: a level word the domain knows maps, including levels the current list does not print', () => {
    expect(parseCliModelsOutput('gemini-x\tGemini X (Max)')).toEqual({
      ok: true,
      value: [{ id: 'gemini-x', displayName: 'Gemini X (Max)', efforts: ['max'] }],
    });
  });

  it('P-29: empty output is an error naming the shape problem, never the output itself', () => {
    const result = parseCliModelsOutput('');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ code: 'malformed', message: 'the models output carries no model rows' });
  });

  it('P-29: prose where a table row belongs is an error naming the shape problem, never the prose', () => {
    const result = parseCliModelsOutput('Fetching available models, please wait');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('malformed');
    expect(result.error.message).not.toContain('Fetching');
    expect(result.error.message).not.toContain('please wait');
  });

  it('P-29: a row whose first field is empty is an error — no model id, no row', () => {
    const result = parseCliModelsOutput('\tGemini X (High)');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error.code).toBe('malformed');
  });
});

describe('listCliCommandRouteModels', () => {
  it('P-29: runs the CLI models subcommand — a plain listing, never a print-mode prompt or an agent turn', async () => {
    const { calls, binPath, list } = makeLister({});
    if (binPath === null) throw new Error('fixture binary missing');

    const result = await list();

    expect(result).toEqual({ ok: true, value: EXPECTED_ROWS });
    expect(calls).toEqual([{ command: binPath, args: ['models'], timeout: 15_000 }]);
  });

  it('P-29: progress noise on stderr is ignored — the table is read from stdout', async () => {
    const { list } = makeLister({ stderrNoise: 'Fetching available models...' });
    expect(await list()).toEqual({ ok: true, value: EXPECTED_ROWS });
  });

  it('P-29: a non-zero exit fails the listing before any parsing', async () => {
    const { list } = makeLister({ exit: 3 });
    const result = await list();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ code: 'spawn_failed', message: 'the models command failed before printing a model list' });
  });

  it('P-29: a command that never answers is killed at the injected timeout', async () => {
    const { list } = makeLister({ hang: true }, { timeoutMs: 200 });
    const result = await list();
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ code: 'timeout', message: 'the models command did not answer in time' });
  });

  it('P-29: a binary that cannot be started reports not_installed', async () => {
    const result = await listCliCommandRouteModels(agyAccount(), {
      command: join(root, 'never-written-agy'),
      spawn: nodeSpawn,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toEqual({ code: 'not_installed', message: 'the models command could not be started' });
  });

  it('P-29: a provider with no models command is unsupported and spawns nothing', async () => {
    const spawn: CliModelSpawn = () => {
      throw new Error('must not spawn');
    };
    const result = await listCliCommandRouteModels(agyAccount({ provider: 'codex' }), { spawn });
    expect(result).toEqual({ ok: false, error: { code: 'unsupported', message: 'the provider has no model-listing command' } });
  });
});

describe('level names (P-43)', () => {
  it('P-43: the effort word in a display name is read back through the level names', () => {
    const parsed = parseCliModelsOutput('m-1\tModel One (Off)\nm-2\tModel Two (High)\nm-3\tModel Three (Thinking)\n', { none: 'off' });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.value.map((row) => row.efforts)).toEqual([['none'], undefined, undefined]);
  });
});

describe('login-gated listing (P-45)', () => {
  it('P-45: a needsLogin command is not run while the login probe answered false or null, so the catalog falls back to bundled data', async () => {
    for (const loggedIn of [false, null, undefined] as const) {
      const lister = makeLister({}, { needsLogin: true, ...(loggedIn === undefined ? {} : { loggedIn }) });

      const result = await lister.list();

      expect(result.ok, String(loggedIn)).toBe(false);
      expect(lister.calls, String(loggedIn)).toEqual([]);
    }
  });

  it('P-45: a needsLogin command runs once the login probe answered true', async () => {
    const lister = makeLister({}, { needsLogin: true, loggedIn: true });

    const result = await lister.list();

    expect(result).toEqual({ ok: true, value: EXPECTED_ROWS });
    expect(lister.calls).toHaveLength(1);
  });

  it('P-45: an unmarked command runs whatever the login probe said', async () => {
    const lister = makeLister({}, { loggedIn: false });

    const result = await lister.list();

    expect(result.ok).toBe(true);
    expect(lister.calls).toHaveLength(1);
  });
});

describe('kiro models command (P-29, P-45)', () => {
  // The recorded live answer of `kiro-cli chat --list-models -f json` (CLI 2.27.0, 2026-10-02,
  // operator-logged-in run): one JSON object, nine rows, `auto` the default alias row of a
  // router. The ids, context windows and multipliers are the recorded values; the display-name
  // strings reproduce the schema's field, whose verbatim values the recording does not carry.
  const KIRO_MODELS_OUTPUT = JSON.stringify({
    models: [
      { model_name: 'Auto', description: 'Automatically selects the best model', model_id: 'auto', context_window_tokens: 1000000, rate_multiplier: 1.0, rate_unit: 'Credit' },
      { model_name: 'Claude Sonnet 4.5', description: 'Anthropic Claude Sonnet 4.5', model_id: 'claude-sonnet-4.5', context_window_tokens: 200000, rate_multiplier: 1.3, rate_unit: 'Credit' },
      { model_name: 'Claude Sonnet 4', description: '[EOL] 14 October 2026', model_id: 'claude-sonnet-4', context_window_tokens: 200000, rate_multiplier: 1.3, rate_unit: 'Credit' },
      { model_name: 'Claude Haiku 4.5', description: 'Anthropic Claude Haiku 4.5', model_id: 'claude-haiku-4.5', context_window_tokens: 200000, rate_multiplier: 0.4, rate_unit: 'Credit' },
      { model_name: 'DeepSeek 3.2', description: 'DeepSeek V3.2', model_id: 'deepseek-3.2', context_window_tokens: 163840, rate_multiplier: 0.25, rate_unit: 'Credit' },
      { model_name: 'MiniMax M2.5', description: 'MiniMax M2.5', model_id: 'minimax-m2.5', context_window_tokens: 200000, rate_multiplier: 0.25, rate_unit: 'Credit' },
      { model_name: 'MiniMax M2.1', description: 'MiniMax M2.1', model_id: 'minimax-m2.1', context_window_tokens: 200000, rate_multiplier: 0.15, rate_unit: 'Credit' },
      { model_name: 'GLM 5', description: 'GLM 5', model_id: 'glm-5', context_window_tokens: 200000, rate_multiplier: 0.5, rate_unit: 'Credit' },
      { model_name: 'Qwen3 Coder Next', description: 'Qwen3 Coder Next', model_id: 'qwen3-coder-next', context_window_tokens: 256000, rate_multiplier: 0.05, rate_unit: 'Credit' },
    ],
    default_model: 'auto',
  });

  const kiroAccount = (): AccountRecord => ({ ...agyAccount(), provider: 'kiro' });

  it('P-29: the recorded nine-model answer parses to one row per model, the id verbatim, the name as display name, and only the default row marked', () => {
    const parsed = parseKiroModelsOutput(KIRO_MODELS_OUTPUT);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('unreachable');
    expect(parsed.value.map((row) => row.id)).toEqual([
      'auto',
      'claude-sonnet-4.5',
      'claude-sonnet-4',
      'claude-haiku-4.5',
      'deepseek-3.2',
      'minimax-m2.5',
      'minimax-m2.1',
      'glm-5',
      'qwen3-coder-next',
    ]);
    expect(parsed.value[0]).toEqual({ id: 'auto', displayName: 'Auto', isDefault: true });
    expect(parsed.value[1]).toEqual({ id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5' });
    // The list carries no effort field, so no row states levels, and the credit multiplier is
    // never read as a price: no row carries a billing.
    for (const row of parsed.value) {
      expect(row.efforts).toBeUndefined();
      expect(row.billing).toBeUndefined();
    }
  });

  it('P-29: a duplicate id is listed once, and a default naming no row marks none', () => {
    const duplicate = parseKiroModelsOutput(
      JSON.stringify({
        models: [
          { model_name: 'A', model_id: 'm-1', context_window_tokens: 1000, rate_multiplier: 1, rate_unit: 'Credit' },
          { model_name: 'A again', model_id: 'm-1', context_window_tokens: 1000, rate_multiplier: 1, rate_unit: 'Credit' },
          { model_name: 'B', model_id: 'm-2', context_window_tokens: 1000, rate_multiplier: 1, rate_unit: 'Credit' },
        ],
        default_model: 'm-x',
      }),
    );
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) throw new Error('unreachable');
    expect(duplicate.value.map((row) => [row.id, row.isDefault])).toEqual([['m-1', undefined], ['m-2', undefined]]);
  });

  it('P-29: prose, an empty list, a row without an id and a missing name field are shape problems named without quoting the output', () => {
    for (const output of ['Opening auth portal…', '{}', '{"models":[]}', '{"models":[{"model_name":"No id"}]}']) {
      const parsed = parseKiroModelsOutput(output);
      expect(parsed.ok, output).toBe(false);
      if (parsed.ok) throw new Error('unreachable');
      expect(parsed.error.code, output).toBe('malformed');
      expect(parsed.error.message, output).not.toMatch(/Opening auth|No id/);
    }
  });

  it('P-45: the kiro command is marked needsLogin, so the listing never runs unless the login probe answered true', async () => {
    for (const loggedIn of [false, null, undefined] as const) {
      const lister = makeLister({ output: KIRO_MODELS_OUTPUT }, { ...(loggedIn === undefined ? {} : { loggedIn }) });

      const result = await lister.list(kiroAccount());

      expect(result.ok, String(loggedIn)).toBe(false);
      expect(lister.calls, String(loggedIn)).toEqual([]);
    }

    const lister = makeLister({ output: KIRO_MODELS_OUTPUT }, { loggedIn: true });
    const result = await lister.list(kiroAccount());

    expect(result.ok).toBe(true);
    expect(lister.calls).toEqual([{ command: lister.binPath ?? '', args: ['chat', '--list-models', '-f', 'json'], timeout: expect.any(Number) }]);
  });
});
