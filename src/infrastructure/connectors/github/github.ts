// Forge adapter through the gh CLI. Every remote operation is one command through the injected
// exec port, so tests script it and nothing here spawns processes or touches the network itself.
// Authentication stays entirely inside gh (its own keyring, or GH_TOKEN in the runner's base
// environment) — no token ever passes through this file, the commands or their output.
import type { RepoRef, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';

import type {
  CheckRun,
  ConnectorCommands,
  Forge,
  ForgeCapabilities,
  ForgeError,
  PullRequestRef,
} from '../../../application/index';

// A gh call is a single API request; a push may upload a large pack over a slow link.
const GH_TIMEOUT_MS = 60_000;
const PUSH_TIMEOUT_MS = 600_000;
const PROBE_TIMEOUT_MS = 15_000;

// Reads OWNER/REPO out of a github.com remote URL (https, ssh:// or git@ form) for `--repo`;
// remotes on other hosts belong to other forges, so they are not mistaken for this one. The
// resolver reuses this grammar to decide which rows are this adapter's at all.
export const GITHUB_REMOTE = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([^\/]+)\/(.+?)(?:\.git)?\/?$/;

const ownerRepo = (remote: string): { readonly owner: string; readonly name: string } | undefined => {
  const match = GITHUB_REMOTE.exec(remote);
  if (match === null) return undefined;
  return { owner: match[1], name: match[2] };
};

// Maps a failed command onto the port's error vocabulary: gh's documented exit codes (4 = the
// command requires authentication) plus its error text (HTTP status lines, connection faults,
// git's own authentication and host errors). Rate limiting is read before not-found so an
// exceeded quota is never mistaken for a missing resource.
const classify = (exitCode: number, output: string): ForgeError => {
  const text = output.toLowerCase();
  if (exitCode === 4) return 'auth';
  if (text.includes('http 429') || text.includes('rate limit')) return 'rate_limited';
  if (text.includes('http 404') || text.includes('not found') || text.includes('could not resolve to a pullrequest')) {
    return 'not_found';
  }
  if (
    text.includes('authentication failed') ||
    text.includes('bad credentials') ||
    text.includes('http 401') ||
    text.includes('gh auth login')
  ) {
    return 'auth';
  }
  if (
    text.includes('could not resolve host') ||
    text.includes('connection refused') ||
    text.includes('connection timed out') ||
    text.includes('i/o timeout') ||
    text.includes('dial tcp') ||
    text.includes('failed to connect') ||
    text.includes('unable to access')
  ) {
    return 'network';
  }
  return 'unknown';
};

// The Checks API's status/conclusion vocabulary reduced to the port's six statuses. `neutral`
// means the run expresses no verdict, so it lands with `skipped`; a completed run whose
// conclusion is missing or unrecognized can still never count as passed.
const toCheckStatus = (status: string, conclusion: string | null): CheckRun['status'] => {
  if (status === 'in_progress') return 'running';
  if (status !== 'completed') return 'queued'; // queued, waiting, requested, pending
  switch (conclusion) {
    case 'success':
      return 'passed';
    case 'failure':
    case 'timed_out':
    case 'action_required':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
    case 'skipped':
    case 'neutral':
      return 'skipped';
    default:
      return 'failed';
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const readString = (record: Record<string, unknown>, field: string): string | undefined => {
  const value = record[field];
  return typeof value === 'string' ? value : undefined;
};

const parseJson = (text: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const parseCheckRuns = (output: string): Result<readonly CheckRun[], ForgeError> => {
  const parsed = parseJson(output);
  if (parsed === undefined || !Array.isArray(parsed['check_runs'])) return err('unknown');
  const runs: CheckRun[] = [];
  for (const entry of parsed['check_runs']) {
    // A dropped entry would silently hide a check from the gates, so malformed output fails whole.
    if (!isRecord(entry)) return err('unknown');
    const name = readString(entry, 'name');
    const status = readString(entry, 'status');
    if (name === undefined || status === undefined) return err('unknown');
    const conclusion = entry['conclusion'];
    const url = readString(entry, 'html_url');
    runs.push({
      name,
      status: toCheckStatus(status, typeof conclusion === 'string' ? conclusion : null),
      ...(url === undefined ? {} : { url }),
    });
  }
  return ok(runs);
};

// gh prints the created pull request's URL as its whole success output.
const PULL_URL = /\/pull\/(\d+)/;

const parseCreatedPullRequest = (output: string): Result<PullRequestRef, ForgeError> => {
  const url = output.trim();
  const match = PULL_URL.exec(url);
  if (match === null) return err('unknown');
  return ok({ number: Number(match[1]), url });
};

const toPrState = (state: string): 'open' | 'merged' | 'closed' | undefined =>
  state === 'OPEN' ? 'open' : state === 'MERGED' ? 'merged' : state === 'CLOSED' ? 'closed' : undefined;

// GraphQL's three-way mergeability has no port value when it is UNKNOWN: the field is left out
// instead of guessing a boolean.
const toMergeable = (value: string): boolean | undefined =>
  value === 'MERGEABLE' ? true : value === 'CONFLICTING' ? false : undefined;

// gh answers the repository's default branch as a ref object, or null for a repository with no
// branch yet. Anything but a record with a non-empty name is malformed: an empty string would
// prefill the pull-request base with nothing, so it fails whole instead.
const parseDefaultBranch = (output: string): Result<string, ForgeError> => {
  const parsed = parseJson(output);
  const ref = parsed?.['defaultBranchRef'];
  const name = isRecord(ref) ? readString(ref, 'name') : undefined;
  return name !== undefined && name !== '' ? ok(name) : err('unknown');
};

// `capabilities` is a synchronous property but the probe runs commands, so it happens once here,
// at creation: presence is `gh --version` succeeding, authentication `gh auth status` doing so.
// The port carries no issue-tracker members, so no capability is promised for issues.
const probeCapabilities = async (repo: string, commands: ConnectorCommands): Promise<ForgeCapabilities> => {
  const absent: ForgeCapabilities = { pullRequests: false, checks: false, issues: false };
  const present = await commands.run(repo, { bin: 'gh', args: ['--version'] }, PROBE_TIMEOUT_MS);
  if (present.exitCode !== 0) return absent;
  const authenticated = await commands.run(repo, { bin: 'gh', args: ['auth', 'status'] }, PROBE_TIMEOUT_MS);
  if (authenticated.exitCode !== 0) return absent;
  return { pullRequests: true, checks: true, issues: false };
};

/** The Forge for one local checkout. `repo` is the checkout directory every command runs in. */
export async function createGhForge(repo: string, commands: ConnectorCommands): Promise<Forge> {
  const capabilities = await probeCapabilities(repo, commands);

  // A disabled forge still implements the port: every member runs its command and lets the
  // failure classification speak, so callers see the concrete cause instead of a probe guess.
  const runGh = async (args: readonly string[], timeoutMs: number): Promise<Result<void, ForgeError>> => {
    const outcome = await commands.run(repo, { bin: 'gh', args }, timeoutMs);
    if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
    return ok(undefined);
  };

  const withTarget = async (
    repoRef: RepoRef,
    build: (slug: string) => readonly string[],
    timeoutMs: number,
  ): Promise<Result<void, ForgeError>> => {
    const target = ownerRepo(repoRef.remote);
    if (target === undefined) return err('unknown');
    return runGh(build(`${target.owner}/${target.name}`), timeoutMs);
  };

  return {
    kind: 'github',
    capabilities,

    pushBranch: async (repoRef, branch) => {
      // gh has no push; the branch goes to the remote URL itself so no remote name is assumed.
      // A hung credential prompt would eat the whole timeout, so prompts are switched off.
      const outcome = await commands.run(
        repo,
        { bin: 'git', args: ['push', repoRef.remote, branch] },
        PUSH_TIMEOUT_MS,
        { GIT_TERMINAL_PROMPT: '0' },
      );
      if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
      return ok(undefined);
    },

    openPullRequest: async (repoRef, input) => {
      const target = ownerRepo(repoRef.remote);
      if (target === undefined) return err('unknown');
      const slug = `${target.owner}/${target.name}`;
      const outcome = await commands.run(
        repo,
        {
          bin: 'gh',
          args: ['pr', 'create', '--repo', slug, '--head', input.head, '--base', input.base, '--title', input.title, '--body', input.body],
        },
        GH_TIMEOUT_MS,
      );
      if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
      return parseCreatedPullRequest(outcome.outputTail);
    },

    pullRequest: async (repoRef, number) => {
      const target = ownerRepo(repoRef.remote);
      if (target === undefined) return err('unknown');
      const outcome = await commands.run(
        repo,
        { bin: 'gh', args: ['pr', 'view', String(number), '--repo', `${target.owner}/${target.name}`, '--json', 'state,mergeable'] },
        GH_TIMEOUT_MS,
      );
      if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
      const parsed = parseJson(outcome.outputTail);
      if (parsed === undefined) return err('unknown');
      const state = readString(parsed, 'state');
      const prState = state === undefined ? undefined : toPrState(state);
      if (prState === undefined) return err('unknown');
      const mergeableRaw = readString(parsed, 'mergeable');
      const mergeable = mergeableRaw === undefined ? undefined : toMergeable(mergeableRaw);
      return ok({ state: prState, ...(mergeable === undefined ? {} : { mergeable }) });
    },

    checks: async (repoRef, ref) => {
      const target = ownerRepo(repoRef.remote);
      if (target === undefined) return err('unknown');
      // One page of 100 covers the check runs of a single ref; a pagination loop would turn the
      // gate's poll into an unbounded walk.
      const outcome = await commands.run(
        repo,
        { bin: 'gh', args: ['api', `repos/${target.owner}/${target.name}/commits/${ref}/check-runs?per_page=100`] },
        GH_TIMEOUT_MS,
      );
      if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
      return parseCheckRuns(outcome.outputTail);
    },

    // A read beside the actions: the base prefill asks the host which branch the repository
    // merges into, the same way a person reading the repo page would.
    defaultBranch: async (repoRef) => {
      const target = ownerRepo(repoRef.remote);
      if (target === undefined) return err('unknown');
      const outcome = await commands.run(
        repo,
        { bin: 'gh', args: ['repo', 'view', '--repo', `${target.owner}/${target.name}`, '--json', 'defaultBranchRef'] },
        GH_TIMEOUT_MS,
      );
      if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
      return parseDefaultBranch(outcome.outputTail);
    },

    // The only merge path. Plain --merge, never --auto: an automatic merge is a decision the
    // port has not asked for, and no other member runs a command that could merge.
    mergePullRequest: async (repoRef, number) => {
      return withTarget(repoRef, (slug) => ['pr', 'merge', String(number), '--repo', slug, '--merge'], GH_TIMEOUT_MS);
    },
  };
}
