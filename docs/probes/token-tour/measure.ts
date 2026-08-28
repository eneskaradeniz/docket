// Token research tour (2026-08-28) — the measurement harness behind
// docs/research/2026-08-28-token-usage-tour.md. NOT a work order; product code untouched.
//
// Three read-only passes over the dogfood data + the code's own pure prompt builders:
//   S1  cost accounting     — session/role/stage token+USD tables from both SQLite DBs
//   S2  transcript mix      — speaker/tool byte composition of every stored transcript
//   S3  prompt assembly     — the five first-prompts re-assembled byte-exactly offline via
//                             src/core's pure builders (prepareDriveInput's exact recipes),
//                             plus the ambient-harness fixed overhead from probe c1's
//                             captured getContextUsage categories
//
// Sources (all read-only):
//   DB        ~/Library/Application Support/docket/docket.db (+ the WO-0038 incident backup)
//   WO dir    base-mobile WO-0001 (resolved from the DB connection table, like the store does)
//   ✦ sources docket docs/*.md (the WO-0051 default store-scan union)
//   probe log ../cc-surface/raw/c1.log (real categories split, captured 2026-08-2x)
//
// Usage: npx tsx docs/probes/token-tour/measure.ts > tour-output.md
// Token figures marked "est" are chars/4 — an ESTIMATE, not a tokenizer count; real token
// counts appear only where a provider reported them (session cost_*, probe logs).
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { homedir } from 'node:os';

import { parseOrderMd, architectPrompt, implementerPrompt, verifierPrompt, architectReviewPrompt } from '../../../src/core/order-md';
import { parsePlanSteps } from '../../../src/core/plan-steps';
import { roadmapDraftPrompt } from '../../../src/core/roadmap-draft';

const DB_MAIN = join(homedir(), 'Library/Application Support/docket/docket.db');
const DB_BAK = DB_MAIN + '.bak-20260822-wo0038-incident';
const est = (s: string) => Math.round(s.length / 4); // ESTIMATE: chars/4
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';

function openRo(p: string): DatabaseSync | null {
  try { return new DatabaseSync(p, { readOnly: true }); } catch { return null; }
}

// ---------------------------------------------------------------- S1 · cost accounting

interface Row { [k: string]: unknown }
const q = (db: DatabaseSync, sql: string): Row[] => (db.prepare(sql).all() as Row[]);

function s1(): void {
  console.log('## S1 — Cost accounting (per session, both DBs)\n');
  console.log('| db | # | role | stage | in | out | usd | dur | tok/min | transcript |');
  console.log('|---|---|------|-------|----|-----|-----|-----|--------|-----------|');
  for (const [label, path] of [['main', DB_MAIN], ['bak-0038', DB_BAK]] as const) {
    const db = openRo(path); if (!db) { console.log(`| ${label} | _unavailable_ | | | | | | | | | |`); continue; }
    const rows = q(db, `SELECT id, role, step_idx, cost_tokens_in tin, cost_tokens_out tout, cost_usd usd,
        started_at, ended_at, length(transcript) tr FROM session ORDER BY id`);
    for (const r of rows) {
      const durMin = r.started_at && r.ended_at
        ? (Date.parse(String(r.ended_at)) - Date.parse(String(r.started_at))) / 60000 : null;
      const tpm = durMin && durMin > 0.5 ? Math.round((Number(r.tin) + Number(r.tout)) / durMin) : null;
      const stage = r.step_idx == null ? 'plan' : `step ${r.step_idx}${r.role === 'architect' ? ' verdict' : ''}`;
      console.log(`| ${label} | ${r.id} | ${r.role} | ${stage} | ${Number(r.tin).toLocaleString('en')} | ${Number(r.tout).toLocaleString('en')} | $${Number(r.usd).toFixed(2)} | ${durMin == null ? '—' : durMin.toFixed(1) + 'm'} | ${tpm == null ? '—' : tpm.toLocaleString('en')} | ${kb(Number(r.tr))} |`);
    }
    db.close();
  }
  const db = openRo(DB_MAIN)!;
  const tot = q(db, `SELECT SUM(cost_tokens_in) i, SUM(cost_tokens_out) o, SUM(cost_usd) u FROM session`)[0]!;
  const byRole = q(db, `SELECT role, COUNT(*) n, SUM(cost_tokens_in) i, SUM(cost_tokens_out) o, SUM(cost_usd) u FROM session GROUP BY role`);
  console.log('\nTotals (main DB): ' + Number(tot.i).toLocaleString('en') + ' in / ' + Number(tot.o).toLocaleString('en') + ' out / $' + Number(tot.u).toFixed(2));
  console.log('\n| role | sessions | in | out | usd | share |');
  console.log('|------|----------|----|-----|-----|-------|');
  for (const r of byRole)
    console.log(`| ${r.role} | ${r.n} | ${Number(r.i).toLocaleString('en')} | ${Number(r.o).toLocaleString('en')} | $${Number(r.u).toFixed(2)} | ${(100 * Number(r.u) / Number(tot.u)).toFixed(0)}% |`);
  db.close();
}

// ---------------------------------------------------------------- S2 · transcript mix

interface Line { speaker?: string; kind?: string; tool?: string; detail?: string; summary?: string; callId?: string }

function s2(): void {
  console.log('\n## S2 — Transcript composition (stored checkpoint bytes)\n');
  const db = openRo(DB_MAIN)!;
  const rows = q(db, 'SELECT id, role, transcript FROM session ORDER BY id');
  const aggTool = new Map<string, { n: number; bytes: number }>();
  let overCap = 0, overCapBytes = 0, biggest: Array<{ s: number; id: number; head: string }> = [];
  for (const r of rows) {
    const lines: Line[] = JSON.parse(String(r.transcript));
    const by = new Map<string, number>();
    for (const l of lines) by.set(l.speaker ?? l.kind ?? '?', (by.get(l.speaker ?? l.kind ?? '?') ?? 0) + JSON.stringify(l).length);
    const total = [...by.values()].reduce((a, b) => a + b, 0);
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / total).toFixed(0)}%`).join(' · ');
    console.log(`- session ${r.id} (${r.role}, ${kb(total)}): ${parts}`);
    const toolOf = new Map<string, string>();
    for (const l of lines) if (l.speaker === 'tool_use' && l.callId) toolOf.set(l.callId, l.tool ?? '?');
    for (const l of lines) if (l.speaker === 'tool_result' && l.callId) {
      const t = toolOf.get(l.callId) ?? '(orphan)';
      const b = (l.summary ?? '').length;
      const e = aggTool.get(t) ?? { n: 0, bytes: 0 }; e.n++; e.bytes += b; aggTool.set(t, e);
      if (b > 200) { overCap++; overCapBytes += b; }
      biggest.push({ s: b, id: Number(r.id), head: (l.summary ?? '').slice(0, 70).replace(/\n/g, ' ') });
    }
  }
  db.close();
  console.log('\n| tool | results | result bytes | est tokens |');
  console.log('|------|---------|--------------|-----------|');
  for (const [t, e] of [...aggTool].sort((a, b) => b[1].bytes - a[1].bytes))
    console.log(`| ${t} | ${e.n} | ${e.bytes.toLocaleString('en')} | ~${est('x'.repeat(e.bytes)).toLocaleString('en')} |`);
  console.log(`\nCap bypass (string-content results > 200 chars): ${overCap} results, ${(overCapBytes / 1024).toFixed(0)} KB total`);
  console.log('\nLargest single stored results:');
  for (const b of biggest.sort((a, b) => b.s - a.s).slice(0, 5))
    console.log(`- s${b.id} ${kb(b.s)}: "${b.head}…"`);
}

// ---------------------------------------------------------------- S3 · prompt assembly

function s3(): void {
  console.log('\n## S3 — Offline prompt assembly (byte-exact, real inputs)\n');
  const db = openRo(DB_MAIN)!;
  const conn = q(db, "SELECT local_path FROM connection WHERE workspace_id='base-mobile'")[0]!;
  const woDirRoot = join(String(conn.local_path), 'docs/work-orders');
  const woDir = readdirSync(woDirRoot).find((d) => d.startsWith('WO-0001'))!;
  const woDirAbs = join(woDirRoot, woDir);
  const orderMd = readFileSync(join(woDirAbs, 'order.md'), 'utf8');
  const planText = readFileSync(join(woDirAbs, 'plan.md'), 'utf8');
  const parsed = parseOrderMd(orderMd);
  const steps = parsePlanSteps(planText);
  const orderMdPath = join(woDirAbs, 'order.md');
  db.close();

  const c = (s: string) => `${s.length.toLocaleString('en')} ch / ~${est(s).toLocaleString('en')} tok est`;
  const table: Array<[string, string, string]> = [];
  table.push(['architect plan (skeleton only)', c(architectPrompt({ objective: '', reviewMode: 'gates', orderMdPath: 'X' }).replace(parsed.objective ?? '', '')), 'skeleton']);
  table.push(['architect plan (real)', c(architectPrompt({ objective: parsed.objective ?? '', reviewMode: 'gates', orderMdPath })), 'goal: objective inline']);
  for (const st of steps.slice(0, 3)) {
    const ip = implementerPrompt({ objective: parsed.objective ?? '', step: st, planText, orderMdPath });
    table.push([`implementer step ${st.idx}`, c(ip), `skeleton + objective + FULL plan.md (${c(planText)})`]);
  }
  const vp = steps.find((s) => s.idx === 2);
  if (vp) table.push([`verifier step ${vp.idx}`, c(verifierPrompt({ objective: parsed.objective ?? '', step: vp, planText, orderMdPath })), 'same embed shape']);
  for (const st of steps.slice(0, 2)) {
    const rp = architectReviewPrompt({ objective: parsed.objective ?? '', step: st, reportBody: '', planText, orderMdPath, reportPath: `reports/step-${String(st.idx).padStart(2, '0')}-${st.role}.md` });
    table.push([`review step ${st.idx}`, c(rp), 'skeleton + objective + FULL plan.md (report stays a PATH)']);
  }

  // ✦ draft prompt at docket scale: the default store-scan union (ALL docs/ included, WO-0051 default)
  const docketRoot = process.cwd();
  const docsRoot = join(docketRoot, 'docs');
  const docPaths: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) docPaths.push('docs/' + relative(docsRoot, p)); } };
  walk(docsRoot);
  const goalNote = 'Karar deposunu esas alarak yol haritasını çıkar: fazlar, görevler, bağımlılıklar. (Sample goal note — the operator text is free-form.)';
  const draftPrompt = roadmapDraftPrompt({ workspaceSlug: 'docket', knownRepos: ['docket'], roadmapMdPath: 'docs/roadmap.md', goalNote, docPaths, freeExplore: true });
  table.push([`✦ draft (docket, ${docPaths.length} paths)`, c(draftPrompt), `skeleton + goal + ${docPaths.length}-path union`]);
  const unionBytes = docPaths.reduce((a, p) => a + p.length + 2, 0);
  const docBytes = docPaths.reduce((a, p) => a + statSync(join(docketRoot, p)).size, 0);
  console.log('| first prompt | assembled size | composition |');
  console.log('|--------------|---------------|-------------|');
  for (const [a, b, d] of table) console.log(`| ${a} | ${b} | ${d} |`);

  console.log(`\n✦ path union alone: ${unionBytes.toLocaleString('en')} ch (~${est('x'.repeat(unionBytes))} tok est).`);
  console.log(`✦ READ mass behind the union (agent reads them, Docket does not): ${docPaths.length} files, ${kb(docBytes)} = ~${Math.round(docBytes / 4 / 1000).toLocaleString('en')}k tok est — vs a 200k window / 1M [1m].`);
  const sizes = docPaths.map((p) => ({ p, b: statSync(join(docketRoot, p)).size })).sort((a, b) => b.b - a.b);
  console.log('\nTop-10 largest docs in the default set:');
  for (const s of sizes.slice(0, 10)) console.log(`- ${kb(s.b)} ${s.p}`);
  const planEmbeds = steps.length * 2; // every step drive + every review embeds the full plan.md
  console.log(`\nplan.md re-embeds across one WO lifecycle (${steps.length} steps): ${planEmbeds}× full plan.md (${c(planText)} each) ≈ ~${(est(planText) * planEmbeds).toLocaleString('en')} tok est of repeated identical text.`);
}

// ------------------------------------------------- S3b · ambient harness overhead (probe c1)

function s3b(): void {
  console.log('\n## S3b — Ambient harness fixed overhead (real, from ../cc-surface/raw/c1.log)\n');
  const log = readFileSync(join(process.cwd(), 'docs/probes/cc-surface/raw/c1.log'), 'utf8');
  const cats = [...log.matchAll(/categories":"([^"]*)"/g)].map((m) => m[1]!);
  if (cats.length === 0) { console.log('(no categories captured)'); return; }
  const first = cats[0]!.split('|').map((kv) => kv.split(':'));
  console.log('| context category | tokens (first reading) |');
  console.log('|------------------|-----------------------|');
  for (const [k, v] of first) console.log(`| ${k.trim()} | ${v?.trim()} |`);
  const fixed = first.filter(([k]) => !/Messages|Free space|Autocompact/.test(k ?? '')).reduce((a, [, v]) => a + Number(v), 0);
  console.log(`\nFixed per-turn overhead (tools+agents+memory+skills): ~${fixed.toLocaleString('en')} tokens — vs Docket's own largest first-prompt skeleton (<1k tok est).`);
}

s1(); s2(); s3(); s3b();
