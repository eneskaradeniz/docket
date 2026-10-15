// Pure-writer tests for the agy .agents delivery (docs/v2/providers.md → "agy run-scoped delivery
// (P-62)"). Every assertion pins the measured surface from probe #1015 (spike-agy5/6): the
// hooks.json schema (one invalid entry silently disables the whole file, so the writer must emit
// exactly the proven shapes), the always_on rules frontmatter, stdio-only MCP and the path-plugin
// bundle. No real agy CLI is involved; the transport-level legs live in stream-json.test.ts.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
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

// Commands in the proven no-shell form (probe #1015: `node "<abs script>" "<abs arg>"`).
const AFTER_TOOL_COMMAND = 'node "/tmp/probe/after-tool.mjs" "/tmp/probe/args.json"';
const AFTER_WRITE_COMMAND = 'node "/tmp/probe/after-write.mjs"';
const RUN_END_COMMAND = 'node "/tmp/probe/run-end.mjs"';
const BEFORE_TOOL_COMMAND = 'node "/tmp/probe/before-tool.mjs"';

const fullCapabilities = (dir: string): readonly AgyDeliveryCapability[] => [
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

describe('prepareAgyDelivery', () => {
  it('P-62: agy delivery writes the .agents tree', async () => {
    const dir = nextDir();
    const configDir = join(dir, 'config');

    const agentsDir = await prepareAgyDelivery(configDir, fullCapabilities(dir));

    expect(agentsDir).toBe(join(configDir, '.agents'));
    const mcp = JSON.parse(await readFile(join(agentsDir, 'mcp_config.json'), 'utf8'));
    expect(mcp).toEqual({
      mcpServers: { 'mcp-probe': { command: 'node', args: ['server.cjs', '--stdio'], env: { PROBE_TOKEN: 'literal-value' } } },
    });
    // A single-file skill lands as skills/<name>/SKILL.md with its body, no frontmatter added.
    expect(await readFile(join(agentsDir, 'skills', 'Single-File-Skill', 'SKILL.md'), 'utf8')).toBe(
      '# single-file skill body\n',
    );
    // A path plugin is copied and carries the proven root manifest.
    expect(await readFile(join(agentsDir, 'plugins', 'probe-plugin', 'hooks', 'marker.txt'), 'utf8')).toBe(
      'plugin payload',
    );
    expect(JSON.parse(await readFile(join(agentsDir, 'plugins', 'probe-plugin', 'plugin.json'), 'utf8'))).toEqual({
      name: 'probe-plugin',
    });
    expect(JSON.parse(await readFile(join(agentsDir, 'hooks.json'), 'utf8'))).toHaveProperty('PostToolUse');
  });

  it('P-62: Stop entry is a direct list without matcher', async () => {
    const dir = nextDir();

    const agentsDir = await prepareAgyDelivery(join(dir, 'config'), fullCapabilities(dir));

    const hooks = JSON.parse(await readFile(join(agentsDir, 'hooks.json'), 'utf8'));
    // Stop is a direct command list — no matcher, no hooks wrapper (the wrapper disables the
    // whole file silently; probe #1015 root cause).
    expect(hooks.Stop).toEqual([{ type: 'command', command: RUN_END_COMMAND }]);
    expect(hooks.Stop[0]).not.toHaveProperty('matcher');
    expect(hooks.Stop[0]).not.toHaveProperty('hooks');
    // PreToolUse/PostToolUse take { matcher?, hooks: [...] }; after_tool has no matcher,
    // after_write carries the write-tool matcher, and before_tool is not delivered at all.
    expect(hooks.PostToolUse).toEqual([
      { hooks: [{ type: 'command', command: AFTER_TOOL_COMMAND }] },
      {
        matcher: 'write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit',
        hooks: [{ type: 'command', command: AFTER_WRITE_COMMAND }],
      },
    ]);
    expect(hooks).not.toHaveProperty('PreToolUse');
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

  it('P-62: hook commands contain no shell syntax', async () => {
    const dir = nextDir();
    const agentsDir = await prepareAgyDelivery(join(dir, 'config'), fullCapabilities(dir));

    // Every command agy would exec without a shell stays inside the proven form: no redirection,
    // pipes, &&, ;, backticks or substitution.
    const hooks = JSON.parse(await readFile(join(agentsDir, 'hooks.json'), 'utf8')) as {
      PostToolUse?: { hooks: { command: string }[] }[];
      Stop?: { command: string }[];
    };
    const commands = [
      ...(hooks.PostToolUse ?? []).flatMap((entry) => entry.hooks.map((hook) => hook.command)),
      ...(hooks.Stop ?? []).map((entry) => entry.command),
    ];
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) {
      expect(command).not.toMatch(/&&|\|\||[|<>;`]|\$\(/u);
    }
    // A command that needs a shell is refused at delivery preparation — the transport turns the
    // throw into a typed start error instead of writing a hook that breaks silently.
    const withPipe = nextDir();
    await expect(
      prepareAgyDelivery(join(withPipe, 'config'), [
        {
          kind: 'hook',
          id: slugOf<'capability'>('hook-pipe'),
          name: 'pipe hook',
          event: 'run_end',
          command: 'node /tmp/probe/hook.mjs >> /tmp/probe/log.txt',
        },
      ]),
    ).rejects.toThrow(/shell syntax/u);
  });
});
