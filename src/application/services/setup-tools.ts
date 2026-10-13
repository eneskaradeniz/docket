// setup-tools.ts — Docket AI setup tools (docket_repo_analyze, docket_read_path, docket_setup_propose).
import type { Actor, LimitPolicy, RepoFlow } from '../../domain/index';
import { redactSecretShapes } from '../../domain/index';

import type { AppDeps } from '../ports';
import { createProjectSetupProposal, type SetupProposal } from '../use-cases/setup';

import { asArgs, fail, succeed, type DocketToolDefinition, type DocketToolResponse } from './docket-tool-types';
import {
  decideRead,
  normalizeAbsolutePath,
  redactSetupContent,
  type ReadContext,
  type ReadScope,
  SetupReadGrants,
} from './setup-permissions';

export const SETUP_README_LIMIT = 2_000;
export const SETUP_FILE_LIMIT = 8_000;
export const SETUP_DIR_LIMIT = 200;

export const SETUP_TOOL_NAMES: ReadonlySet<string> = new Set([
  'docket_repo_analyze',
  'docket_read_path',
  'docket_setup_propose',
]);

export const SETUP_TOOL_DEFINITIONS: readonly DocketToolDefinition[] = [
  {
    name: 'docket_repo_analyze',
    description: 'Summarize a repository folder: VCS hints, languages, package manager, common commands, docs root, CI files and a README excerpt.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'docket_read_path',
    description: 'Read a file excerpt or list a directory under the setup read scope. Out-of-scope paths return an ask result for the operator.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string' }, reason: { type: 'string' } },
      required: ['path', 'reason'],
    },
  },
  {
    name: 'docket_setup_propose',
    description: 'Propose the project and repo definitions as one project_setup diff for operator approval.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'object' },
        repos: { type: 'array' },
        flow: { type: 'object' },
        bindings: { type: 'array' },
        defaultLimitPolicy: { type: 'string' },
        commandSets: { type: 'object' },
      },
      required: ['project', 'repos', 'flow', 'defaultLimitPolicy', 'commandSets'],
    },
  },
];

export type SetupPathEntry =
  | { readonly kind: 'file'; readonly content: string }
  | { readonly kind: 'dir'; readonly names: readonly string[] }
  | { readonly kind: 'missing' };

export interface SetupPathReader {
  resolve(path: string): string;
  read(path: string): Promise<SetupPathEntry>;
}

export interface SetupToolsContext {
  readonly scope: ReadScope;
  readonly readCtx: ReadContext;
  readonly grants: SetupReadGrants;
  readonly reader: SetupPathReader;
  readonly draftId?: string;
}

type SetupToolDeps = Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals'>;

const cut = (text: string, max: number): string => (text.length <= max ? text : text.slice(0, max));

const detectPackageManager = (names: readonly string[]): string | undefined => {
  if (names.includes('pnpm-lock.yaml')) return 'pnpm';
  if (names.includes('yarn.lock')) return 'yarn';
  if (names.includes('package-lock.json')) return 'npm';
  if (names.includes('bun.lockb')) return 'bun';
  return undefined;
};

const analyzeRepo = async (reader: SetupPathReader, folder: string): Promise<Record<string, unknown>> => {
  const resolved = reader.resolve(folder);
  const root = await reader.read(resolved);
  const names = root.kind === 'dir' ? root.names : [];
  const pkg = names.includes('package.json') ? await reader.read(`${resolved}/package.json`) : { kind: 'missing' as const };
  const readmeName = names.find((name) => /^readme/i.test(name));
  const readme =
    readmeName === undefined ? undefined : await reader.read(`${resolved}/${readmeName}`);
  const readmeExcerpt =
    readme?.kind === 'file'
      ? redactSetupContent(cut(readme.content, SETUP_README_LIMIT))
      : undefined;

  let commands: { test?: string; lint?: string; build?: string } = {};
  if (pkg.kind === 'file') {
    try {
      const parsed = JSON.parse(pkg.content) as { scripts?: Record<string, string> };
      const scripts = parsed.scripts ?? {};
      commands = {
        ...(scripts.test === undefined ? {} : { test: scripts.test }),
        ...(scripts.lint === undefined ? {} : { lint: scripts.lint }),
        ...(scripts.build === undefined ? {} : { build: scripts.build }),
      };
    } catch {
      commands = {};
    }
  }

  const ci = names.filter((name) => name === '.github' || name.includes('gitlab') || name.endsWith('.yml') || name.endsWith('.yaml'));

  return {
    kind: 'data',
    source: 'docket_repo_analyze',
    summary: redactObject({
      vcs: {},
      languages: names.includes('package.json') ? ['typescript', 'javascript'] : [],
      ...(detectPackageManager(names) === undefined ? {} : { packageManager: detectPackageManager(names) }),
      commands,
      ...(names.includes('docs') ? { docsRoot: 'docs' } : {}),
      ci,
      ...(readmeExcerpt === undefined ? {} : { readmeExcerpt }),
    }),
  };
};

const redactObject = (value: unknown): unknown => {
  if (typeof value === 'string') return redactSecretShapes(value);
  if (Array.isArray(value)) return value.map(redactObject);
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = redactObject(entry);
    return out;
  }
  return value;
};

export interface SetupTools {
  call(tool: string, args: unknown, author: Actor): Promise<DocketToolResponse>;
}

export function createSetupTools(deps: SetupToolDeps, ctx: SetupToolsContext): SetupTools {
  return {
    call: async (tool, rawArgs, author): Promise<DocketToolResponse> => {
      const args = asArgs(rawArgs);
      if (args === undefined) return fail('bad_input');
      switch (tool) {
        case 'docket_repo_analyze': {
          const path = args['path'];
          if (typeof path !== 'string' || path.trim() === '') return fail('bad_input');
          const resolved = ctx.reader.resolve(path);
          const decision = decideRead(ctx.scope, path, ctx.readCtx, ctx.grants, resolved);
          if (decision.kind === 'deny') return fail('forbidden');
          if (decision.kind === 'ask') {
            return succeed({ kind: 'ask', path: decision.path });
          }
          return succeed(await analyzeRepo(ctx.reader, resolved));
        }
        case 'docket_read_path': {
          const path = args['path'];
          const reason = args['reason'];
          if (typeof path !== 'string' || typeof reason !== 'string' || path.trim() === '' || reason.trim() === '') {
            return fail('bad_input');
          }
          const resolved = ctx.reader.resolve(path);
          const decision = decideRead(ctx.scope, path, ctx.readCtx, ctx.grants, resolved);
          if (decision.kind === 'deny') return fail('forbidden');
          if (decision.kind === 'ask') {
            return succeed({ kind: 'ask', path: decision.path });
          }
          const entry = await ctx.reader.read(resolved);
          if (entry.kind === 'missing') return fail('not_found');
          if (entry.kind === 'dir') {
            const names = entry.names.slice(0, SETUP_DIR_LIMIT).map((name) => redactSetupContent(name));
            return succeed({
              kind: 'data',
              source: 'docket_read_path',
              path: normalizeAbsolutePath(resolved),
              listing: names,
              truncated: entry.names.length > SETUP_DIR_LIMIT,
            });
          }
          const text = redactSetupContent(cut(entry.content, SETUP_FILE_LIMIT));
          return succeed({
            kind: 'data',
            source: 'docket_read_path',
            path: normalizeAbsolutePath(resolved),
            excerpt: text,
            truncated: entry.content.length > SETUP_FILE_LIMIT,
          });
        }
        case 'docket_setup_propose': {
          const proposal = parseSetupToolProposal(args);
          if (proposal === undefined) return fail('bad_input');
          const created = await createProjectSetupProposal(deps, { proposal, author, draftId: ctx.draftId });
          return created.ok ? succeed({ kind: 'receipt', proposal: created.value, status: 'pending_approval' }) : fail('bad_input');
        }
        default:
          return fail('unknown_tool');
      }
    },
  };
}

const parseSetupToolProposal = (args: Record<string, unknown>): SetupProposal | undefined => {
  const project = args['project'];
  const repos = args['repos'];
  const flow = args['flow'];
  const defaultLimitPolicy = args['defaultLimitPolicy'];
  const commandSets = args['commandSets'];
  if (!isRecord(project) || !Array.isArray(repos) || !isRecord(flow) || typeof defaultLimitPolicy !== 'string' || !isRecord(commandSets)) {
    return undefined;
  }
  const name = project['name'];
  const repoList = repos.filter((entry): entry is string => typeof entry === 'string');
  const repoId = typeof project['id'] === 'string' ? project['id'] : repoList[0];
  if (typeof name !== 'string' || repoList.length === 0 || typeof repoId !== 'string') return undefined;
  const docsRoot = typeof project['docsRoot'] === 'string' ? project['docsRoot'] : 'docs';
  const testGlobs = Array.isArray(project['testGlobs']) ? project['testGlobs'].filter((g): g is string => typeof g === 'string') : ['**/*.test.ts'];
  return {
    project: { name, repos: repoList },
    repo: {
      id: repoId,
      flow: flow as unknown as RepoFlow,
      defaultLimitPolicy: defaultLimitPolicy as LimitPolicy,
      commandSets: commandSets as Readonly<Record<string, readonly string[]>>,
      docsRoot,
      testGlobs,
    },
    warnings: [],
    differsFromRecommended: [],
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
