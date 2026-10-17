// GitHub issues and milestones adapter for the IssueTracker port, through the gh CLI. Every
// remote operation is one command via the injected runner, so tests script the outputs and
// nothing here spawns processes or touches the network itself; authentication stays entirely
// inside gh. Listing runs through `gh api graphql` so the listIssues/listMilestones page token
// maps one to one onto the port, and the permission probe reads the permissions object of
// `gh api repos/{owner}/{repo}` — fine-grained tokens carry no scope headers to parse instead.
import type { EpochMs, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';

import type {
  ConnectorCommands,
  ExternalItem,
  ExternalMilestone,
  IssueTracker,
  TrackerError,
  TrackerPermissions,
} from '../../../application/index';

const KIND = 'github-issues';

// A gh call is a single API request, like the forge adapter's non-push calls.
const GH_TIMEOUT_MS = 60_000;
const PROBE_TIMEOUT_MS = 15_000;

// One page per command keeps every call bounded; callers walk pages through the port's token.
const PAGE_SIZE = 50;
// gh rejects --limit values above its own ceiling, so a larger ask is clamped, never failed.
const SEARCH_LIMIT_MAX = 1000;

// GitHub page tokens are opaque base64url strings. The charset is also a safety fence: a token
// outside it cannot appear inside the GraphQL document as a literal, so it is refused up front
// instead of being interpolated.
const PAGE_TOKEN_RE = /^[A-Za-z0-9_=\-]+$/;

// A scope is OWNER/REPO. The charset doubles as the GraphQL-literal fence for owner and name.
const SCOPE_RE = /^([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)$/;

const ownerRepoOf = (scope: string): { readonly owner: string; readonly name: string } | undefined => {
  const match = SCOPE_RE.exec(scope);
  if (match === null) return undefined;
  return { owner: match[1], name: match[2] };
};

// Maps a failed command onto the port's error vocabulary, rate limiting first so an exceeded
// quota is never mistaken for a missing resource. Mirrors the forge adapter's classification.
const classify = (exitCode: number, output: string): TrackerError => {
  const text = output.toLowerCase();
  if (exitCode === 4) return 'auth';
  if (text.includes('http 429') || text.includes('rate limit')) return 'rate_limited';
  if (text.includes('http 404') || text.includes('not found') || text.includes('could not resolve to an issue')) {
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

// GitHub issues live in exactly two states; the port's status vocabulary maps onto nothing else.
const toStatus = (state: string): 'open' | 'closed' | undefined =>
  state === 'OPEN' ? 'open' : state === 'CLOSED' ? 'closed' : undefined;

// Timestamps arrive as ISO 8601 strings; an unparseable one is a malformed page, not a zero.
const toEpochMs = (iso: string): number | undefined => {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? undefined : ms;
};

// Labels arrive as a plain array from `--json` output and as {nodes} from GraphQL; one reader
// covers both so the two paths map onto identical items.
const labelNames = (value: unknown): readonly string[] | undefined => {
  const list = isRecord(value) && Array.isArray(value['nodes']) ? value['nodes'] : Array.isArray(value) ? value : undefined;
  if (list === undefined) return undefined;
  return list
    .filter((entry): entry is Record<string, unknown> => isRecord(entry))
    .map((entry) => readString(entry, 'name'))
    .filter((name): name is string => name !== undefined);
};

const mapIssue = (node: Record<string, unknown>): ExternalItem | undefined => {
  const number = node['number'];
  const title = readString(node, 'title');
  const url = readString(node, 'url');
  const state = readString(node, 'state');
  const updatedAtRaw = readString(node, 'updatedAt');
  if (typeof number !== 'number' || title === undefined || url === undefined || state === undefined || updatedAtRaw === undefined) {
    return undefined;
  }
  const status = toStatus(state);
  const updatedAt = toEpochMs(updatedAtRaw);
  if (status === undefined || updatedAt === undefined) return undefined;
  const milestone = isRecord(node['milestone']) && typeof node['milestone']['number'] === 'number'
    ? String(node['milestone']['number'])
    : undefined;
  const labels = labelNames(node['labels']);
  const body = readString(node, 'body');
  return {
    source: KIND,
    key: String(number),
    title,
    url,
    status,
    updatedAt,
    ...(body === undefined ? {} : { body }),
    ...(milestone === undefined ? {} : { milestone }),
    ...(labels === undefined || labels.length === 0 ? {} : { labels }),
  };
};

const mapMilestone = (node: Record<string, unknown>): ExternalMilestone | undefined => {
  const number = node['number'];
  const title = readString(node, 'title');
  const state = readString(node, 'state');
  if (typeof number !== 'number' || title === undefined || state === undefined) return undefined;
  const mapped = toStatus(state);
  if (mapped === undefined) return undefined;
  const dueOn = readString(node, 'dueOn');
  const dueAt = dueOn === undefined ? undefined : toEpochMs(dueOn);
  if (dueOn !== undefined && dueAt === undefined) return undefined;
  const url = readString(node, 'url');
  return {
    id: String(number),
    title,
    state: mapped,
    ...(dueAt === undefined ? {} : { dueAt }),
    ...(url === undefined ? {} : { url }),
  };
};

interface GraphPage {
  readonly nodes: readonly Record<string, unknown>[];
  readonly hasNextPage: boolean;
  readonly endCursor: string | undefined;
}

// A dropped node would silently hide an issue from the mirror, so malformed output fails whole.
const readGraphPage = (output: string, connection: string): Result<GraphPage, TrackerError> => {
  const parsed = parseJson(output);
  const data = parsed === undefined ? undefined : parsed['data'];
  const repository = isRecord(data) ? data['repository'] : undefined;
  const page = isRecord(repository) ? repository[connection] : undefined;
  const pageInfo = isRecord(page) ? page['pageInfo'] : undefined;
  if (!isRecord(page) || !Array.isArray(page['nodes']) || !isRecord(pageInfo)) return err('unknown');
  const hasNextPage = pageInfo['hasNextPage'];
  if (typeof hasNextPage !== 'boolean') return err('unknown');
  const endCursor = readString(pageInfo, 'endCursor');
  if (hasNextPage && endCursor === undefined) return err('unknown');
  const nodes: Record<string, unknown>[] = [];
  for (const node of page['nodes']) {
    if (!isRecord(node)) return err('unknown');
    nodes.push(node);
  }
  return ok({ nodes, hasNextPage, endCursor });
};

const ISSUES_NODES = 'number title url state updatedAt body milestone{number} labels(first:50){nodes{name}}';
const PAGE_INFO = 'endCursor hasNextPage';

const issuesQuery = (owner: string, name: string, since: EpochMs | undefined, issueCursor: string | undefined): string => {
  const after = issueCursor === undefined ? '' : `,after:"${issueCursor}"`;
  const filter = since === undefined ? '' : `,filterBy:{since:"${new Date(since).toISOString()}"}`;
  return `query{repository(owner:"${owner}",name:"${name}"){issues(first:${PAGE_SIZE}${after}${filter},orderBy:{field:UPDATED_AT,direction:DESC}){nodes{${ISSUES_NODES}}pageInfo{${PAGE_INFO}}}}}`;
};

const milestonesQuery = (owner: string, name: string, milestoneCursor: string | undefined): string => {
  const after = milestoneCursor === undefined ? '' : `,after:"${milestoneCursor}"`;
  return `query{repository(owner:"${owner}",name:"${name}"){milestones(first:${PAGE_SIZE}${after},states:[OPEN,CLOSED]){nodes{number title dueOn state url}pageInfo{${PAGE_INFO}}}}}`;
};

/** The IssueTracker for one local checkout. `repoPath` is the directory every command runs in;
 *  the scope-less methods (get, search, comment, transition) let gh resolve the repository from
 *  that checkout's own remote, while the scope-carrying ones address OWNER/REPO explicitly. */
export function createGhTracker(repoPath: string, commands: ConnectorCommands): IssueTracker {
  const runGh = async (args: readonly string[], timeoutMs: number): Promise<Result<string, TrackerError>> => {
    const outcome = await commands.run(repoPath, { bin: 'gh', args }, timeoutMs);
    if (outcome.exitCode !== 0) return err(classify(outcome.exitCode, outcome.outputTail));
    return ok(outcome.outputTail);
  };

  const runVoid = async (args: readonly string[], timeoutMs: number): Promise<Result<void, TrackerError>> => {
    const outcome = await runGh(args, timeoutMs);
    return outcome.ok ? ok(undefined) : outcome;
  };

  const graphCall = async (query: string): Promise<Result<string, TrackerError>> =>
    runGh(['api', 'graphql', '-f', `query=${query}`], GH_TIMEOUT_MS);

  const pageToken = (token: string | undefined): Result<string | undefined, TrackerError> =>
    token === undefined ? ok(undefined) : PAGE_TOKEN_RE.test(token) ? ok(token) : err('unknown');

  return {
    kind: KIND,

    listIssues: async (scope, opts) => {
      const target = ownerRepoOf(scope);
      if (target === undefined) return err('unknown');
      const issueCursor = pageToken(opts.cursor);
      if (!issueCursor.ok) return issueCursor;
      const output = await graphCall(issuesQuery(target.owner, target.name, opts.since, issueCursor.value));
      if (!output.ok) return output;
      const page = readGraphPage(output.value, 'issues');
      if (!page.ok) return page;
      const items: ExternalItem[] = [];
      for (const node of page.value.nodes) {
        const item = mapIssue(node);
        if (item === undefined) return err('unknown');
        items.push(item);
      }
      const next = page.value.hasNextPage ? page.value.endCursor : undefined;
      return ok({ items, ...(next === undefined ? {} : { next }) });
    },

    listMilestones: async (scope, milestoneCursor) => {
      const target = ownerRepoOf(scope);
      if (target === undefined) return err('unknown');
      const token = pageToken(milestoneCursor);
      if (!token.ok) return token;
      const output = await graphCall(milestonesQuery(target.owner, target.name, token.value));
      if (!output.ok) return output;
      const page = readGraphPage(output.value, 'milestones');
      if (!page.ok) return page;
      const items: ExternalMilestone[] = [];
      for (const node of page.value.nodes) {
        const milestone = mapMilestone(node);
        if (milestone === undefined) return err('unknown');
        items.push(milestone);
      }
      const next = page.value.hasNextPage ? page.value.endCursor : undefined;
      return ok({ items, ...(next === undefined ? {} : { next }) });
    },

    probePermissions: async (scope) => {
      const target = ownerRepoOf(scope);
      if (target === undefined) return err('unknown');
      const output = await runGh(['api', `repos/${target.owner}/${target.name}`], PROBE_TIMEOUT_MS);
      if (!output.ok) return output;
      const parsed = parseJson(output.value);
      const permissions = parsed === undefined ? undefined : parsed['permissions'];
      // Without the permissions object there is nothing honest to report: an unprobed capability
      // is never guessed at.
      if (!isRecord(permissions)) return err('unknown');
      const granted = (role: string): boolean => permissions[role] === true;
      // Writing issues and milestones takes push (or admin); reading takes any access at all.
      const write = granted('push') || granted('admin');
      const probed: TrackerPermissions = {
        read: granted('pull') || write,
        comment: write,
        transition: write,
        edit: write,
      };
      return ok(probed);
    },

    get: async (key) => {
      const output = await runGh(
        ['issue', 'view', key, '--json', 'number,title,url,state,updatedAt,body,milestone,labels'],
        GH_TIMEOUT_MS,
      );
      if (!output.ok) return output;
      const parsed = parseJson(output.value);
      if (parsed === undefined) return err('unknown');
      const item = mapIssue(parsed);
      return item === undefined ? err('unknown') : ok(item);
    },

    search: async (query, limit) => {
      if (limit <= 0) return ok([]);
      const capped = Math.min(SEARCH_LIMIT_MAX, Math.floor(limit));
      const output = await runGh(
        ['issue', 'list', '--search', query, '--limit', String(capped), '--json', 'number,title,url,state,updatedAt,body,milestone,labels'],
        GH_TIMEOUT_MS,
      );
      if (!output.ok) return output;
      let parsed: unknown;
      try {
        parsed = JSON.parse(output.value);
      } catch {
        return err('unknown');
      }
      if (!Array.isArray(parsed)) return err('unknown');
      const items: ExternalItem[] = [];
      for (const entry of parsed) {
        if (!isRecord(entry)) return err('unknown');
        const item = mapIssue(entry);
        if (item === undefined) return err('unknown');
        items.push(item);
      }
      return ok(items);
    },

    comment: async (key, text) =>
      runVoid(['issue', 'comment', key, '--body', text], GH_TIMEOUT_MS),

    transition: async (key, status) => {
      // GitHub has no third state to move an issue to, so an unmappable status is refused
      // rather than translated into a command that would mean something else.
      const verb = status === 'open' ? 'reopen' : status === 'closed' ? 'close' : undefined;
      if (verb === undefined) return err('unknown');
      return runVoid(['issue', verb, key], GH_TIMEOUT_MS);
    },

    createIssue: async (scope, item) => {
      const target = ownerRepoOf(scope);
      if (target === undefined) return err('unknown');
      if (!isRecord(item)) return err('unknown');
      const title = readString(item, 'title');
      if (title === undefined || title === '') return err('unknown');
      const body = readString(item, 'body');
      const output = await runGh(
        [
          'issue',
          'create',
          '--repo',
          `${target.owner}/${target.name}`,
          '--title',
          title,
          ...(body === undefined ? [] : ['--body', body]),
        ],
        GH_TIMEOUT_MS,
      );
      if (!output.ok) return output;
      const url = output.value.trim();
      const match = /\/issues\/(\d+)/.exec(url);
      if (match === null) return err('unknown');
      return ok({
        source: KIND,
        key: match[1],
        title,
        url,
        status: 'open',
        updatedAt: new Date().getTime(),
      });
    },

    updateIssue: async (scope, key, patch) => {
      const target = ownerRepoOf(scope);
      if (target === undefined) return err('unknown');
      if (!isRecord(patch)) return err('unknown');
      const title = readString(patch, 'title');
      const body = readString(patch, 'body');
      const state = readString(patch, 'state');
      if (state !== undefined && state !== 'open' && state !== 'closed') return err('unknown');
      if (title === undefined && body === undefined && state === undefined) return ok(undefined);
      const slug = `${target.owner}/${target.name}`;
      if (title !== undefined || body !== undefined) {
        const edited = await runGh(
          [
            'issue',
            'edit',
            key,
            '--repo',
            slug,
            ...(title === undefined ? [] : ['--title', title]),
            ...(body === undefined ? [] : ['--body', body]),
          ],
          GH_TIMEOUT_MS,
        );
        if (!edited.ok) return edited;
      }
      if (state !== undefined) {
        const verb = state === 'open' ? 'reopen' : 'close';
        const moved = await runGh(['issue', verb, key, '--repo', slug], GH_TIMEOUT_MS);
        if (!moved.ok) return moved;
      }
      return ok(undefined);
    },
  };
}
