// Rules R-172 … R-179 of docs/v2/domain.md autonomy addendum: the risk-rule table.
import { describe, expect, it } from 'vitest';

import { ACTION_CLASSES, type ActionClass } from '../actions';

import { classifyRisk, RISK_RULES, type RiskAsk, type RiskContext } from './index';

const ROOT = '/wt';

const context = (overrides: Partial<RiskContext> = {}): RiskContext => ({
  worktreeRoot: ROOT,
  cwd: ROOT,
  verificationCommands: ['npm test'],
  ...overrides,
});

const toolAsk = (tool: string, args: Readonly<Record<string, unknown>> = {}): RiskAsk => ({
  kind: 'tool',
  tool,
  arguments: args,
});

/** The row id a low verdict named, or undefined when the ask went to the human. */
const lowRule = (ask: RiskAsk, ctx: RiskContext = context()): string | undefined => {
  const verdict = classifyRisk(ask, ctx);
  return verdict.verdict === 'low' ? verdict.rule : undefined;
};

const asks = (ask: RiskAsk, ctx: RiskContext = context()): boolean =>
  classifyRisk(ask, ctx).verdict === 'needs_human';

const ALL_ROW_IDS: readonly string[] = [
  'deny-run-config',
  'deny-push-merge',
  'deny-destructive',
  'deny-network',
  'deny-secrets',
  'deny-package-install',
  'deny-write-git-internals',
  'deny-write-outside',
  'allow-own-read',
  'allow-read-search',
  'allow-git-read',
  'allow-verify',
  'allow-write-inside',
];

describe('autonomy/risk', () => {
  it('R-172: the table is the whole licence — rows are exactly the listed ids and nothing unlisted is low', () => {
    expect([...RISK_RULES].map((rule) => rule.id).sort()).toEqual([...ALL_ROW_IDS].sort());
    // One representative ask per allow row: each low names its row.
    expect(lowRule(toolAsk('docket_get'))).toBe('allow-own-read');
    expect(lowRule(toolAsk('Read', { file_path: `${ROOT}/src/a.ts` }))).toBe('allow-read-search');
    expect(lowRule(toolAsk('Bash', { command: 'git status' }))).toBe('allow-git-read');
    expect(lowRule(toolAsk('Bash', { command: 'npm test' }))).toBe('allow-verify');
    expect(lowRule(toolAsk('Edit', { file_path: `${ROOT}/src/a.ts` }))).toBe('allow-write-inside');
    // Nothing outside the table is licensed: unknown names and shapes ask.
    expect(asks(toolAsk('Task'))).toBe(true);
    expect(asks(toolAsk('TodoWrite', { todos: [] }))).toBe(true);
    expect(asks(toolAsk('mcp__other__fetch', { url: 'https://x' }))).toBe(true);
    expect(asks(toolAsk('Read'))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: `${ROOT}/src/a.ts` }), context({ worktreeRoot: undefined }))).toBe(true);
  });

  it('R-173: classifyRisk contract — union dispatch, structural default-deny, purity', () => {
    // Unknown tool names, missing arguments and absent context all fall through every row.
    expect(classifyRisk(toolAsk('Bash'), context())).toEqual({ verdict: 'needs_human' });
    expect(asks(toolAsk('Bash', { command: 'npm test' }), context({ verificationCommands: [] }))).toBe(true);
    expect(asks(toolAsk('Grep', { pattern: 'x' }), context({ cwd: undefined }))).toBe(true);
    // The assistant arm answers without touching the command rows.
    expect(classifyRisk({ kind: 'assistant_action', actionClass: 'setting_change' }, context())).toEqual({
      verdict: 'needs_human',
    });
    // Purity: the same inputs answer the same verdict and no input is mutated.
    const ask = toolAsk('Read', { file_path: `${ROOT}/a.ts`, extra: { nested: [1, 2] } });
    const ctx = context({ verificationCommands: ['npm run check'] });
    const askBefore = JSON.stringify(ask);
    const ctxBefore = JSON.stringify(ctx);
    expect(classifyRisk(ask, ctx)).toEqual(classifyRisk(ask, ctx));
    expect(JSON.stringify(ask)).toBe(askBefore);
    expect(JSON.stringify(ctx)).toBe(ctxBefore);
    // A low verdict names the deciding row — the evidence the policy actor records.
    expect(lowRule(toolAsk('docket_search', { query: 'x' }))).toBe('allow-own-read');
  });

  it('R-174: read/search rows — containment, relative-against-cwd, ~ and .. escapes, secret paths', () => {
    // Contained reads and searches are low; everything else asks.
    expect(lowRule(toolAsk('Read', { file_path: `${ROOT}/src/a.ts` }))).toBe('allow-read-search');
    expect(lowRule(toolAsk('Grep', { pattern: 'x', path: `${ROOT}/src` }))).toBe('allow-read-search');
    expect(lowRule(toolAsk('Glob', { pattern: 'src/**/*.ts', path: ROOT }))).toBe('allow-read-search');
    // A search without a path runs from the working directory.
    expect(lowRule(toolAsk('Grep', { pattern: 'x' }))).toBe('allow-read-search');
    expect(asks(toolAsk('Grep', { pattern: 'x' }), context({ cwd: '/elsewhere' }))).toBe(true);
    expect(asks(toolAsk('Glob', { pattern: '**/*.ts' }), context({ cwd: undefined }))).toBe(true);
    // Relative paths resolve against cwd; the resolved path must stay inside.
    expect(lowRule(toolAsk('Read', { file_path: 'src/a.ts' }))).toBe('allow-read-search');
    expect(asks(toolAsk('Read', { file_path: '../outside.ts' }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: 'src/a.ts' }), context({ cwd: '/elsewhere' }))).toBe(true);
    // Absolute escapes, tilde and empty paths never resolve inside.
    expect(asks(toolAsk('Read', { file_path: '/etc/passwd' }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: `${ROOT}/../secret.ts` }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: '~/.ssh/config' }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: '' }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: 42 }))).toBe(true);
    // Containment is segment-wise: a sibling directory with a longer name is outside.
    expect(asks(toolAsk('Read', { file_path: '/wtx/file.ts' }))).toBe(true);
    // A pattern or glob walking out of the tree never matches.
    expect(asks(toolAsk('Glob', { pattern: '../**', path: ROOT }))).toBe(true);
    expect(asks(toolAsk('Grep', { pattern: '..', path: `${ROOT}/src` }))).toBe(true);
    // Secret-shaped paths ask even inside the worktree.
    expect(asks(toolAsk('Read', { file_path: `${ROOT}/.env` }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: `${ROOT}/config/.env.local` }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: `${ROOT}/keys/id_rsa` }))).toBe(true);
    expect(asks(toolAsk('Read', { file_path: `${ROOT}/cert.pem` }))).toBe(true);
    expect(asks(toolAsk('Grep', { pattern: '.env', path: ROOT }))).toBe(true);
    expect(asks(toolAsk('Glob', { pattern: '**/*.pem', path: ROOT }))).toBe(true);
  });

  it('R-175: git-read row — the subcommand set, branch/remote restrictions, --output and metachar bans', () => {
    for (const subcommand of ['status', 'log', 'diff', 'show', 'blame', 'rev-parse', 'ls-files']) {
      expect(lowRule(toolAsk('Bash', { command: `git ${subcommand}` }))).toBe('allow-git-read');
    }
    expect(lowRule(toolAsk('Bash', { command: 'git log -n 5 --oneline -- src' }))).toBe('allow-git-read');
    expect(lowRule(toolAsk('Bash', { command: '  git status  ' }))).toBe('allow-git-read');
    // branch and remote list only under their flag allow-lists, never with a positional operand.
    expect(lowRule(toolAsk('Bash', { command: 'git branch' }))).toBe('allow-git-read');
    expect(lowRule(toolAsk('Bash', { command: 'git branch -vv -a' }))).toBe('allow-git-read');
    expect(asks(toolAsk('Bash', { command: 'git branch feature' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git branch -d feature' }))).toBe(true);
    expect(lowRule(toolAsk('Bash', { command: 'git remote' }))).toBe('allow-git-read');
    expect(lowRule(toolAsk('Bash', { command: 'git remote -v' }))).toBe('allow-git-read');
    expect(asks(toolAsk('Bash', { command: 'git remote add origin https://x' }))).toBe(true);
    // diff/show can write a patch with --output: banned in every spelling.
    expect(asks(toolAsk('Bash', { command: 'git diff --output=/tmp/patch' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git show --output /tmp/patch HEAD' }))).toBe(true);
    // --no-index diffs two filesystem paths, so it reads outside any worktree: banned too.
    expect(asks(toolAsk('Bash', { command: 'git diff --no-index /etc/hosts /dev/null' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git diff --no-index=/etc/hosts /dev/null' }))).toBe(true);
    // Anything with shell metacharacters asks — quoting and substitution are not parsed.
    expect(asks(toolAsk('Bash', { command: 'git status > out.txt' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git log --oneline | head -5' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git diff $(pwd)' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git log --grep="two words"' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git status && rm -rf /' }))).toBe(true);
    // Commands that are not plain git reads ask, including other git subcommands.
    expect(asks(toolAsk('Bash', { command: 'ls -la' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git commit -m x' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git config user.email' }))).toBe(true);
  });

  it('R-176: verify row — exact equality after trim only; the floor still wins', () => {
    const ctx = context({ verificationCommands: ['npm run typecheck && npm test', 'npm test'] });
    expect(lowRule(toolAsk('Bash', { command: 'npm run typecheck && npm test' }), ctx)).toBe('allow-verify');
    expect(lowRule(toolAsk('Bash', { command: '  npm test  ' }), ctx)).toBe('allow-verify');
    // Whitespace inside the command is significant: a near-miss asks.
    expect(asks(toolAsk('Bash', { command: 'npm  test' }), ctx)).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'npm test -- --watch' }), ctx)).toBe(true);
    // No declared commands, no low.
    expect(asks(toolAsk('Bash', { command: 'npm test' }), context({ verificationCommands: [] }))).toBe(true);
    // The floor has no verify exemption: a declared install or push asks anyway.
    const declared = context({ verificationCommands: ['npm install', 'git push origin main'] });
    expect(asks(toolAsk('Bash', { command: 'npm install' }), declared)).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git push origin main' }), declared)).toBe(true);
  });

  it('R-177: the deny floor — every never-low clause asks, floor before allow', () => {
    // Push and merge in every form, including composed and sudo'd commands.
    expect(asks(toolAsk('Bash', { command: 'git push' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git push --force origin main' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git push --force-with-lease origin main' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'sudo git push' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'echo hi && git push origin main' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git merge feature' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'gh pr merge 123' }))).toBe(true);
    // Destructive shell.
    expect(asks(toolAsk('Bash', { command: 'rm -rf /tmp/x' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'rmdir old' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git reset --hard HEAD~1' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git clean -fd' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'git rm src/a.ts' }))).toBe(true);
    // Network egress: the tools and the commands.
    expect(asks(toolAsk('WebFetch', { url: 'https://x' }))).toBe(true);
    expect(asks(toolAsk('WebSearch', { query: 'x' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'curl https://x' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'ssh host ls' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'wget https://x tarball' }))).toBe(true);
    // Secret and environment reads.
    expect(asks(toolAsk('Bash', { command: 'env' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'printenv PATH' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'history' }))).toBe(true);
    // Package installs and fetch-and-run wrappers.
    expect(asks(toolAsk('Bash', { command: 'npm install left-pad' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'yarn add left-pad' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'pip3 install requests' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'npm ci' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'npx vitest run' }))).toBe(true);
    expect(asks(toolAsk('Bash', { command: 'npm test && npx istanbul' }))).toBe(true);
    // Writes outside the worktree, tilde-relative or unresolvable.
    expect(asks(toolAsk('Edit', { file_path: '/etc/hosts' }))).toBe(true);
    expect(asks(toolAsk('Write', { file_path: '~/.zshrc' }))).toBe(true);
    expect(asks(toolAsk('Write', { file_path: 'relative/without/cwd' }), context({ cwd: undefined }))).toBe(true);
    expect(asks(toolAsk('Edit'))).toBe(true);
    // Writes into .git or onto .gitmodules/.gitattributes ask even inside the worktree.
    expect(asks(toolAsk('Edit', { file_path: `${ROOT}/.git/config` }))).toBe(true);
    expect(asks(toolAsk('Write', { file_path: `${ROOT}/.git/hooks/pre-commit` }))).toBe(true);
    expect(asks(toolAsk('Edit', { file_path: `${ROOT}/sub/.git/x` }))).toBe(true);
    expect(asks(toolAsk('Write', { file_path: `${ROOT}/.gitmodules` }))).toBe(true);
    expect(asks(toolAsk('Write', { file_path: `${ROOT}/.gitattributes` }))).toBe(true);
  });

  it('R-178: assistant action classes — exhaustive over ACTION_CLASSES, all needs_human', () => {
    expect(ACTION_CLASSES.length).toBeGreaterThan(0);
    for (const actionClass of ACTION_CLASSES) {
      expect(classifyRisk({ kind: 'assistant_action', actionClass }, context())).toEqual({ verdict: 'needs_human' });
    }
    // A runtime class outside the closed union has no row and asks.
    expect(classifyRisk({ kind: 'assistant_action', actionClass: 'nope' as ActionClass }, context())).toEqual({
      verdict: 'needs_human',
    });
  });

  it('R-179: write-inside row — file writes contained by the worktree are low', () => {
    expect(lowRule(toolAsk('Edit', { file_path: `${ROOT}/src/a.ts` }))).toBe('allow-write-inside');
    expect(lowRule(toolAsk('Write', { file_path: `${ROOT}/notes/new.md` }))).toBe('allow-write-inside');
    expect(lowRule(toolAsk('NotebookEdit', { notebook_path: `${ROOT}/nb/a.ipynb` }))).toBe('allow-write-inside');
    expect(lowRule(toolAsk('Write', { file_path: 'src/a.ts' }))).toBe('allow-write-inside');
    // Outside targets were already held by the floor; secret-shaped targets never match here.
    expect(asks(toolAsk('Write', { file_path: `${ROOT}/.env.production` }))).toBe(true);
    expect(asks(toolAsk('Write', { file_path: `${ROOT}/server.key` }))).toBe(true);
  });

  it('R-184: a read or write of <dataDir>/runs/<run>/config is denied for file tools and Bash, traversal included', () => {
    const DATA = '/data';
    const ctx = context({ dataDir: DATA });
    const cfg = `${DATA}/runs/run-1/config`;
    const denied = (ask: RiskAsk, c: RiskContext = ctx): boolean =>
      JSON.stringify(classifyRisk(ask, c)) === JSON.stringify({ verdict: 'deny', rule: 'deny-run-config' });
    expect(denied(toolAsk('Read', { file_path: `${cfg}/.agents/.docket-ask.json` }))).toBe(true);
    expect(denied(toolAsk('Edit', { file_path: `${cfg}/.agents/hooks.json` }))).toBe(true);
    expect(denied(toolAsk('Write', { file_path: `${cfg}/x` }))).toBe(true);
    expect(denied(toolAsk('NotebookEdit', { notebook_path: `${cfg}/n.ipynb` }))).toBe(true);
    expect(denied(toolAsk('Grep', { pattern: 'token', path: cfg }))).toBe(true);
    expect(denied(toolAsk('Glob', { pattern: `${cfg}/**` }))).toBe(true);
    expect(denied(toolAsk('Glob', { pattern: `${DATA}/runs/*/config/**` }))).toBe(true);
    expect(denied(toolAsk('Bash', { command: `cat ${cfg}/.agents/mcp_config.json` }))).toBe(true);
    expect(denied(toolAsk('Bash', { command: `ls ${cfg}/` }))).toBe(true);
    expect(denied(toolAsk('Bash', { command: `head -c 20 < ${cfg}/token` }))).toBe(true);
    expect(denied(toolAsk('Bash', { command: `echo x>${cfg}/hooks.json` }))).toBe(true);
    // Traversal variants resolve into the tree.
    expect(denied(toolAsk('Read', { file_path: `${DATA}/runs/run-1/x/../config/token` }))).toBe(true);
    expect(denied(toolAsk('Read', { file_path: `${DATA}//runs//run-1//config//token` }))).toBe(true);
    expect(denied(toolAsk('Read', { file_path: `${cfg}/` }))).toBe(true);
    expect(denied(toolAsk('Read', { file_path: '../../data/runs/run-1/config/token' }), context({ dataDir: DATA, cwd: '/wt/sub' }))).toBe(true);
    expect(denied(toolAsk('Read', { file_path: 'token' }), context({ dataDir: DATA, cwd: cfg }))).toBe(true);
    // Outside the tree is unaffected: the worktree, the run dir beside it, other data-dir files.
    expect(lowRule(toolAsk('Read', { file_path: `${ROOT}/docs/a.md` }), ctx)).toBe('allow-read-search');
    expect(denied(toolAsk('Read', { file_path: `${DATA}/runs/run-1/state.json` }))).toBe(false);
    expect(denied(toolAsk('Read', { file_path: `${DATA}/runs/run-1/configs/x` }))).toBe(false);
    expect(denied(toolAsk('Read', { file_path: `${DATA}/config/x` }))).toBe(false);
    expect(denied(toolAsk('Bash', { command: 'npm test' }))).toBe(false);
    // The vendor schema dir stays with the human, as before.
    expect(asks(toolAsk('Read', { file_path: '/home/u/.gemini/antigravity-cli/mcp/docket-pages/instructions.md' }), ctx)).toBe(true);
  });

  it('R-186: a Bash token that is <dataDir>/runs or anything below it is denied — the ancestors of the config tree included', () => {
    const DATA = '/data';
    const ctx = context({ dataDir: DATA });
    const denied = (ask: RiskAsk, c: RiskContext = ctx): boolean =>
      JSON.stringify(classifyRisk(ask, c)) === JSON.stringify({ verdict: 'deny', rule: 'deny-run-config' });
    const bash = (command: string): RiskAsk => toolAsk('Bash', { command });
    expect(denied(bash(`find ${DATA}/runs -exec cat {} \\;`))).toBe(true);
    expect(denied(bash(`ls -R ${DATA}/runs`))).toBe(true);
    expect(denied(bash(`ls ${DATA}/runs/`))).toBe(true);
    expect(denied(bash(`tar cf x ${DATA}/runs/run-1`))).toBe(true);
    expect(denied(bash(`cat ${DATA}/runs/run-1/state.json`))).toBe(true);
    expect(denied(bash(`cd ${DATA}//runs/run-1/x/.. && ls`))).toBe(true);
    expect(denied(bash('ls ../../data/runs'), context({ dataDir: DATA, cwd: '/wt/sub' }))).toBe(true);
    expect(denied(bash('ls runs/run-1'), context({ dataDir: DATA, cwd: DATA }))).toBe(true);
    // The row stays on the runs subtree: the data dir itself, its siblings and look-alike names are not it.
    expect(denied(bash(`ls ${DATA}`))).toBe(false);
    expect(denied(bash(`ls ${DATA}/runs-old/x`))).toBe(false);
    expect(denied(bash(`ls ${DATA}/runsx`))).toBe(false);
    expect(denied(bash(`ls ${DATA}/worktrees/runs`))).toBe(false);
    expect(denied(bash('ls src runs'), context({ dataDir: DATA, cwd: ROOT }))).toBe(false);
    // The file tools keep the narrower match: a file under runs/<run> but outside config is not the tree.
    expect(denied(toolAsk('Read', { file_path: `${DATA}/runs/run-1/state.json` }))).toBe(false);
    expect(denied(toolAsk('Grep', { pattern: 'x', path: `${DATA}/runs` }))).toBe(false);
    expect(denied(toolAsk('Read', { file_path: `${DATA}/runs/run-1/config/token` }))).toBe(true);
  });

  it('R-184: an absent or relative data dir skips the row — nothing else changes', () => {
    const ask = toolAsk('Read', { file_path: '/data/runs/run-1/config/token' });
    expect(classifyRisk(ask, context())).toEqual({ verdict: 'needs_human' });
    expect(classifyRisk(ask, context({ dataDir: 'data' }))).toEqual({ verdict: 'needs_human' });
    expect(lowRule(toolAsk('Read', { file_path: `${ROOT}/src/a.ts` }), context())).toBe('allow-read-search');
  });

  it('R-187: fileChange denies targets at/under <dataDir>/runs or ancestor grants covering it; permissions denies wildcard targets covering runs and non-wildcard tokens in runs', () => {
    const DATA = '/data';
    const ctx = context({ dataDir: DATA });
    const denied = (ask: RiskAsk, c: RiskContext = ctx): boolean =>
      JSON.stringify(classifyRisk(ask, c)) === JSON.stringify({ verdict: 'deny', rule: 'deny-run-config' });

    // fileChange: in runs tree
    expect(denied(toolAsk('fileChange', { command: `${DATA}/runs/r1/config` }))).toBe(true);
    expect(denied(toolAsk('fileChange', { path: `${DATA}/runs/r1/config` }))).toBe(true);
    expect(denied(toolAsk('fileChange', { command: `${DATA}/runs` }))).toBe(true);
    // fileChange: ancestor grant covers the run config tree (/ or dataDir)
    expect(denied(toolAsk('fileChange', { command: DATA }))).toBe(true);
    expect(denied(toolAsk('fileChange', { command: '/' }))).toBe(true);
    // fileChange: unrelated path does not deny
    expect(denied(toolAsk('fileChange', { command: ROOT }))).toBe(false);
    expect(denied(toolAsk('fileChange', { command: '/other' }))).toBe(false);

    // permissions: wildcard tokens ending with /* or /**
    expect(denied(toolAsk('permissions', { command: '/*' }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: '/**' }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `${DATA}/*` }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `${DATA}/**` }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `${DATA}/runs/*` }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `${DATA}/runs/**` }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `${DATA}/runs/r1/*` }))).toBe(true);
    // permissions: non-wildcard tokens deny when in runs tree
    expect(denied(toolAsk('permissions', { command: `${DATA}/runs/r1/config/token` }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `${DATA}/runs/r1` }))).toBe(true);
    // permissions: non-wildcard ancestor does not deny (only wildcard ancestors deny)
    expect(denied(toolAsk('permissions', { command: DATA }))).toBe(false);
    expect(denied(toolAsk('permissions', { command: '/' }))).toBe(false);
    // permissions: multiple tokens on RUN_CONFIG_TOKEN_SPLIT
    expect(denied(toolAsk('permissions', { command: `/other/* ${DATA}/runs/r1/*` }))).toBe(true);
    expect(denied(toolAsk('permissions', { command: `/other/* /workspace/*` }))).toBe(false);
  });
});
