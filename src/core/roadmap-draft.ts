// src/core/roadmap-draft.ts — the ✦ draft drive's prompt + the TASLAK card's arithmetic
// (WO-0050, ADR-0016) + the channel composition's pure geometry (WO-0051).
//
// ONE mechanism (locked decision 2): generation from the goal note and import from existing
// faz docs are the SAME workspace-scoped architect plan session; the source-doc LIST is the
// only distinction. The prompt carries document PATHS and never contents — Docket never
// reads a file the operator points at (the agent reads them with its own file tools); a
// content reader would be the source-format parser ADR-0016 rejects, by other means.
//
// `draftSummaryOf` is the decision card's summary line: parse the proposal, count fazlar,
// tasks, and dependency chains. Pure text → figures, no I/O — the renderer parses the
// preview rows itself with parseRoadmapMd (the WO-0049 add-dialog precedent).

import { parseRoadmapMd, type RoadmapParseError } from './roadmap-md';

export interface RoadmapDraftPromptInput {
  /** The operator's goal note, verbatim (the dialog's required field). */
  goalNote: string;
  /** Source document PATHS — the import branch. Empty = generate from the note alone. */
  docPaths: string[];
  /** The workspace's slug (front-matter identity + the prompt's workspace line). */
  workspaceSlug: string;
  /** The workspace's known repo slugs (task `repo` fields draw from these). */
  knownRepos: string[];
  /** Where the approved document will live — the prompt's destination line. */
  roadmapMdPath: string;
  /** WO-0051 / D5: the serbest keşif opt-in — adds exactly ONE exploration sentence iff true
   *  (both the import and generate branches). Default off: the ordinary flow is deterministic
   *  and spends no exploration tokens. */
  freeExplore?: boolean;
}

/** WO-0051 / D5: the ONE exploration sentence. Named and rigid by design — the chip's whole
 *  contract is "a single optional sentence", so the text is test-pinned to appear exactly
 *  once. Reads stay free for the architect (`fenceDecision` allows reads); the sentence
 *  grants nothing the fence withholds — it licenses attention, not permission. */
const EXPLORE_CLAUSE =
  'Where the listed documents are not enough you may also explore the repository yourself with your read tools (your working directory is its root); the listed paths remain the required reading, and anything you find beyond them is yours to weigh.';

/**
 * The draft drive's first prompt (the architectPrompt voice, order-md.ts). Agent-facing
 * English; VALUES in the taught example stay placeholders the model fills in the operator's
 * language (the `aim` precedent). The taught fence example is itself parseable — the model
 * copies a valid shape, and Docket re-parses what it submits (a document that does not parse
 * is refused at approval: "bozuk taslak geçerliyi ezmesin").
 */
export function roadmapDraftPrompt(input: RoadmapDraftPromptInput): string {
  const docs =
    input.docPaths.length > 0
      ? [
          'Source documents (IMPORT — read these yourself with your file tools, in order, before drafting):',
          ...input.docPaths.map((p) => `- ${p}`),
          '',
          'These are PATHS, not contents: Docket never reads them — you do. Where the two disagree, the goal note states intent, the documents state fact: honor the documents.',
        ]
      : ['No source documents were given — GENERATE: draft the roadmap from the goal note alone.'];

  const repoLine =
    input.knownRepos.length > 0 ? input.knownRepos.join(', ') : '(none — omit repo fields)';
  // The taught example teaches a repo field ONLY when the workspace has repos — an example
  // with an unusable placeholder slug would teach a warning (unknown_repo).
  const exampleTask = `"id": "f0-t1", "title": "<task title, in the operator's language>"${
    input.knownRepos.length > 0 ? `, "repo": "<one of the known repo slugs>"` : ''
  }`;

  return [
    `You are the architect drafting this workspace's roadmap.md — the planning layer ABOVE work orders (roadmap → faz → task → work order).`,
    `The approved document will live at: ${input.roadmapMdPath}`,
    `Workspace: ${input.workspaceSlug}. Known repo slugs for task "repo" fields: ${repoLine}.`,
    ``,
    `Goal note (the operator's words, verbatim):`,
    input.goalNote,
    ``,
    ...docs,
    ...(input.freeExplore === true ? ['', EXPLORE_CLAUSE] : []),
    ``,
    `Deliverable: the COMPLETE roadmap.md document, submitted via ExitPlanMode. The operator reviews it in Docket and approves there; Docket writes the file — you never write it yourself, and the git commit is the operator's.`,
    ``,
    `Document format — this exact contract; Docket re-parses what you submit and refuses what does not parse:`,
    ``,
    '---',
    `workspace: ${input.workspaceSlug}`,
    `title: <the roadmap title, in the operator's language>`,
    '---',
    '',
    '# <the same title>',
    '',
    `<optional: one short paragraph of prose in the operator's language>`,
    '',
    '```fazlar',
    '[',
    '  {',
    '    "id": "f0",',
    `    "title": "<faz title, in the operator's language>",`,
    `    "aim": "<one-line purpose, in the operator's language>",`,
    '    "blockedBy": [],',
    '    "tasks": [',
    `      { ${exampleTask} }`,
    '    ]',
    '  }',
    ']',
    '```',
    '',
    'Parse rules (every one is enforced on your output):',
    '- EXACTLY ONE ```fazlar fence holding a JSON array; 2-space indentation.',
    '- ids match ^[a-z0-9][a-z0-9-]*$ and are UNIQUE across the whole document (faz and task ids share one namespace).',
    '- "blockedBy" names only faz ids present in the document; never the faz itself.',
    '- "repo" only from the known repo slugs above, or omitted.',
    '- Keys are English exactly as in the example; VALUES are verbatim in the operator\'s language (titles, aims, notes).',
    '- Optional fields ("aim", "notes", "note", "repo") are omitted, never empty-stringed.',
    '- Status appears NOWHERE in the document — "blockedBy" is data, not status; Docket derives every status from linked work orders.',
    '',
    `If you need clarification before you can draft, ask ONE concise question as plain text, then end your turn. The operator answers in Docket and your session resumes with their answer. Do NOT call a question or ask-user tool — ask as text and stop.`,
    ``,
    `After you submit the document you will receive a stop notice ("Plan submitted. STOP"). Obey it: end your turn immediately. NEVER investigate approval status, read Docket's own files, or resubmit — the operator decides in Docket, on their own time.`,
    ``,
    `If your session resumes with an operator note, that note is an objection: act on it and submit the REVISED complete document via ExitPlanMode again. Any other resume after the stop notice — answer in one short sentence and end your turn; do NOT resubmit unprompted.`,
  ].join('\n');
}

/** The TASLAK card's summary figures — what the summary line counts (mockup frame 05). */
export interface DraftSummary {
  fazCount: number;
  taskCount: number;
  /** Connected clusters of the blockedBy graph with at least one edge — "N bağımlılık zinciri". */
  chainCount: number;
}

/**
 * Parse a draft proposal and count its summary figures. An unparseable proposal returns the
 * named parse error — never invented figures (the card then renders the invalid line and
 * Onayla is absent: the parse-guard lives at the approval boundary, D6/D11).
 */
export function draftSummaryOf(md: string): DraftSummary | { parseError: RoadmapParseError } {
  const parsed = parseRoadmapMd(md ?? '');
  if (parsed.parseError) return { parseError: parsed.parseError };
  const taskCount = parsed.fazlar.reduce((n, f) => n + f.tasks.length, 0);
  return { fazCount: parsed.fazlar.length, taskCount, chainCount: chainCountOf(parsed.fazlar.map((f) => ({ id: f.id, blockedBy: f.blockedBy }))) };
}

// Union–find over the undirected blockedBy graph: a "chain" is a connected cluster that
// carries at least one edge. (A diamond is still one cluster — the count is a summary, not
// a structural claim; the preview rows carry the real per-faz blockers.)
function chainCountOf(fazlar: Array<{ id: string; blockedBy: string[] }>): number {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const f of fazlar) parent.set(f.id, f.id);
  for (const f of fazlar) for (const ref of f.blockedBy) if (parent.has(ref)) union(f.id, ref);
  const rootsWithEdge = new Set<string>();
  for (const f of fazlar) {
    if (f.blockedBy.length > 0) rootsWithEdge.add(find(f.id));
  }
  return rootsWithEdge.size;
}

// ===== WO-0051 — the channel composition's pure geometry =====
//
// The dialog composes the source set from channels (mockup rev 2): the store scan's groups,
// the prompt-path join, and the composition's persisted memory are all pure string work here
// (ADR-0006 — no I/O, no node:path); the fs walk itself lives in the decision-store adapter.

/** The composition's persisted memory — COUNTS + the flag, never a path (D2). Written at
 *  `plan_ready`, kept across an İtiraz resume, deleted with the pending row at approval. */
export interface DraftSourceSummary {
  store: number;
  external: number;
  freeExplore: boolean;
}

/** One first-directory-segment group of the store scan. `key: ''` is the structure root
 *  itself (its direct files); any other key is the first path segment (`'adr'`). */
export interface DraftDocGroup {
  key: string;
  files: string[];
}

/** Group a store scan (structure-root-RELATIVE posix paths) at the FIRST directory segment —
 *  the mockup's noise unit: docket scale drops 70 work orders with one touch (frame 02).
 *  `grouped: true` → the dialog renders group rows (any non-root segment exists); a pure-root
 *  (flat) scan renders file rows (frame 01). Root group first, then alphabetical; files
 *  sorted within — the dialog is deterministic by contract (mockup karar 3). */
export function draftDocGroups(files: string[]): { groups: DraftDocGroup[]; grouped: boolean } {
  const byKey = new Map<string, string[]>();
  for (const f of files) {
    const slash = f.indexOf('/');
    const key = slash === -1 ? '' : f.slice(0, slash);
    const list = byKey.get(key);
    if (list) list.push(f);
    else byKey.set(key, [f]);
  }
  const groups = [...byKey.entries()]
    .map(([key, list]) => ({ key, files: [...list].sort() }))
    .sort((a, b) => (a.key === '' ? -1 : b.key === '' ? 1 : a.key.localeCompare(b.key)));
  return { groups, grouped: groups.some((g) => g.key !== '') };
}

/** Join the structure root with scan-relative files into the PROMPT's repo-relative paths
 *  (`'docs' | 'docs/'` + `'adr/x.md'` → `'docs/adr/x.md'`) — string work only, resolvable
 *  from the drive cwd (the decision-store repo root). No `//`, no node:path. */
export function draftStorePaths(docsRoot: string, files: string[]): string[] {
  const root = docsRoot === '' ? '' : `${docsRoot.replace(/\/+$/, '')}/`;
  return files.map((f) => root + f);
}
