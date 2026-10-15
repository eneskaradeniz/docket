// Pure-writer tests for the agy .agents delivery (docs/v2/providers.md → "agy run-scoped delivery
// (P-62)" and "agy before_tool wrapper (P-64)"). Every assertion pins the measured surface from
// probe #1015 (spike-agy5/6): the hooks.json schema (one invalid entry silently disables the
// whole file, so the writer must emit exactly the proven shapes), the always_on rules frontmatter,
// stdio-only MCP and the path-plugin bundle — plus the P-64/I-108 machinery: the per-run hook
// launcher files, the single PreToolUse entry and the ask configuration file. No real agy CLI is
// involved; the transport-level legs live in stream-json.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseSlug } from '../../../../domain/index';
import { prepareAgyDelivery, type AgyDeliveryCapability } from './agy-delivery';

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

let root: string;
let dirCount = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-agy-delivery-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const nextDir = (): string => {
  dirCount += 1;
  const dir = join(root, `case-${dirCount}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** A single-file source the delivery must rewrite as skills/<name>/SKILL.md (or a rules file). */
const writeSource = (dir: string, name: string, body: string): string => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};

/** A path-plugin bundle: a directory the delivery copies and completes with a root plugin.json. */
const writePluginSource = (dir: string): string => {
  const path = join(dir, 'plugin-source');
  mkdirSync(join(path, 'hooks'), { recursive: true });
  writeFileSync(join(path, 'hooks', 'marker.txt'), 'plugin payload');
  return path;
};

// Commands in the launcher-body form: the command line runs inside the launcher's /bin/sh, so
// shell syntax is deliverable (the P-62 refusal is lifted by the launcher files).
const AFTER_TOOL_COMMAND = 'node "/tmp/probe/after-tool.mjs" "/tmp/probe/args.json"';
const AFTER_WRITE_COMMAND = 'node "/tmp/probe/after-write.mjs"';
const RUN_END_COMMAND = 'node "/tmp/probe/run-end.mjs"';
const BEFORE_TOOL_COMMAND = 'node "/tmp/probe/before-tool.mjs"';
const BEFORE_TOOL_DENY_COMMAND = 'node "/tmp/probe/guard.mjs" --deny >> "/tmp/probe/guard.log"';

const SOCKET_PATH = '/home/u/.docket/run/mcp.sock';
const RUN_TOKEN = '01ARZ3NDEKTSV4RRFFQ69G5FBV-run';
const EXEC_PATH = '/opt/Docket/docket';
const MCP_SCRIPT = '/opt/Docket/resources/app/dist-electron/docket-mcp.cjs';

/** The built-in Docket capability as mcp-attach delivers it: the run's only in-band source of the
 * ask child's executable, script directory, socket path and token. */
const docketPagesCapability = (): AgyDeliveryCapability => ({
  kind: 'mcp',
  id: slugOf<'capability'>('docket-pages'),
  name: 'Docket pages',
  command: EXEC_PATH,
  args: [MCP_SCRIPT],
  env: { DOCKET_MCP_SOCKET: SOCKET_PATH, DOCKET_MCP_TOKEN: RUN_TOKEN, ELECTRON_RUN_AS_NODE: '1' },
});

const fullCapabilities = (dir: string): readonly AgyDeliveryCapability[] => [
  docketPagesCapability(),
  {
    kind: 'mcp',
    id: slugOf<'capability'>('mcp-probe'),
    name: 'Probe MCP',
    command: 'node',
    args: ['server.cjs', '--stdio'],
    env: { PROBE_TOKEN: 'literal-value' },
  },
  {
    kind: 'skill',
    id: slugOf<'capability'>('skill-single'),
    name: 'Single File Skill',
    path: writeSource(dir, 'probe-skill.md', '# single-file skill body\n'),
  },
  {
    kind: 'hook',
    id: slugOf<'capability'>('a-after-tool'),
    name: 'after tool',
    event: 'after_tool',
    command: AFTER_TOOL_COMMAND,
  },
  {
    kind: 'hook',
    id: slugOf<'capability'>('b-after-write'),
    name: 'after write',
    event: 'after_write',
    command: AFTER_WRITE_COMMAND,
  },
  {
    kind: 'hook',
    id: slugOf<'capability'>('c-run-end'),
    name: 'run end',
    event: 'run_end',
    command: RUN_END_COMMAND,
  },
  {
    kind: 'hook',
    id: slugOf<'capability'>('d-before-tool'),
    name: 'before tool',
    event: 'before_tool',
    command: BEFORE_TOOL_COMMAND,
  },
  {
    kind: 'context',
    id: slugOf<'capability'>('ctx-probe'),
    name: 'Probe context',
    path: writeSource(dir, 'probe-context.md', 'context body line\n'),
  },
  {
    kind: 'plugin',
    id: slugOf<'capability'>('plugin-probe'),
    name: 'probe plugin',
    path: writePluginSource(dir),
  },
];

const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

const readJson = async (path: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;

describe('prepareAgyDelivery', () => {
  it('P-62: agy delivery writes the .agents tree', async () => {
    const dir = nextDir();
    const configDir = join(dir, 'config');

    const agentsDir = await prepareAgyDelivery(configDir, fullCapabilities(dir));

    expect(agentsDir).toBe(join(configDir, '.agents'));
    const mcp = await readJson(join(agentsDir, 'mcp_config.json'));
    expect(mcp['mcpServers']).toMatchObject({
      'mcp-probe': { command: 'node', args: ['server.cjs', '--stdio'], env: { PROBE_TOKEN: 'literal-value' } },
    });
    // A single-file skill lands as skills/<name>/SKILL.md with its body, no frontmatter added.
    expect(await readFile(join(agentsDir, 'skills', 'Single-File-Skill', 'SKILL.md'), 'utf8')).toBe(
      '# single-file skill body\n',
    );
    // A path plugin is copied and carries the proven root manifest.
    expect(await readFile(join(agentsDir, 'plugins', 'probe-plugin', 'hooks', 'marker.txt'), 'utf8')).toBe(
      'plugin payload',
    );
    expect(await readJson(join(agentsDir, 'plugins', 'probe-plugin', 'plugin.json'))).toEqual({
      name: 'probe-plugin',
    });
    // The wrapper entry exists from this issue on, so hooks.json is always part of the tree.
    expect(await readJson(join(agentsDir, 'hooks.json'))).toHaveProperty('PreToolUse');
  });

  it('P-62: Stop entry is a direct list without matcher', async () => {
    const dir = nextDir();

    const agentsDir = await prepareAgyDelivery(join(dir, 'config'), fullCapabilities(dir));

    const hooks = await readJson(join(agentsDir, 'hooks.json'));
    // Stop is a direct command list — no matcher, no hooks wrapper (the wrapper disables the
    // whole file silently; probe #1015 root cause). Every command is the quoted absolute path of
    // a per-run launcher file, never the user's command line itself.
    const stop = hooks['Stop'] as { type: string; command: string }[];
    expect(stop).toEqual([{ type: 'command', command: JSON.stringify(join(agentsDir, 'hooks', 'c-run-end.sh')) }]);
    expect(stop[0]).not.toHaveProperty('matcher');
    expect(stop[0]).not.toHaveProperty('hooks');
    expect(await readFile(join(agentsDir, 'hooks', 'c-run-end.sh'), 'utf8')).toBe(
      `#!/bin/sh\n${RUN_END_COMMAND}\n`,
    );
    // PreToolUse/PostToolUse take { matcher?, hooks: [...] }; after_tool has no matcher,
    // after_write carries the write-tool matcher, and before_tool is no entry of its own.
    expect(hooks['PostToolUse']).toEqual([
      { hooks: [{ type: 'command', command: JSON.stringify(join(agentsDir, 'hooks', 'a-after-tool.sh')) }] },
      {
        matcher: 'write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit',
        hooks: [{ type: 'command', command: JSON.stringify(join(agentsDir, 'hooks', 'b-after-write.sh')) }],
      },
    ]);
    expect(await readFile(join(agentsDir, 'hooks', 'b-after-write.sh'), 'utf8')).toBe(
      `#!/bin/sh\n${AFTER_WRITE_COMMAND}\n`,
    );
    expect(JSON.stringify(hooks)).not.toContain(BEFORE_TOOL_COMMAND);
  });

  it('P-62: rules file carries always_on frontmatter', async () => {
    const dir = nextDir();

    const agentsDir = await prepareAgyDelivery(join(dir, 'config'), fullCapabilities(dir));

    // Without valid frontmatter agy silently discards the file, so the trigger block is asserted
    // verbatim, not just as a prefix hint.
    expect(await readFile(join(agentsDir, 'rules', 'ctx-probe.md'), 'utf8')).toBe(
      '---\ntrigger: always_on\n---\n\ncontext body line\n',
    );
  });

  it('P-62: a hook command with shell syntax is delivered through a launcher file', async () => {
    const dir = nextDir();
    const command = 'node /tmp/probe/hook.mjs >> /tmp/probe/log.txt';
    const capabilities: readonly AgyDeliveryCapability[] = [
      docketPagesCapability(),
      {
        kind: 'hook',
        id: slugOf<'capability'>('hook-pipe'),
        name: 'pipe hook',
        event: 'run_end',
        command,
      },
    ];

    const agentsDir = await prepareAgyDelivery(join(dir, 'config'), capabilities);

    // The refusal P-62 used to raise is gone: the command line runs inside the launcher's shell,
    // so pipes, redirection and && reach agy as one executable file.
    const hooks = await readJson(join(agentsDir, 'hooks.json'));
    expect(hooks['Stop']).toEqual([
      { type: 'command', command: JSON.stringify(join(agentsDir, 'hooks', 'hook-pipe.sh')) },
    ]);
    expect(await readFile(join(agentsDir, 'hooks', 'hook-pipe.sh'), 'utf8')).toBe(`#!/bin/sh\n${command}\n`);
    expect(await modeOf(join(agentsDir, 'hooks', 'hook-pipe.sh'))).toBe(0o755);
    // hooks.json itself still carries no shell syntax — only quoted launcher paths.
    expect(JSON.stringify(hooks['Stop'])).not.toMatch(/>>|\|\||&&/u);
  });

  it('P-64: hooks.json carries exactly one PreToolUse entry', async () => {
    const dir = nextDir();
    const configDir = join(dir, 'config');
    const capabilities: readonly AgyDeliveryCapability[] = [
      docketPagesCapability(),
      {
        kind: 'hook',
        id: slugOf<'capability'>('guard-one'),
        name: 'guard one',
        event: 'before_tool',
        command: BEFORE_TOOL_COMMAND,
      },
      {
        kind: 'hook',
        id: slugOf<'capability'>('guard-two'),
        name: 'guard two',
        event: 'before_tool',
        command: BEFORE_TOOL_DENY_COMMAND,
      },
    ];

    const agentsDir = await prepareAgyDelivery(configDir, capabilities);

    // One entry, matcher .*, one command whose only argument is the ask launcher — the wrapper
    // decides, so no second PreToolUse can let an auto_approve outvote a deny.
    const hooks = await readJson(join(agentsDir, 'hooks.json'));
    expect(hooks['PreToolUse']).toEqual([
      {
        matcher: '.*',
        hooks: [{ type: 'command', command: JSON.stringify(join(agentsDir, 'hooks', 'docket-ask.sh')), timeout: 3600 }],
      },
    ]);
    const launcher = await readFile(join(agentsDir, 'hooks', 'docket-ask.sh'), 'utf8');
    expect(launcher).toBe(
      `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 "${EXEC_PATH}" "${join(
        dirnameOf(MCP_SCRIPT),
        'docket-agy-ask.cjs',
      )}" "${configDir}"\n`,
    );
    expect(await modeOf(join(agentsDir, 'hooks', 'docket-ask.sh'))).toBe(0o755);

    // The user's before_tool commands and the channel secrets live only in the 0600 ask file —
    // never in hooks.json, never in the launcher (no argv or env of the child).
    const askFile = await readJson(join(agentsDir, '.docket-ask.json'));
    expect(askFile).toEqual({
      socketPath: SOCKET_PATH,
      token: RUN_TOKEN,
      timeoutSeconds: 3600,
      beforeTool: [BEFORE_TOOL_COMMAND, BEFORE_TOOL_DENY_COMMAND],
      bridge: true,
    });
    expect(await modeOf(join(agentsDir, '.docket-ask.json'))).toBe(0o600);
    const hooksText = await readFile(join(agentsDir, 'hooks.json'), 'utf8');
    for (const secret of [BEFORE_TOOL_COMMAND, BEFORE_TOOL_DENY_COMMAND, RUN_TOKEN, SOCKET_PATH]) {
      expect(hooksText).not.toContain(secret);
      expect(launcher).not.toContain(secret);
    }

    // The entry exists even with no before_tool hooks and no channel: the wrapper then prints the
    // neutral allow, and the entry count a run started with is the entry count it keeps.
    const bare = nextDir();
    const bareAgents = await prepareAgyDelivery(join(bare, 'config'), []);
    const bareHooks = await readJson(join(bareAgents, 'hooks.json'));
    expect(bareHooks['PreToolUse']).toHaveLength(1);
    const bareAsk = await readJson(join(bareAgents, '.docket-ask.json'));
    expect(bareAsk).toMatchObject({ beforeTool: [], bridge: false, timeoutSeconds: 3600 });
  });
});

/** dirname for fixtures (the production spelling lives in the delivery). */
const dirnameOf = (path: string): string => path.split('/').slice(0, -1).join('/');
