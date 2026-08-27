// src/core/roadmap-md.ts — pure helpers for the per-workspace roadmap document (WO-0048, ADR-0016).
//
// A roadmap is the operator's prose PLUS a machine-readable faz list. The list is a fenced block
// (the ```steps tradition plan.md established):
//   ```fazlar
//   [{"id":"f0","title":"Kullanıcı Yönetimi","blockedBy":[],"tasks":[…]}]
//   ```
// This module is the whole document contract: parse (all-or-nothing, the WO-0017 degradation rule —
// any malformed element collapses the list to [] with a named reason, never a misleading partial),
// diagnostics (hand-edit errors by name — what `roadmap validate` prints and what an invalid view
// carries), the surgical editor (rewrites ONLY the fence body — every byte outside it preserved),
// the builder (the producer half), the id minters, and the structure-root setting's arithmetic.
//
// Status appears nowhere in this document — `blockedBy` is data, not status; derivation lives in
// ./roadmap.ts. Pure text → struct, no I/O, no branded ids (ADR-0003).

/** A task inside a faz. `repo` is a repo SLUG resolved against the workspace by the derivation. */
export interface TaskSpec {
  id: string;
  title: string;
  repo?: string;
  note?: string;
}

/** A faz (milestone). `blockedBy` lists faz ids that must be `tamam` before this faz can run. */
export interface FazSpec {
  id: string;
  title: string;
  aim?: string;
  blockedBy: string[];
  notes?: string;
  tasks: TaskSpec[];
}

/** Why the fence did not parse. One reason — the surface shows it as the invitation's line. */
export type RoadmapParseError =
  | { reason: 'no_fence' }
  | { reason: 'bad_json'; message: string }
  | { reason: 'bad_element'; index: number; problem: string };

export interface ParsedRoadmapMd {
  workspace: string; // front-matter workspace slug ('' when no front-matter)
  title: string; // front-matter title
  fazlar: FazSpec[]; // [] on any parse failure — never partial
  parseError?: RoadmapParseError;
}

// Split YAML front matter from the body without a dependency (the order-md.ts idiom — sibling
// document parsers own their regex; no yaml lib in this repository).
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

function frontValue(front: string, key: string): string {
  const line = front.split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim() : '';
}

// Locate the LAST ```fazlar fence's inner text, or null — "last wins" so a stray earlier draft
// cannot override the operator's final list (the lastStepsFence rule).
function lastFazlarFence(md: string): string | null {
  const re = /```fazlar\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (let m: RegExpExecArray | null; (m = re.exec(md));) last = m[1]!;
  return last;
}

function lastFazlarFenceRange(md: string): [number, number] | null {
  const re = /```fazlar\s*\n[\s\S]*?```/g;
  let last: [number, number] | null = null;
  for (let m: RegExpExecArray | null; (m = re.exec(md));) last = [m.index, m.index + m[0].length];
  return last;
}

// Element shape validation. A field is required when the TYPE is unusable for typing (id/title not
// strings, blockedBy/tasks not arrays); emptiness and cross-element rules are DIAGNOSTICS, not
// parse errors — parseRoadmapMd must never reject what roadmapDiagnostics is meant to name.
function readTask(e: unknown, fazIdx: number, taskIdx: number): TaskSpec | string {
  const t = e as Record<string, unknown> | null;
  if (typeof t?.id !== 'string') return `fazlar[${fazIdx}].tasks[${taskIdx}].id: not a string`;
  if (typeof t?.title !== 'string') return `fazlar[${fazIdx}].tasks[${taskIdx}].title: not a string`;
  const out: TaskSpec = { id: t.id, title: t.title };
  if (typeof t.repo === 'string' && t.repo.trim() !== '') out.repo = t.repo;
  if (typeof t.note === 'string' && t.note.trim() !== '') out.note = t.note;
  return out;
}

function readFaz(e: unknown, idx: number): FazSpec | string {
  const f = e as Record<string, unknown> | null;
  if (typeof f?.id !== 'string') return `fazlar[${idx}].id: not a string`;
  if (typeof f?.title !== 'string') return `fazlar[${idx}].title: not a string`;
  if (!Array.isArray(f?.blockedBy)) return `fazlar[${idx}].blockedBy: not an array`;
  if (!f.blockedBy.every((b) => typeof b === 'string')) return `fazlar[${idx}].blockedBy: a ref is not a string`;
  if (!Array.isArray(f?.tasks)) return `fazlar[${idx}].tasks: not an array`;
  const tasks: TaskSpec[] = [];
  for (let i = 0; i < f.tasks.length; i++) {
    const task = readTask(f.tasks[i], idx, i);
    if (typeof task === 'string') return task;
    tasks.push(task);
  }
  const out: FazSpec = { id: f.id, title: f.title, blockedBy: f.blockedBy as string[], tasks };
  if (typeof f.aim === 'string' && f.aim.trim() !== '') out.aim = f.aim;
  if (typeof f.notes === 'string' && f.notes.trim() !== '') out.notes = f.notes;
  return out;
}

/**
 * Parse roadmap.md's ```fazlar fence into a validated `FazSpec[]`. Returns `fazlar: []` when there
 * is no fence, the body is not valid JSON, the JSON is not an array, or ANY element fails shape
 * validation — never throws, never partial — with `parseError` naming why (the invitation surface's
 * reason line; losing it is a stop-and-ask gate in the order). Unknown keys are ignored
 * (forward-compat).
 */
export function parseRoadmapMd(md: string): ParsedRoadmapMd {
  const m = FRONT_MATTER_RE.exec(md ?? '');
  const front = m ? m[1]! : '';
  const workspace = frontValue(front, 'workspace');
  const title = frontValue(front, 'title');
  const body = lastFazlarFence(md ?? '');
  if (body == null) return { workspace, title, fazlar: [], parseError: { reason: 'no_fence' } };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return { workspace, title, fazlar: [], parseError: { reason: 'bad_json', message: err instanceof Error ? err.message : String(err) } };
  }
  if (!Array.isArray(parsed)) return { workspace, title, fazlar: [], parseError: { reason: 'bad_json', message: 'fence body is not a JSON array' } };
  const fazlar: FazSpec[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const faz = readFaz(parsed[i], i);
    if (typeof faz === 'string') return { workspace, title, fazlar: [], parseError: { reason: 'bad_element', index: i, problem: faz } };
    fazlar.push(faz);
  }
  return { workspace, title, fazlar };
}

/** The diagnostic codes, in the vocabulary of order.md's parser contract. */
export type RoadmapDiagnosticCode =
  | 'no_fence'
  | 'bad_json'
  | 'bad_element'
  | 'duplicate_id'
  | 'bad_id_shape'
  | 'empty_title'
  | 'unknown_blocked_by'
  | 'self_blocked_by'
  | 'cyclic_blocked_by'
  | 'front_matter_mismatch'
  | 'unknown_repo';

export type RoadmapDiagnosticSeverity = 'error' | 'warning';

export interface RoadmapDiagnostic {
  code: RoadmapDiagnosticCode;
  severity: RoadmapDiagnosticSeverity;
  detail: string;
}

const ID_SHAPE_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Name a document's hand-edit errors. Parse errors come back as one error line; a parsed document
 * is checked per element (id shape, empty title, duplicate ids, blockedBy refs, repo slugs), then
 * for dependency cycles, then for front-matter identity. Severities: `cyclic_blocked_by` and
 * `unknown_repo` are WARNINGS (both members render bekliyor; one typo blanks one task's spawn —
 * neither may blank the surface); everything else is an error, and any error makes the view
 * `invalid`. Diagnostic order: parse error → front-matter → per-element in document order →
 * cycles. Pure; the workspace facts (slug, repo slugs) arrive as `ctx`.
 */
export function roadmapDiagnostics(md: string, ctx: { workspaceSlug: string; knownRepos: string[] }): RoadmapDiagnostic[] {
  const parsed = parseRoadmapMd(md ?? '');
  if (parsed.parseError) {
    const e = parsed.parseError;
    if (e.reason === 'no_fence') return [{ code: 'no_fence', severity: 'error', detail: '' }];
    if (e.reason === 'bad_json') return [{ code: 'bad_json', severity: 'error', detail: e.message }];
    return [{ code: 'bad_element', severity: 'error', detail: `[${e.index}] ${e.problem}` }];
  }
  const out: RoadmapDiagnostic[] = [];
  if (parsed.workspace !== ctx.workspaceSlug) {
    out.push({ code: 'front_matter_mismatch', severity: 'error', detail: `found '${parsed.workspace}' — expected '${ctx.workspaceSlug}'` });
  }
  const seen = new Set<string>();
  const fazIds = new Set(parsed.fazlar.map((f) => f.id));
  for (const f of parsed.fazlar) {
    if (!ID_SHAPE_RE.test(f.id)) out.push({ code: 'bad_id_shape', severity: 'error', detail: f.id });
    if (f.title.trim() === '') out.push({ code: 'empty_title', severity: 'error', detail: f.id });
    if (seen.has(f.id)) out.push({ code: 'duplicate_id', severity: 'error', detail: f.id });
    seen.add(f.id);
    for (const ref of f.blockedBy) {
      if (ref === f.id) out.push({ code: 'self_blocked_by', severity: 'error', detail: f.id });
      else if (!fazIds.has(ref)) out.push({ code: 'unknown_blocked_by', severity: 'error', detail: `${f.id} → ${ref}` });
    }
    for (const t of f.tasks) {
      if (!ID_SHAPE_RE.test(t.id)) out.push({ code: 'bad_id_shape', severity: 'error', detail: t.id });
      if (t.title.trim() === '') out.push({ code: 'empty_title', severity: 'error', detail: t.id });
      if (seen.has(t.id)) out.push({ code: 'duplicate_id', severity: 'error', detail: t.id });
      seen.add(t.id);
      if (t.repo !== undefined && !ctx.knownRepos.includes(t.repo)) {
        out.push({ code: 'unknown_repo', severity: 'warning', detail: `${t.id}: ${t.repo}` });
      }
    }
  }
  // Cycles: every SCC of size > 1 is one warning naming its members (self-blocks are the error
  // above, not a cycle). Iterative Tarjan — graphs here are tiny, but the shape must not loop.
  for (const members of cyclicGroups(parsed.fazlar)) {
    out.push({ code: 'cyclic_blocked_by', severity: 'warning', detail: members.join(' · ') });
  }
  return out;
}

// Strongly connected components (size > 1) over the blockedBy graph, members in document order.
function cyclicGroups(fazlar: FazSpec[]): string[][] {
  const byId = new Map(fazlar.map((f) => [f.id, f]));
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const groups: string[][] = [];
  let counter = 0;
  const strongConnect = (start: string): void => {
    const work: Array<{ id: string; edges: string[]; next: number }> = [{ id: start, edges: (byId.get(start)?.blockedBy ?? []).filter((e) => byId.has(e)), next: 0 }];
    index.set(start, counter);
    low.set(start, counter);
    counter += 1;
    stack.push(start);
    onStack.add(start);
    while (work.length > 0) {
      const frame = work[work.length - 1]!;
      if (frame.next < frame.edges.length) {
        const w = frame.edges[frame.next++]!;
        if (!index.has(w)) {
          index.set(w, counter);
          low.set(w, counter);
          counter += 1;
          stack.push(w);
          onStack.add(w);
          work.push({ id: w, edges: (byId.get(w)?.blockedBy ?? []).filter((e) => byId.has(e)), next: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.id, Math.min(low.get(frame.id)!, index.get(w)!));
        }
      } else {
        work.pop();
        if (work.length > 0) {
          const parent = work[work.length - 1]!;
          low.set(parent.id, Math.min(low.get(parent.id)!, low.get(frame.id)!));
        }
        if (low.get(frame.id) === index.get(frame.id)) {
          const group: string[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack.delete(w);
            group.push(w);
            if (w === frame.id) break;
          }
          if (group.length > 1) groups.push(fazlar.filter((f) => group.includes(f.id)).map((f) => f.id));
        }
      }
    }
  };
  for (const f of fazlar) if (!index.has(f.id)) strongConnect(f.id);
  return groups;
}

// The canonical serialization: explicit key order, absent optionals OMITTED (never null), 2-space
// pretty — this file is hand-edited by the operator, unlike plan.md's compact fence.
function serializeTask(t: TaskSpec): Record<string, unknown> {
  const o: Record<string, unknown> = { id: t.id, title: t.title };
  if (t.repo !== undefined) o.repo = t.repo;
  if (t.note !== undefined) o.note = t.note;
  return o;
}

function serializeFaz(f: FazSpec): Record<string, unknown> {
  const o: Record<string, unknown> = { id: f.id, title: f.title };
  if (f.aim !== undefined) o.aim = f.aim;
  o.blockedBy = f.blockedBy;
  if (f.notes !== undefined) o.notes = f.notes;
  o.tasks = f.tasks.map(serializeTask);
  return o;
}

function canonicalFenceBody(fazlar: FazSpec[]): string {
  return JSON.stringify(fazlar.map(serializeFaz), null, 2);
}

/**
 * The EDIT half of the fence contract: rewrite the LAST ```fazlar fence body with the given fazlar,
 * preserving every other byte of the document. No fence → the text is returned UNCHANGED (the
 * caller guards: editing requires a document that carries a fence). A hand-formatted body is
 * canonicalized ONCE — canonical bodies are fixed points (pinned by test).
 */
export function applyFazlarEdits(md: string, fazlar: FazSpec[]): string {
  const range = lastFazlarFenceRange(md ?? '');
  if (range == null) return md;
  return md.slice(0, range[0]) + '```fazlar\n' + canonicalFenceBody(fazlar) + '\n```' + md.slice(range[1]);
}

export interface RoadmapMdInput {
  workspaceSlug: string;
  title: string;
  prose?: string;
  fazlar: FazSpec[];
}

/**
 * Compose a whole roadmap.md: front-matter (`workspace`, `title`), an H1, optional prose, exactly
 * one canonical fence. The producer half of the contract — `parseRoadmapMd(buildRoadmapMd(x))
 * .fazlar` deep-equals `x.fazlar` (pinned by test).
 */
export function buildRoadmapMd(input: RoadmapMdInput): string {
  const prose = input.prose?.trim() ? `${input.prose.trim()}\n\n` : '';
  return `---
workspace: ${input.workspaceSlug}
title: ${input.title}
---

# ${input.title}

${prose}\`\`\`fazlar
${canonicalFenceBody(input.fazlar)}
\`\`\`
`;
}

/** The default structure root (ADR-0016): documents live under `<decisionStore>/docs/`. */
export const DEFAULT_DOCS_ROOT = 'docs';

const DOCS_ROOT_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

/**
 * The structure-root setting's arithmetic: trim, strip one leading `./` and one trailing `/`, then
 * accept only safe RELATIVE paths — no escapes (`..` segment), no absolutes, no empty/dot-only, no
 * doubled slashes. Anything else → undefined, which the store reads as "unset → fail open to the
 * default" and the write path reads as "refuse loudly" (the budget setting's split posture).
 */
export function normalizeDocsRoot(v: string): string | undefined {
  let s = v.trim();
  if (s.startsWith('./')) s = s.slice(2);
  s = s.replace(/\/+$/, '');
  if (!DOCS_ROOT_RE.test(s)) return undefined;
  if (s.split('/').some((seg) => seg === '..' || seg === '.')) return undefined;
  if (s === '') return undefined;
  return s;
}

/**
 * Mint the next faz id: max+1 among `^f(\d+)$` ids (gaps are honest — f0,f1,f2,f4 → f5); no
 * matching ids → f0. Task ids never collide with faz ids by shape (a task id always contains '-t').
 */
export function nextFazId(fazlar: FazSpec[]): string {
  let max = -1;
  for (const f of fazlar) {
    const m = /^f(\d+)$/.exec(f.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `f${max + 1}`;
}

/**
 * Mint the next task id for a faz: `<fazId>-t<n>` with n = max `t<n>` suffix within that faz, bumped
 * while the candidate collides with ANY task id across the roadmap (a hand-named id elsewhere
 * cannot be shadowed — ids are unique across the whole document).
 */
export function nextTaskId(fazId: string, fazlar: FazSpec[]): string {
  const allTaskIds = new Set(fazlar.flatMap((f) => f.tasks.map((t) => t.id)));
  const faz = fazlar.find((f) => f.id === fazId);
  let max = 0;
  for (const t of faz?.tasks ?? []) {
    const m = new RegExp(`^${escapeRe(fazId)}-t(\\d+)$`).exec(t.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = max + 1;
  while (allTaskIds.has(`${fazId}-t${n}`)) n += 1;
  return `${fazId}-t${n}`;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
