// autonomy/risk.ts — the risk-rule table behind D-10's balanced/auto tool-ask arm: which permission
// ask is deterministic enough to auto-allow. Default-deny is structural — classifyRisk answers the
// first matching row of RISK_RULES and no match answers needs_human — so an unknown tool name, an
// unknown action class, missing or malformed arguments and absent run context can never reach a
// low. The table is data: widening it is a docs change first, never a code-side drift.
import type { ActionClass } from '../actions/index';

/** One permission ask, as the executor distils it from a transport. `tool` is the bare name the
 *  transport emits; `arguments` is the raw tool input — rows read the keys they know and anything
 *  malformed simply matches nothing. */
export type RiskAsk =
  | { readonly kind: 'tool'; readonly tool: string; readonly arguments?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'assistant_action'; readonly actionClass: ActionClass };

/** Run facts the rows need, resolved by the executor: the work order's worktree, the run's working
 *  directory, and the exact command strings Docket itself runs as the stage's command gates. */
export interface RiskContext {
  readonly worktreeRoot?: string;
  /** The Docket data directory; absent skips the run-config row (it cannot be judged), never any other. */
  readonly dataDir?: string;
  readonly cwd?: string;
  readonly verificationCommands: readonly string[];
}

export type RiskRuleId =
  | 'deny-run-config'
  | 'deny-push-merge'
  | 'deny-destructive'
  | 'deny-network'
  | 'deny-secrets'
  | 'deny-package-install'
  | 'deny-write-git-internals'
  | 'deny-write-outside'
  | 'allow-own-read'
  | 'allow-own-pages'
  | 'allow-read-search'
  | 'allow-git-read'
  | 'allow-verify'
  | 'allow-readonly-shell'
  | 'allow-write-inside';

export type RiskVerdict =
  | { readonly verdict: 'low'; readonly rule: RiskRuleId }
  | { readonly verdict: 'deny'; readonly rule: RiskRuleId }
  | { readonly verdict: 'needs_human' };

export interface RiskRule {
  readonly id: RiskRuleId;
  readonly verdict: 'low' | 'needs_human' | 'deny';
  readonly applies: (ask: RiskAsk, context: RiskContext) => boolean;
}

type ToolAsk = Extract<RiskAsk, { readonly kind: 'tool' }>;

const NEEDS_HUMAN: RiskVerdict = { verdict: 'needs_human' };

// --- argument access ---

const argString = (ask: ToolAsk, key: string): string | undefined => {
  const value: unknown = ask.arguments?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

const isTool = (ask: RiskAsk, names: readonly string[]): ask is ToolAsk =>
  ask.kind === 'tool' && names.includes(ask.tool);

const isBashAsk = (ask: RiskAsk): ask is ToolAsk & { readonly tool: 'Bash' } => isTool(ask, ['Bash']);

const READ_TOOLS: readonly string[] = ['Read', 'Grep', 'Glob'];
const WRITE_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit'];
const NETWORK_TOOLS: readonly string[] = ['WebFetch', 'WebSearch'];

// --- lexical path work; no node:path, no symlink knowledge — the classifier's frame is the string
// it is given, and the executor's sandbox owns the filesystem truth ---

const isAbsolute = (path: string): boolean => path.startsWith('/');

const resolveSegments = (absolute: string): readonly string[] => {
  const out: string[] = [];
  for (const segment of absolute.split('/')) {
    if (segment.length === 0 || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out;
};

const contains = (root: readonly string[], target: readonly string[]): boolean =>
  target.length >= root.length && root.every((segment, index) => target[index] === segment);

const rootOf = (context: RiskContext): readonly string[] | undefined =>
  context.worktreeRoot !== undefined && isAbsolute(context.worktreeRoot)
    ? resolveSegments(context.worktreeRoot)
    : undefined;

/** Absolute segments of a candidate path, or undefined when it cannot be resolved inside the run's
 *  frame: `~` is never expanded and a relative path needs an absolute cwd. */
const resolvePath = (path: string | undefined, context: RiskContext): readonly string[] | undefined => {
  if (path === undefined || path.length === 0 || path.startsWith('~')) return undefined;
  if (isAbsolute(path)) return resolveSegments(path);
  if (context.cwd === undefined || context.cwd.length === 0 || !isAbsolute(context.cwd)) return undefined;
  return resolveSegments(`${context.cwd}/${path}`);
};

const insideWorktree = (path: string | undefined, context: RiskContext): boolean => {
  const root = rootOf(context);
  const target = resolvePath(path, context);
  // An empty root would be `/` and contain everything; it resolves to nothing instead.
  return root !== undefined && root.length > 0 && target !== undefined && contains(root, target);
};

// --- secret-shaped names: reading one is the cheap half of a credential leak, writing one mints it ---

const isSecretBasename = (name: string): boolean =>
  name === '.env' ||
  name.startsWith('.env.') ||
  name.endsWith('.pem') ||
  name.endsWith('.key') ||
  name.startsWith('id_rsa') ||
  name === 'credentials.json' ||
  name === '.npmrc' ||
  name === '.netrc';

const secretShaped = (path: string | undefined): boolean => {
  if (path === undefined) return false;
  return isSecretBasename(path.slice(path.lastIndexOf('/') + 1));
};

// The search selectors are matched by mark, not basename: a pattern naming `.env` files selects
// them wherever it is anchored. Every mark carries its own dot, so ordinary names do not trip it.
const SECRET_MARKS: readonly string[] = ['.env', 'id_rsa', '.pem', '.key', 'credentials.json', '.npmrc', '.netrc'];

const secretPattern = (value: string | undefined): boolean =>
  value !== undefined && SECRET_MARKS.some((mark) => value.includes(mark));

/** A write into `.git` (hooks, config, the worktree pointer file) or onto `.gitmodules` /
 *  `.gitattributes` re-aims the repository itself, not the change under review. */
const touchesGitInternals = (target: readonly string[] | undefined): boolean => {
  if (target === undefined) return false;
  if (target.some((segment) => segment === '.git')) return true;
  const last = target[target.length - 1];
  return last === '.gitmodules' || last === '.gitattributes';
};

// --- command work: quoting and substitution are never parsed, so only the plainest form can match
// an allow row; anything unreadable asks ---

// Expansion characters count too: the shell rewrites `.\./x`, `.?/x`, `.[.]/x`, `.*` and `{..,}` into
// paths the lexical operand checks never see, so a command carrying one cannot be judged by its text.
const COMMAND_METACHARS: readonly string[] = [
  ';', '|', '&', '<', '>', '(', ')', '$', '"', "'", '`', '\n', '\r', '\\', '*', '?', '[', ']', '{', '}', '!',
];

const plainCommand = (command: string): boolean =>
  COMMAND_METACHARS.every((metachar) => !command.includes(metachar));

// The chain separator is the one metacharacter the readonly row parses instead of banning: `&&`
// joins two commands, and any other `&` — backgrounding, `;&`, `&&&` — is not it.
const noStrayAmpersand = (command: string): boolean =>
  command.split('&&').every((part) => !part.includes('&'));

/** A `&&`-joined chain of plain commands: every metacharacter still disqualifies except the
 *  separator itself, so redirection, pipes, sequencing, substitution and backgrounding all ask. */
const plainChain = (command: string): boolean =>
  COMMAND_METACHARS.filter((metachar) => metachar !== '&').every((metachar) => !command.includes(metachar)) &&
  noStrayAmpersand(command);

const tokensOf = (command: string): readonly string[] =>
  command.trim().split(/\s+/).filter((token) => token.length > 0);

const commandOf = (ask: RiskAsk): string | undefined => (ask.kind === 'tool' ? argString(ask, 'command') : undefined);

const commandTokens = (ask: RiskAsk): readonly string[] | undefined => {
  const command = commandOf(ask);
  return command === undefined ? undefined : tokensOf(command);
};

const firstToken = (tokens: readonly string[]): string | undefined => tokens[0];

const hasTokenPair = (tokens: readonly string[], first: string, second: string): boolean => {
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (tokens[index] === first && tokens[index + 1] === second) return true;
  }
  return false;
};

// --- row predicates ---

/** The one path a read or search names: Read's file_path, Grep/Glob's path. A search without a
 *  path runs from the working directory, which the row checks through the context. */
const readPathOf = (ask: ToolAsk): string | undefined =>
  ask.tool === 'Read' ? argString(ask, 'file_path') : argString(ask, 'path');

/** The one path a write names: file_path, else NotebookEdit's notebook_path. */
const writePathOf = (ask: ToolAsk): string | undefined =>
  argString(ask, 'file_path') ?? argString(ask, 'notebook_path');

const writePath = (ask: RiskAsk): string | undefined =>
  isTool(ask, WRITE_TOOLS) ? writePathOf(ask) : undefined;

// The floor reads the whole token list, not just the first token: a push, a merge or an install
// hidden behind `&&` denies exactly like a bare one. Over-matching is the safe direction here —
// a false deny only costs the user one answer.
const denyPushMerge = (ask: RiskAsk): boolean => {
  const tokens = commandTokens(ask);
  if (tokens === undefined) return false;
  if (hasTokenPair(tokens, 'git', 'push') || hasTokenPair(tokens, 'git', 'merge')) return true;
  return firstToken(tokens) === 'gh' && tokens.includes('merge');
};

const denyDestructive = (ask: RiskAsk): boolean => {
  const tokens = commandTokens(ask);
  if (tokens === undefined) return false;
  if (tokens.includes('rm') || tokens.includes('rmdir')) return true;
  if (hasTokenPair(tokens, 'git', 'clean')) return true;
  return hasTokenPair(tokens, 'git', 'reset') && tokens.includes('--hard');
};

const EGRESS_COMMANDS: readonly string[] = [
  'curl',
  'wget',
  'nc',
  'ncat',
  'ssh',
  'scp',
  'sftp',
  'rsync',
  'ping',
  'telnet',
];

const ENV_DUMP_COMMANDS: readonly string[] = ['env', 'printenv', 'history'];

const denyNetwork = (ask: RiskAsk): boolean => {
  if (isTool(ask, NETWORK_TOOLS)) return true;
  const tokens = commandTokens(ask);
  const head = tokens === undefined ? undefined : firstToken(tokens);
  return head !== undefined && EGRESS_COMMANDS.includes(head);
};

const denySecrets = (ask: RiskAsk): boolean => {
  if (ask.kind !== 'tool') return false;
  if (ask.tool === 'Bash') {
    const tokens = commandTokens(ask);
    const head = tokens === undefined ? undefined : firstToken(tokens);
    return head !== undefined && ENV_DUMP_COMMANDS.includes(head);
  }
  if (READ_TOOLS.includes(ask.tool)) {
    if (secretShaped(readPathOf(ask))) return true;
    // Read names one file; only a search selects many, so only its selectors are scanned.
    return ask.tool !== 'Read' && (secretPattern(argString(ask, 'pattern')) || secretPattern(argString(ask, 'glob')));
  }
  return WRITE_TOOLS.includes(ask.tool) && secretShaped(writePathOf(ask));
};

const PACKAGE_MANAGERS: readonly string[] = [
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'pip3',
  'uv',
  'cargo',
  'gem',
  'composer',
  'brew',
];

const INSTALL_SUBCOMMANDS: readonly string[] = ['install', 'i', 'add', 'ci', 'update', 'upgrade'];

const denyPackageInstall = (ask: RiskAsk): boolean => {
  const tokens = commandTokens(ask);
  if (tokens === undefined) return false;
  // A fetch-and-run wrapper is an install by another name: it is denied unconditionally.
  if (tokens.includes('npx')) return true;
  for (let index = 0; index + 1 < tokens.length; index += 1) {
    if (PACKAGE_MANAGERS.includes(tokens[index]) && INSTALL_SUBCOMMANDS.includes(tokens[index + 1])) return true;
  }
  return false;
};

const denyWriteGitInternals = (ask: RiskAsk, context: RiskContext): boolean =>
  isTool(ask, WRITE_TOOLS) && touchesGitInternals(resolvePath(writePath(ask), context));

const denyWriteOutside = (ask: RiskAsk, context: RiskContext): boolean =>
  isTool(ask, WRITE_TOOLS) && !insideWorktree(writePath(ask), context);

const allowOwnRead = (ask: RiskAsk): boolean => isTool(ask, ['docket_get', 'docket_search']);

/** The run's own page publish pair (R-191): bare, and as Docket's own pages server spells it —
 *  the two names an ask for them reaches the executor under. Publishing a page is not approving
 *  it, so the pair rides the table; a foreign server's page_publish or a longer name is not the
 *  pair, and `isTool` matches the whole string. */
const OWN_PAGE_TOOLS: readonly string[] = [
  'page_publish',
  'page_update',
  'mcp__docket-pages__page_publish',
  'mcp__docket-pages__page_update',
];

const allowOwnPages = (ask: RiskAsk): boolean => isTool(ask, OWN_PAGE_TOOLS);

// A pattern or glob walking out of the tree (`../**`) must not ride a contained base path.
const escapesPattern = (ask: ToolAsk): boolean =>
  ['pattern', 'glob'].some((key) => {
    const value = argString(ask, key);
    return value !== undefined && value.split('/').includes('..');
  });

const allowReadSearch = (ask: RiskAsk, context: RiskContext): boolean => {
  if (!isTool(ask, READ_TOOLS)) return false;
  const path = readPathOf(ask);
  if (ask.tool === 'Read') return insideWorktree(path, context);
  if (path === undefined) return insideWorktree(context.cwd, context);
  return !escapesPattern(ask) && insideWorktree(path, context);
};

const GIT_READ_SUBCOMMANDS: readonly string[] = [
  'status',
  'log',
  'diff',
  'show',
  'blame',
  'rev-parse',
  'ls-files',
];

// `git branch <name>` creates and `-d` deletes, and `git remote <verb>` writes config: the two
// list-only subcommands are low only with their flag allow-lists and no positional operand.
const GIT_BRANCH_FLAGS: readonly string[] = ['-v', '-vv', '-a', '-r', '-l', '--list', '--all', '--no-color'];
const GIT_REMOTE_FLAGS: readonly string[] = ['-v', '--verbose'];

// Options that write a file (--output), read outside the tree (--no-index, --contents). git accepts
// any unambiguous abbreviation of a long option, so a name that is a prefix of one of these is held
// back as well; an ambiguous prefix is a git error, which costs nothing.
const GIT_BANNED_OPTIONS: readonly string[] = ['--output', '--no-index', '--contents'];

const isBannedGitOption = (token: string): boolean => {
  if (GIT_BANNED_OPTIONS.some((banned) => token.startsWith(banned))) return true;
  const name = token.split('=')[0];
  return name.length >= 3 && GIT_BANNED_OPTIONS.some((banned) => banned.startsWith(name));
};

/** A non-option token that points outside the tree: an absolute or tilde path, or one with a `..`
 *  segment. A revision range (`main..feature`, `a...b`, `HEAD~3`, `HEAD^`) has no such segment.
 *  With two such operands git diff turns itself into --no-index without being asked. */
const isOutsideGitOperand = (token: string): boolean =>
  !token.startsWith('-') && (token.startsWith('/') || token.startsWith('~') || token.split('/').includes('..'));

const isGitReadCommand = (command: string, context: RiskContext): boolean => {
  if (!plainCommand(command)) return false;
  const tokens = tokensOf(command);
  if (tokens[0] !== 'git') return false;
  let tail = tokens.slice(1);
  // `git -C <path> …` re-aims git at another directory, so the target is held to the same frame as
  // a read path: inside the worktree, and never through a `..` walk.
  if (tail[0] === '-C') {
    const target = tail[1];
    if (target === undefined || !containedOperand(target, context)) return false;
    tail = tail.slice(2);
  }
  const subcommand = tail[0];
  if (subcommand === undefined) return false;
  const rest = tail.slice(1);
  if (GIT_READ_SUBCOMMANDS.includes(subcommand)) {
    // diff and show can write their patch out with --output, --no-index diffs two filesystem paths
    // and blame --contents reads one — all banned in every spelling, and so is any positional
    // operand that names a path outside the worktree.
    return rest.every((token) => !isBannedGitOption(token) && !isOutsideGitOperand(token));
  }
  if (subcommand === 'branch') return rest.every((token) => GIT_BRANCH_FLAGS.includes(token));
  if (subcommand === 'remote') return rest.every((token) => GIT_REMOTE_FLAGS.includes(token));
  return false;
};

/** A path operand the readonly rows accept: lexically inside the worktree and free of `..`
 *  segments — a spelling that walks (`sub/../x`) may resolve somewhere inside, but the operator
 *  decision holds it for the human rather than the classifier. */
const containedOperand = (path: string, context: RiskContext): boolean =>
  !path.split('/').includes('..') && insideWorktree(path, context);

/** `ls` and `pwd` (R-193): listing is the read the agents reach for most, and both commands are
 *  read-only under every flag — so any `-`-prefixed token passes, while a path operand of `ls` is
 *  held to the worktree frame and `pwd`, which names no file, accepts flags only. */
const isLsPwdCommand = (command: string, context: RiskContext): boolean => {
  if (!plainCommand(command)) return false;
  const tokens = tokensOf(command);
  const head = firstToken(tokens);
  if (head === 'pwd') return tokens.slice(1).every((token) => token.startsWith('-'));
  if (head !== 'ls') return false;
  const operands = tokens.slice(1).filter((token) => !token.startsWith('-'));
  if (operands.length === 0) return insideWorktree(context.cwd, context);
  return operands.every((operand) => containedOperand(operand, context));
};

const allowGitRead = (ask: RiskAsk, context: RiskContext): boolean => {
  if (!isBashAsk(ask)) return false;
  const command = commandOf(ask);
  return command !== undefined && isGitReadCommand(command, context);
};

const allowVerify = (ask: RiskAsk, context: RiskContext): boolean => {
  if (!isBashAsk(ask)) return false;
  const command = commandOf(ask);
  if (command === undefined) return false;
  // Equality after trim, nothing more: the string Docket itself runs as a gate is the licence, and
  // a mid-command whitespace difference is a different command.
  const trimmed = command.trim();
  return context.verificationCommands.some((declared) => declared.trim() === trimmed);
};

/** A chain part is licensed when the same string standing alone would be low: a git-read form
 *  (R-175's verbs, the `-C` spelling included), an `ls`/`pwd` listing, or one entry of the
 *  declared verification commands — the exact licence allow-verify grants the whole string, read
 *  per part. */
const isLowChainPart = (part: string, context: RiskContext): boolean =>
  isGitReadCommand(part, context) ||
  isLsPwdCommand(part, context) ||
  context.verificationCommands.some((declared) => declared.trim() === part.trim());

/** `allow-readonly-shell` (R-193): `ls`, `pwd` and `&&`-joined chains whose every part is itself
 *  low. The separator is the only metacharacter parsed; the deny floor has already scanned the
 *  whole token list before this row is reached, so a destructive, pushing or installing part
 *  never rides the chain. */
const allowReadonlyShell = (ask: RiskAsk, context: RiskContext): boolean => {
  if (!isBashAsk(ask)) return false;
  const command = commandOf(ask);
  if (command === undefined || !plainChain(command)) return false;
  return command
    .split('&&')
    .every((part) => part.trim().length > 0 && isLowChainPart(part.trim(), context));
};

const allowWriteInside = (ask: RiskAsk, context: RiskContext): boolean =>
  isTool(ask, WRITE_TOOLS) && insideWorktree(writePath(ask), context);

// --- the run config tree: <dataDir>/runs/<run>/config holds the ask-bridge and MCP tokens, so no
// tool may read or write it. Lexical like every row here — no symlink knowledge is claimed. ---

export const RUN_CONFIG_TOKEN_SPLIT = /[\s;|&<>()"'`$=]+/;

const inRunsTree = (target: readonly string[] | undefined, dataDir: readonly string[]): boolean =>
  target !== undefined && contains(dataDir, target) && target[dataDir.length] === 'runs';

const inRunConfigTree = (target: readonly string[] | undefined, dataDir: readonly string[]): boolean =>
  inRunsTree(target, dataDir) && target?.[dataDir.length + 2] === 'config';

const denyRunConfig = (ask: RiskAsk, context: RiskContext): boolean => {
  if (ask.kind !== 'tool' || context.dataDir === undefined || !isAbsolute(context.dataDir)) return false;
  const dataDir = resolveSegments(context.dataDir);
  const named = (path: string | undefined): boolean => inRunConfigTree(resolvePath(path, context), dataDir);
  if (isBashAsk(ask)) {
    // Over-matching is the safe direction: any token that resolves to `runs` or below denies — an
    // ancestor of the config tree walks into it (`find`, `ls -R`, `tar`) — so a `cd` into it, a
    // redirect target or a flag value cannot slip through either. The file tools name one path,
    // so they keep the narrower config match.
    const command = commandOf(ask);
    const inRuns = (path: string | undefined): boolean => inRunsTree(resolvePath(path, context), dataDir);
    return command !== undefined && command.split(RUN_CONFIG_TOKEN_SPLIT).some(inRuns);
  }
  if (ask.tool === 'fileChange') {
    const target = commandOf(ask) ?? readPathOf(ask);
    const resolved = resolvePath(target, context);
    const runsRoot = [...dataDir, 'runs'];
    return inRunsTree(resolved, dataDir) || (resolved !== undefined && contains(resolved, runsRoot));
  }
  if (ask.tool === 'permissions') {
    const command = commandOf(ask);
    if (command === undefined) return false;
    const runsRoot = [...dataDir, 'runs'];
    return command
      .split(RUN_CONFIG_TOKEN_SPLIT)
      .filter((token) => token.length > 0)
      .some((token) => {
        const isWildcard = token === '/*' || token === '/**' || token.endsWith('/*') || token.endsWith('/**');
        if (isWildcard) {
          const stripped =
            token === '/*' || token === '/**'
              ? '/'
              : token.endsWith('/**')
                ? token.slice(0, -3)
                : token.slice(0, -2);
          const resolved = resolvePath(stripped, context);
          return inRunsTree(resolved, dataDir) || (resolved !== undefined && contains(resolved, runsRoot));
        }
        return inRunsTree(resolvePath(token, context), dataDir);
      });
  }
  if (isTool(ask, READ_TOOLS)) {
    return [readPathOf(ask), argString(ask, 'pattern'), argString(ask, 'glob')].some(named);
  }
  return isTool(ask, WRITE_TOOLS) && named(writePathOf(ask));
};

/** Ordered: the deny floor first, allow rows after — first match wins. */
export const RISK_RULES: readonly RiskRule[] = [
  { id: 'deny-run-config', verdict: 'deny', applies: denyRunConfig },
  { id: 'deny-push-merge', verdict: 'needs_human', applies: denyPushMerge },
  { id: 'deny-destructive', verdict: 'needs_human', applies: denyDestructive },
  { id: 'deny-network', verdict: 'needs_human', applies: denyNetwork },
  { id: 'deny-secrets', verdict: 'needs_human', applies: denySecrets },
  { id: 'deny-package-install', verdict: 'needs_human', applies: denyPackageInstall },
  { id: 'deny-write-git-internals', verdict: 'needs_human', applies: denyWriteGitInternals },
  { id: 'deny-write-outside', verdict: 'needs_human', applies: denyWriteOutside },
  { id: 'allow-own-read', verdict: 'low', applies: allowOwnRead },
  { id: 'allow-own-pages', verdict: 'low', applies: allowOwnPages },
  { id: 'allow-read-search', verdict: 'low', applies: allowReadSearch },
  { id: 'allow-git-read', verdict: 'low', applies: allowGitRead },
  { id: 'allow-verify', verdict: 'low', applies: allowVerify },
  { id: 'allow-readonly-shell', verdict: 'low', applies: allowReadonlyShell },
  { id: 'allow-write-inside', verdict: 'low', applies: allowWriteInside },
];

// The assistant arm answers without the walk. The record is exhaustive over ACTION_CLASSES at
// compile time — a new class without a row fails the build — and every class stays human-decided:
// each has its own human-reviewed pipeline, and opening a work order commits real runs.
const ASSISTANT_ACTION_RISK: Readonly<Record<ActionClass, RiskVerdict>> = {
  open_work_order: NEEDS_HUMAN,
  roadmap_edit: NEEDS_HUMAN,
  definition_edit: NEEDS_HUMAN,
  setting_change: NEEDS_HUMAN,
};

export function classifyRisk(ask: RiskAsk, context: RiskContext): RiskVerdict {
  if (ask.kind === 'assistant_action') {
    // A runtime value outside ACTION_CLASSES has no row; the miss stays on the human side.
    return ASSISTANT_ACTION_RISK[ask.actionClass] ?? NEEDS_HUMAN;
  }
  for (const rule of RISK_RULES) {
    if (rule.applies(ask, context)) {
      return rule.verdict === 'needs_human' ? NEEDS_HUMAN : { verdict: rule.verdict, rule: rule.id };
    }
  }
  return NEEDS_HUMAN;
}
