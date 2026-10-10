// services/chat-tools.ts — the read-only tools of a chat turn (docs/v2/application.md A-204 …
// A-212): docket_get, docket_search and docket_read_file. This is the assistant's window into the
// operator's workspace, so every id, path and query that arrives is hostile: ids are validated
// first, then the read scope of the token's own conversation decides, and anything outside it —
// or simply not there — answers the same `forbidden` (no existence oracle). Results are wrapped
// as `{ kind: 'data', source, … }` so content is visibly data, and no response exceeds 32 KiB.
import type {
  FlowDef,
  PageId,
  Page,
  ProjectDef,
  ProjectSlug,
  RepoSlug,
  TaskSlug,
  WorkOrderEvent,
  WorkOrderId,
  WorkOrderState,
  WorkOrderStatus,
} from '../../domain/index';
import { deriveRoadmap, deriveWorkOrderState, isSlug, isUlid, matchesSearch, pageKindNameTr, validatePagePath } from '../../domain/index';

import type { AppDeps, RunTokenBinding } from '../ports';
import { isSecretRepoPath } from '../ports';
import { getWorkOrder, workOrderCodeOf } from '../use-cases/index';

import { chatReadScope, type ChatReadScope } from './chat-read-scope';
import { asArgs, fail, succeed, type DocketToolDefinition, type DocketToolResponse, type ToolArgs } from './docket-tool-types';

export const CHAT_TOOL_LIMITS = {
  responseBytes: 32 * 1024,
  boardItems: 200,
  searchDefault: 20,
  searchMax: 50,
  queryMax: 200,
  fileLines: 400,
  fileBytes: 64 * 1024,
} as const;

export type ChatBinding = Extract<RunTokenBinding, { readonly kind: 'chat' }>;

export interface ChatTools {
  call(binding: ChatBinding, tool: string, args: unknown): Promise<DocketToolResponse>;
}

type ChatToolDeps = Pick<
  AppDeps,
  'conversations' | 'workOrders' | 'runs' | 'projects' | 'repos' | 'definitions' | 'pages' | 'repoFiles'
>;

export const CHAT_TOOL_DEFINITIONS: readonly DocketToolDefinition[] = [
  {
    name: 'docket_get',
    description:
      'Read one thing from the operator\'s Docket workspace by id: a work order (state, gates, linked pages, usage), a project ' +
      '(repos and counts), a repo board (work orders by stage), a roadmap (phases and tasks with derived statuses) or a page ' +
      '(metadata only). Only what this conversation may read is answered; anything else is forbidden.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['work_order', 'project', 'repo_board', 'roadmap', 'page'] },
        id: { type: 'string', description: 'A work order or page id, or a project or repo slug (by kind).' },
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'docket_search',
    description:
      'Search work orders, pages, projects and repos this conversation may read, by code (such as İE-0012), title or name. ' +
      'Turkish letters match their plain forms. Answers { kind, id, label, project? } items.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        kinds: { type: 'array', items: { type: 'string', enum: ['work_order', 'page', 'project', 'repo'] } },
        limit: { type: 'integer', minimum: 1, maximum: CHAT_TOOL_LIMITS.searchMax },
      },
      required: ['query'],
    },
  },
  {
    name: 'docket_read_file',
    description:
      'Read a text file from the main checkout of a registered repo, by repo slug and repo-relative path. At most 400 lines and ' +
      '64 KiB per call; when `truncated` is true continue with `from` set to `next_from`. Secrets are redacted, and files that ' +
      'carry secrets (.env, keys, credentials) are never readable.',
    inputSchema: {
      type: 'object',
      properties: {
        repo: { type: 'string' },
        path: { type: 'string' },
        from: { type: 'integer', minimum: 1, description: '1-based first line to return.' },
      },
      required: ['repo', 'path'],
    },
  },
];

export const CHAT_TOOL_NAMES: ReadonlySet<string> = new Set(CHAT_TOOL_DEFINITIONS.map((tool) => tool.name));

// --- small helpers -----------------------------------------------------------------------------------

const encoder = new TextEncoder();
const sizeOf = (response: DocketToolResponse): number => encoder.encode(JSON.stringify(response)).length;

/** The largest n in [0, total] for which `build(n)` serialises within the cap; `build` is
 *  monotonic in n (a longer prefix is never smaller). */
const fitCount = (total: number, build: (n: number) => unknown): number => {
  const fits = (n: number): boolean => sizeOf(succeed(build(n))) <= CHAT_TOOL_LIMITS.responseBytes;
  if (fits(total)) return total;
  let low = 0;
  let high = total; // known not to fit
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
};

const slugArg = (value: unknown): string | undefined => (typeof value === 'string' && isSlug(value) ? value : undefined);
const ulidArg = (value: unknown): string | undefined => (typeof value === 'string' && isUlid(value) ? value : undefined);

const STATUS_ATTENTION: ReadonlySet<WorkOrderStatus> = new Set(['awaiting_human', 'blocked', 'limit_waiting']);

// --- the read access of one conversation ---------------------------------------------------------------

interface Access {
  readonly scope: ChatReadScope;
  readonly canProject: (project: ProjectSlug) => boolean;
  readonly canRepo: (repo: RepoSlug) => boolean;
  readonly canFile: (repo: RepoSlug, path: string) => boolean;
  readonly canOrder: (record: { readonly id: WorkOrderId; readonly project: ProjectSlug }) => boolean;
  readonly canPage: (page: Page) => Promise<boolean>;
}

/** What the conversation may read. A project (its scope or a reference) opens the project, its
 *  repos, its work orders and its pages; a work-order conversation opens that work order and, for
 *  context, its project and its repo — not its sibling work orders; every other reference opens
 *  exactly the thing it names. */
const accessOf = async (deps: ChatToolDeps, scope: ChatReadScope, workOrderScope: WorkOrderId | undefined): Promise<Access> => {
  const repos = new Set<RepoSlug>(scope.repos);
  for (const slug of scope.projects) {
    const project = await deps.projects.get(slug);
    if (project !== undefined) for (const repo of project.repos) repos.add(repo);
  }
  const contextProjects = new Set<ProjectSlug>();
  if (workOrderScope !== undefined) {
    const record = await deps.workOrders.get(workOrderScope);
    if (record !== undefined) {
      contextProjects.add(record.project);
      repos.add(record.repo);
    }
  }
  const canOrder = (record: { readonly id: WorkOrderId; readonly project: ProjectSlug }): boolean =>
    scope.all || scope.workOrders.has(record.id) || scope.projects.has(record.project);
  return {
    scope,
    canProject: (project) => scope.all || scope.projects.has(project) || contextProjects.has(project),
    canRepo: (repo) => scope.all || repos.has(repo),
    canFile: (repo, path) => scope.all || repos.has(repo) || scope.files.some((file) => file.repo === repo && file.path === path),
    canOrder,
    canPage: async (page) => {
      if (scope.all || scope.pages.has(page.id)) return true;
      if (page.project !== undefined && scope.projects.has(page.project)) return true;
      if (page.workOrder === undefined) return false;
      if (scope.workOrders.has(page.workOrder)) return true;
      const record = await deps.workOrders.get(page.workOrder);
      return record !== undefined && canOrder(record);
    },
  };
};

// --- the tools -------------------------------------------------------------------------------------------

export function createChatTools(deps: ChatToolDeps): ChatTools {
  const accessFor = async (binding: ChatBinding): Promise<Access | undefined> => {
    const conversation = await deps.conversations.get(binding.conversation);
    if (conversation === undefined) return undefined;
    return accessOf(deps, chatReadScope(conversation), conversation.scope.kind === 'workOrder' ? conversation.scope.workOrder : undefined);
  };

  const flowCache = new Map<RepoSlug, readonly FlowDef[]>();
  const flowsOf = async (repo: RepoSlug): Promise<readonly FlowDef[]> => {
    const cached = flowCache.get(repo);
    if (cached !== undefined) return cached;
    const loaded = await deps.definitions.load(repo);
    const flows = loaded.ok ? loaded.value.flows : [];
    flowCache.set(repo, flows);
    return flows;
  };

  interface Derived {
    readonly record: Awaited<ReturnType<AppDeps['workOrders']['list']>>[number];
    /** Undefined when the flow no longer loads: such an order counts as open but has no state. */
    readonly state: WorkOrderState | undefined;
  }
  const derive = async (records: Awaited<ReturnType<AppDeps['workOrders']['list']>>): Promise<readonly Derived[]> => {
    const out: Derived[] = [];
    for (const record of records) {
      const flow = (await flowsOf(record.repo)).find((candidate) => candidate.id === record.flow);
      out.push({ record, state: flow === undefined ? undefined : deriveWorkOrderState(flow, await deps.workOrders.events(record.id)) });
    }
    return out;
  };
  const codeOf = async (id: WorkOrderId): Promise<string> => workOrderCodeOf((await deps.workOrders.number(id)) ?? 0);

  // --- docket_get ---

  const getWorkOrderView = async (access: Access, id: WorkOrderId): Promise<DocketToolResponse> => {
    const record = await deps.workOrders.get(id);
    if (record === undefined || !access.canOrder(record)) return fail('forbidden');
    const view = await getWorkOrder(deps, id);
    if (!view.ok) return fail('internal');
    const { state, flow, runs } = view.value;
    const events: readonly WorkOrderEvent[] = await deps.workOrders.events(id);
    const stage = flow.stages.find((candidate) => candidate.id === state.stage);
    const gates = (stage?.exit ?? []).map((gate) => {
      let verdict: string | undefined;
      for (const event of events) {
        if (event.type === 'gate_evaluated' && event.stage === stage?.id && event.gate === gate.id) verdict = event.verdict.status;
      }
      return { id: gate.id, state: state.pendingGates.includes(gate.id) ? 'pending' : (verdict ?? 'not_evaluated') };
    });
    const pages = (await deps.pages.list({ workOrder: id })).map((page) => ({ id: page.id, title: page.title }));
    const lastRunAt = runs.reduce<number | null>((latest, run) => (latest === null || run.startedAt > latest ? run.startedAt : latest), null);
    const code = await codeOf(id);
    const build = (n: number): unknown => ({
      kind: 'data',
      source: 'docket_get work_order',
      code,
      title: record.title,
      project: record.project,
      repo: record.repo,
      status: state.status,
      stage: state.stage,
      gates,
      flowStages: flow.stages.map((entry) => ({ id: entry.id, name: entry.name })),
      linkedPages: pages.slice(0, n),
      ...(n < pages.length ? { truncated: true } : {}),
      usage: { runs: runs.length, lastRunAt },
    });
    return succeed(build(fitCount(pages.length, build)));
  };

  const getProjectView = async (access: Access, slug: ProjectSlug): Promise<DocketToolResponse> => {
    const project = await deps.projects.get(slug);
    if (project === undefined || !access.canProject(slug)) return fail('forbidden');
    const derived = await derive(await deps.workOrders.list({ project: slug }));
    return succeed({
      kind: 'data',
      source: 'docket_get project',
      name: project.name,
      repos: project.repos,
      mainRepo: project.mainRepo,
      openWorkOrders: derived.filter((entry) => entry.state?.status !== 'done').length,
      attention: derived.filter((entry) => entry.state !== undefined && STATUS_ATTENTION.has(entry.state.status)).length,
    });
  };

  const getRepoBoard = async (access: Access, slug: RepoSlug): Promise<DocketToolResponse> => {
    const known = (await deps.repos.path(slug)) !== undefined || (await deps.projects.projectOfRepo(slug)) !== undefined;
    if (!known || !access.canRepo(slug)) return fail('forbidden');
    const all = await derive(await deps.workOrders.list({ repo: slug }));
    const shown = all.slice(0, CHAT_TOOL_LIMITS.boardItems);
    const entries: { stage: string; code: string; title: string; status: string }[] = [];
    for (const entry of shown) {
      entries.push({
        stage: entry.state === undefined ? 'unknown' : (entry.state.stage ?? 'done'),
        code: await codeOf(entry.record.id),
        title: entry.record.title,
        status: entry.state?.status ?? 'unknown',
      });
    }
    const build = (n: number): unknown => {
      const stages: { stage: string; items: { code: string; title: string; status: string }[] }[] = [];
      for (const entry of entries.slice(0, n)) {
        let group = stages.find((candidate) => candidate.stage === entry.stage);
        if (group === undefined) {
          group = { stage: entry.stage, items: [] };
          stages.push(group);
        }
        group.items.push({ code: entry.code, title: entry.title, status: entry.status });
      }
      return { kind: 'data', source: 'docket_get repo_board', repo: slug, stages, ...(n < all.length ? { truncated: true } : {}) };
    };
    return succeed(build(fitCount(entries.length, build)));
  };

  const getRoadmapView = async (access: Access, slug: ProjectSlug): Promise<DocketToolResponse> => {
    if ((await deps.projects.get(slug)) === undefined || !access.canProject(slug)) return fail('forbidden');
    const roadmap = await deps.definitions.loadRoadmap(slug);
    if (roadmap === undefined) return fail('not_found');
    if (!roadmap.ok) return fail('internal');
    const derived = (await derive(await deps.workOrders.list({ project: slug }))).filter(
      (entry) => entry.record.task !== undefined && entry.state !== undefined,
    );
    const view = deriveRoadmap(
      roadmap.value,
      derived.map((entry) => ({ task: entry.record.task as TaskSlug, status: (entry.state as WorkOrderState).status })),
    );
    const codes = new Map<string, string[]>();
    for (const entry of derived) {
      const list = codes.get(entry.record.task as string) ?? [];
      list.push(await codeOf(entry.record.id));
      codes.set(entry.record.task as string, list);
    }
    const build = (n: number): unknown => ({
      kind: 'data',
      source: 'docket_get roadmap',
      phases: roadmap.value.phases.slice(0, n).map((phase) => ({
        id: phase.id,
        name: phase.name,
        status: view.phases[phase.id],
        tasks: phase.tasks.map((task) => ({ id: task.id, title: task.title, status: view.tasks[task.id], workOrders: codes.get(task.id) ?? [] })),
      })),
      ...(n < roadmap.value.phases.length ? { truncated: true } : {}),
    });
    return succeed(build(fitCount(roadmap.value.phases.length, build)));
  };

  const getPageView = async (access: Access, id: PageId): Promise<DocketToolResponse> => {
    const page = await deps.pages.get(id);
    if (page === undefined || !(await access.canPage(page))) return fail('forbidden');
    const project = page.project === undefined ? undefined : await deps.projects.get(page.project);
    const latest = page.versions[page.versions.length - 1];
    // Metadata only: no file bytes, names or sizes, and no comment text — a comment is the operator's
    // note to a run and reaches an agent only through its own page tool.
    return succeed({
      kind: 'data',
      source: 'docket_get page',
      title: page.title,
      pageKind: page.kind,
      latestVersion: latest?.n ?? 0,
      approval: page.approval,
      ...(page.approvedVersion === undefined ? {} : { approvedVersion: page.approvedVersion }),
      ...(project === undefined ? {} : { projectName: project.name }),
      ...(page.workOrder === undefined ? {} : { workOrderCode: await codeOf(page.workOrder) }),
    });
  };

  const get = async (binding: ChatBinding, args: ToolArgs): Promise<DocketToolResponse> => {
    const { kind } = args;
    const id = args['id'];
    // The id's shape is checked first, per kind: a malformed one is bad_input, never a scope answer.
    const valid = kind === 'work_order' || kind === 'page' ? ulidArg(id) : kind === 'project' || kind === 'roadmap' || kind === 'repo_board' ? slugArg(id) : undefined;
    if (valid === undefined) return fail('bad_input');
    const access = await accessFor(binding);
    if (access === undefined) return fail('forbidden');
    switch (kind) {
      case 'work_order':
        return getWorkOrderView(access, valid as WorkOrderId);
      case 'page':
        return getPageView(access, valid as PageId);
      case 'project':
        return getProjectView(access, valid as ProjectSlug);
      case 'roadmap':
        return getRoadmapView(access, valid as ProjectSlug);
      default:
        return getRepoBoard(access, valid as RepoSlug);
    }
  };

  // --- docket_search ---

  type SearchKind = 'work_order' | 'page' | 'project' | 'repo';
  const SEARCH_KINDS: readonly SearchKind[] = ['project', 'repo', 'work_order', 'page'];

  const search = async (binding: ChatBinding, args: ToolArgs): Promise<DocketToolResponse> => {
    const { query, kinds, limit } = args;
    if (typeof query !== 'string' || query.trim() === '' || query.length > CHAT_TOOL_LIMITS.queryMax) return fail('bad_input');
    let wanted: ReadonlySet<SearchKind> = new Set(SEARCH_KINDS);
    if (kinds !== undefined) {
      if (!Array.isArray(kinds) || !(kinds as readonly unknown[]).every((entry) => SEARCH_KINDS.includes(entry as SearchKind))) return fail('bad_input');
      wanted = new Set(kinds as readonly SearchKind[]);
    }
    let max: number = CHAT_TOOL_LIMITS.searchDefault;
    if (limit !== undefined) {
      if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > CHAT_TOOL_LIMITS.searchMax) return fail('bad_input');
      max = limit;
    }
    const access = await accessFor(binding);
    if (access === undefined) return fail('forbidden');

    const projects = await deps.projects.list();
    const names = new Map<ProjectSlug, string>(projects.map((project: ProjectDef) => [project.id, project.name]));
    const items: { kind: SearchKind; id: string; label: string; project?: ProjectSlug }[] = [];
    const room = (): boolean => items.length < max;

    if (wanted.has('project')) {
      for (const project of projects) {
        if (room() && access.canProject(project.id) && matchesSearch(`${project.name} ${project.id}`, query)) {
          items.push({ kind: 'project', id: project.id, label: project.name });
        }
      }
    }
    if (wanted.has('repo')) {
      const seen = new Set<RepoSlug>();
      for (const project of projects) {
        for (const repo of project.repos) {
          if (seen.has(repo)) continue;
          seen.add(repo);
          if (room() && access.canRepo(repo) && matchesSearch(repo, query)) items.push({ kind: 'repo', id: repo, label: repo, project: project.id });
        }
      }
    }
    if (wanted.has('work_order')) {
      for (const record of await deps.workOrders.list({})) {
        if (!room()) break;
        if (!access.canOrder(record)) continue;
        const code = await codeOf(record.id);
        if (matchesSearch(`${code} ${record.title} ${names.get(record.project) ?? ''}`, query)) {
          items.push({ kind: 'work_order', id: record.id, label: `${code} ${record.title}`, project: record.project });
        }
      }
    }
    if (wanted.has('page')) {
      for (const page of await deps.pages.list({})) {
        if (!room()) break;
        if (!(await access.canPage(page))) continue;
        const code = page.workOrder === undefined ? '' : await codeOf(page.workOrder);
        const projectName = page.project === undefined ? '' : (names.get(page.project) ?? '');
        if (matchesSearch(`${page.title} ${pageKindNameTr(page.kind)} ${projectName} ${code}`, query)) {
          items.push({ kind: 'page', id: page.id, label: page.title, ...(page.project === undefined ? {} : { project: page.project }) });
        }
      }
    }
    const build = (n: number): unknown => ({
      kind: 'data',
      source: 'docket_search',
      results: items.slice(0, n),
      ...(n < items.length ? { truncated: true } : {}),
    });
    return succeed(build(fitCount(items.length, build)));
  };

  // --- docket_read_file ---

  const readFile = async (binding: ChatBinding, args: ToolArgs): Promise<DocketToolResponse> => {
    const { path, from: fromArg } = args;
    const repo = slugArg(args['repo']);
    if (repo === undefined || typeof path !== 'string' || !validatePagePath(path)) return fail('bad_input');
    if (fromArg !== undefined && (typeof fromArg !== 'number' || !Number.isSafeInteger(fromArg) || fromArg < 1)) return fail('bad_input');
    const from = fromArg ?? 1;
    // Secret-bearing names are refused before the scope is even looked at, and before any read.
    if (isSecretRepoPath(path)) return fail('forbidden');
    const access = await accessFor(binding);
    if (access === undefined || !access.canFile(repo as RepoSlug, path)) return fail('forbidden');

    const read = await deps.repoFiles.read(repo as RepoSlug, path, { from, maxLines: CHAT_TOOL_LIMITS.fileLines, maxBytes: CHAT_TOOL_LIMITS.fileBytes });
    if (!read.ok) {
      switch (read.error) {
        case 'not_found':
        case 'too_large':
        case 'not_text':
          return fail(read.error);
        default:
          return fail('forbidden'); // an unknown repo or a path that leaves it: no hint which
      }
    }
    const { lines, truncated, nextFrom } = read.value;
    const body = (shown: readonly string[], more: boolean, next: number | undefined): unknown => ({
      kind: 'data',
      source: 'docket_read_file',
      repo,
      path,
      from,
      content: shown.join('\n'),
      truncated: more,
      ...(more && next !== undefined ? { next_from: next } : {}),
    });
    const whole = (n: number): unknown => body(lines.slice(0, n), n < lines.length || truncated, n < lines.length ? from + n : nextFrom);
    const count = fitCount(lines.length, whole);
    if (count > 0 || lines.length === 0) return succeed(whole(count));
    // A single line that alone exceeds the cap: cut inside the line and continue after it.
    const line = lines[0] ?? '';
    const chars = fitCount(line.length, (n) => body([line.slice(0, n)], true, from + 1));
    return succeed(body([line.slice(0, chars)], true, from + 1));
  };

  return {
    call: async (binding, tool, args) => {
      const parsed = asArgs(args);
      if (parsed === undefined) return fail('bad_input');
      switch (tool) {
        case 'docket_get':
          return get(binding, parsed);
        case 'docket_search':
          return search(binding, parsed);
        case 'docket_read_file':
          return readFile(binding, parsed);
        default:
          return fail('unknown_tool');
      }
    },
  };
}
