// src/cli/roadmap.ts — pure presentation for the CLI's roadmap commands (WO-0048): `roadmap show`,
// `roadmap validate`, and the `--task` resolution `create-work-order` needs. The create.ts pattern —
// plain data in, plain text out; no Node, no store, no branding. English host chrome (the WO-0047
// ruling — the CLI is repo tooling); the roadmap's Turkish titles/status words print verbatim as DATA
// (they come from the document, not from this file).
import type { RoadmapView } from '../core/roadmap';
import { parseRoadmapMd, type RoadmapDiagnostic } from '../core/roadmap-md';
import { draftSummaryOf } from '../core/roadmap-draft';

const money = (n: number): string => `$${n.toFixed(2)}`;

/**
 * `roadmap show` — the derived view as plain lines: the head count line, one line per faz (status,
 * task fill, closed/open WO counts, cost when it has any, title), indented task rows (status,
 * closed-WO tail, open-WO chips), the sıradaki line, warnings last. absent/invalid render as their
 * own short surfaces — show is a VIEW (exit 0 either way); validate is the gate.
 */
export function formatRoadmapShow(view: RoadmapView): string {
  if (view.kind === 'absent') return 'no roadmap.md — nothing planned yet.';
  if (view.kind === 'invalid') {
    return ['roadmap.md is invalid:', ...view.reasons.map((r) => `  ${r.severity}: ${r.code}${r.detail ? ` — ${r.detail}` : ''}`)].join('\n');
  }
  const lines: string[] = [];
  const unknown = view.head.costUnknown ? ' (known spend — some sessions carry no cost)' : '';
  lines.push(
    `${view.head.title || 'Roadmap'} — faz ${view.head.doneFazCount}/${view.head.totalFazCount} tamam · ${view.head.openWoCount} open work order(s) · ${money(view.head.totalCostUsd)} observed${unknown}`,
  );
  for (const f of view.fazlar) {
    const done = f.tasks.filter((t) => t.status === 'tamam').length;
    const closed = f.closedWoCount > 0 ? `  ${f.closedWoCount} closed WO(s)  ${money(f.closedCostUsd)}` : '';
    const blocked = f.blockedBy.length > 0 ? `  (bloke: ${f.blockedBy.join(', ')})` : '';
    lines.push(`${f.id}  ${f.status.padEnd(8)} ${done}/${f.tasks.length} tasks${closed}${blocked}  ${f.title}`);
    for (const t of f.tasks) {
      const tail = t.closedWoCount > 0 ? `${t.closedWoCount} WO(s) closed` : t.status === 'planli' ? 'not started' : '';
      const open =
        t.openWoIds.length === 1 ? `▸ ${t.openWoIds[0]}` : t.openWoIds.length > 1 ? `▸ ${t.openWoIds.length} open WO(s)` : '';
      const repo = t.repo !== undefined ? ` (${t.repo})` : '';
      const tailParts = [tail, open].filter(Boolean).join('  ');
      lines.push(`  ${t.id}  ${t.status.padEnd(8)} ${tailParts}${repo}  ${t.title}`);
    }
  }
  if (view.siradaki !== undefined) {
    const task = view.fazlar.flatMap((f) => f.tasks).find((t) => t.id === view.siradaki!.taskId);
    lines.push(`siradaki: ${view.siradaki.taskId}${task ? ` — ${task.title}` : ''}`);
  }
  for (const w of view.warnings) lines.push(`warning: ${w.code}${w.detail ? ` — ${w.detail}` : ''}`);
  return lines.join('\n');
}

/**
 * `roadmap validate` — one line per diagnostic (`error: code — detail`), exit 1 iff any ERROR line;
 * warnings alone stay green (they ride the ready view). An absent file is legitimate — the
 * invitation state, not an error — so it exits 0 with "nothing to validate".
 */
export function formatRoadmapValidate(diags: RoadmapDiagnostic[] | 'absent'): { text: string; exitCode: 0 | 1 } {
  if (diags === 'absent') return { text: 'no roadmap.md — nothing to validate', exitCode: 0 };
  if (diags.length === 0) return { text: 'ok — no diagnostics', exitCode: 0 };
  const text = diags.map((d) => `${d.severity}: ${d.code}${d.detail ? ` — ${d.detail}` : ''}`).join('\n');
  return { text, exitCode: diags.some((d) => d.severity === 'error') ? 1 : 0 };
}

/**
 * `roadmap draft`'s closing line + `roadmap approve`'s success line (WO-0050): the pending proposal's
 * figures in the show voice. An unparseable proposal names its reason — never invented figures (the
 * same honesty the card renders).
 */
export function formatRoadmapDraftLine(md: string): string {
  const s = draftSummaryOf(md);
  if ('parseError' in s) {
    const why =
      s.parseError.reason === 'bad_json' ? `bad JSON (${s.parseError.message})`
      : s.parseError.reason === 'bad_element' ? `malformed element [${s.parseError.index}] — ${s.parseError.problem}`
      : 'no fazlar fence';
    return `draft does not re-read — ${why}`;
  }
  const chain = s.chainCount > 0 ? ` · ${s.chainCount} dependency chain(s)` : '';
  return `${s.fazCount} faz · ${s.taskCount} task(s)${chain}`;
}

/**
 * `create-work-order --task <ref>` resolution (the resolveTracks voice): the ref must name a task of
 * the workspace's roadmap. An absent or unparsable roadmap fails CLOSED — a link nobody can see is
 * worse than a refused command.
 */
export function resolveTaskRef(md: string, ref: string): { ok: true } | { ok: false; error: string } {
  const parsed = parseRoadmapMd(md);
  if (md === '' || parsed.parseError) {
    return { ok: false, error: "--task needs a parseable roadmap.md — run 'roadmap validate' first" };
  }
  const ids = parsed.fazlar.flatMap((f) => f.tasks.map((t) => t.id));
  if (!ids.includes(ref)) {
    return { ok: false, error: `unknown task "${ref}" — not a task of this workspace roadmap (valid: ${ids.join(', ') || 'none'})` };
  }
  return { ok: true };
}
