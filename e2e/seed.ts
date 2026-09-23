// e2e/seed.ts — builds a throwaway workspace + WOs across stages for the UI driver (WO-0031).
// Run via tsx: prints `DB=<path>` for the driver. Never touches the operator's real db/repo.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'docket-e2e-'));
const repo = join(root, 'repo');
mkdirSync(join(repo, 'docs', 'work-orders'), { recursive: true });

// WO-0093: the fixture repos are REAL local git repos — every connected repo a WO can target is
// one the worktree automation may branch from (`git worktree add -b` at the start click). One
// seed commit on main; everything the store authors afterwards stays untracked (the operator's
// commit). `branch` renames the default for repos that must LACK main (the prep-failure world).
const gitSeed = (dir: string, branch = 'main'): void => {
  execFileSync('git', ['init', '-q', '-b', branch, dir]);
  execFileSync('git', ['-C', dir, 'add', '-A']);
  execFileSync('git', ['-C', dir, '-c', 'user.email=e2e@docket.local', '-c', 'user.name=e2e', 'commit', '-q', '--allow-empty', '-m', 'seed']);
};
// WO-0074 (WO-0069's tightened derivation): a resolvable verifier pointer needs a real file —
// the closed fixtures' reports point here.
mkdirSync(join(repo, 'src'), { recursive: true });
writeFileSync(join(repo, 'src', 'a.ts'), 'export {};\n');
gitSeed(repo);

const { createStore } = await import('../src/adapters/store/index.ts');
const store = createStore(join(root, 'e2e.db'));

const ws = await store.createWorkspace({
  label: 'e2e',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});

const mk = (title: string, description: string, permissionRule?: 'ask_every' | 'risky_excluded' | 'full_auto') =>
  store.createWorkOrder({
    workspaceId: ws.id,
    title,
    description,
    trackRepos: ws.repos,
    reviewMode: 'gates',
    contextFiles: [],
    ...(permissionRule ? { permissionRule } : {}),
  });

// 1) written — the fresh queue (explicit risky_excluded: the safe default is ask_every now; this WO's
//    E2E spec exercises the risky-excluded cadence + badge)
await mk('Yeni iş emri örneği', 'E2E: freshly created, awaiting a plan request.', 'risky_excluded');

// 2) architect_approval — a pending plan (restart-recovery surface)
const wo2 = await mk('Plan bekliyor', 'E2E: plan proposed, awaiting approval.');
store.savePendingPlan(wo2.id, ['# E2E plan', '', '```steps', '[{"role":"implementer","aim":"a","scope":"all"}]', '```', ''].join('\n'));

// 3) implementation — step done + verdict, so the detail has content (+ costed/timed sessions: the
//    per-step ⏱/$ meta and the Denetim ledger have real numbers to show)
const wo3 = await mk('Uygulama sürüyor', 'E2E: one step done with a proceed verdict.');
await store.approvePlan(wo3.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n');
store.recordStep(wo3.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo3.id, 1, 'proceed', 'ok');
store.recordSession({
  providerSessionId: 'e2e-wo3-run',
  owner: { kind: 'wo', workOrderId: wo3.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [{ speaker: 'assistant', text: 'E2E: did the work.' }],
  cost: { tokensIn: 12_000, tokensOut: 3_400, usd: 0.96 },
  startedAt: new Date('2026-08-16T14:22:00Z').toISOString(),
  endedAt: new Date('2026-08-16T14:28:00Z').toISOString(),
});
store.recordSession({
  providerSessionId: 'e2e-wo3-review',
  owner: { kind: 'wo', workOrderId: wo3.id },
  role: 'architect',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 5_000, tokensOut: 900, usd: 0.41 },
  startedAt: new Date('2026-08-16T14:29:00Z').toISOString(),
  endedAt: new Date('2026-08-16T14:31:00Z').toISOString(),
});

// 4) closed — the drawer (+ the three-session ledger the archive table renders by default)
const wo4 = await mk('Kapandı', 'E2E: a closed work order.');
// WO-0074 (WO-0069): `closed` derives only over a RECORDED verifier report whose file pointers
// resolve — the plan carries the verifier leg and the report lands before the close attempts.
await store.approvePlan(wo4.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```\n');
store.recordStep(wo4.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo4.id, 1, 'proceed', 'ok');
store.recordStepReport(wo4.id, 2, 'verifier', 'checked `src/a.ts:1`');
store.recordStepVerdict(wo4.id, 2, 'proceed', 'ok');
store.recordSession({
  providerSessionId: 'e2e-wo4-plan',
  owner: { kind: 'wo', workOrderId: wo4.id },
  role: 'architect',
  status: 'idle',
  transcript: [],
  cost: { tokensIn: 20_000, tokensOut: 4_000, usd: 1.84 },
  startedAt: new Date('2026-08-16T14:09:00Z').toISOString(),
  endedAt: new Date('2026-08-16T14:14:00Z').toISOString(),
});
// WO-0031d: a free-form (unscoped) implementer run — the ledger names it "Bağımsız", never "Adım 0".
// No cost → the closed-WO total-cost assert ($6,27) is unchanged.
store.recordSession({
  providerSessionId: 'e2e-wo4-free',
  owner: { kind: 'wo', workOrderId: wo4.id },
  role: 'implementer',
  status: 'idle',
  transcript: [],
  startedAt: new Date('2026-08-16T14:15:00Z').toISOString(),
  endedAt: new Date('2026-08-16T14:15:30Z').toISOString(),
});
store.recordSession({
  providerSessionId: 'e2e-wo4-run',
  owner: { kind: 'wo', workOrderId: wo4.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 30_000, tokensOut: 8_000, usd: 2.4 },
  startedAt: new Date('2026-08-16T14:16:00Z').toISOString(),
  endedAt: new Date('2026-08-16T14:34:00Z').toISOString(),
});
store.recordSession({
  providerSessionId: 'e2e-wo4-verify',
  owner: { kind: 'wo', workOrderId: wo4.id },
  role: 'verifier',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 24_000, tokensOut: 5_000, usd: 2.03 },
  startedAt: new Date('2026-08-16T15:10:00Z').toISOString(),
  endedAt: new Date('2026-08-16T15:29:00Z').toISOString(),
});
await store.closeWorkOrder(wo4.id, 'e2e closed');

// 4b) WO-0055 — an ARCHIVED session whose transcript carries agent-task rows: the archived card's
//     döküm must re-nest identically (the delegation block adopting its task, the subagent's own
//     rows nested inside, the real report winning the pair over the end digest).
const woAgent = await mk('Ajan arşivi', 'E2E: an archived session with agent-task rows.');
await store.approvePlan(woAgent.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n');
store.recordStep(woAgent.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordSession({
  providerSessionId: 'e2e-wo-agent',
  owner: { kind: 'wo', workOrderId: woAgent.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [
    { speaker: 'note', kind: 'session_started', detail: '2026-08-30T10:00:00.000Z' },
    { speaker: 'assistant', text: 'Önce bir alt ajan çalıştırıyorum.' },
    { speaker: 'tool_use', tool: 'Agent', detail: '', callId: 'cT' },
    { speaker: 'agent_task', phase: 'started', taskId: 't-arc', callId: 'cT', description: 'Dosyaları tara' },
    { speaker: 'tool_use', tool: 'Bash', detail: 'ls', callId: 'cN1', parentToolUseId: 'cT' },
    { speaker: 'tool_result', summary: 'docs src package.json', isError: false, callId: 'cN1', parentToolUseId: 'cT' },
    { speaker: 'agent_task', phase: 'ended', taskId: 't-arc', status: 'completed', summary: 'Dört dosya buldum' },
    { speaker: 'tool_result', summary: 'Alt ajan raporu: dört dosya', isError: false, callId: 'cT' },
    // a BEHEADED end (its start fell off the 800-cap in a long session): ONE honest row, word + digest
    { speaker: 'agent_task', phase: 'ended', taskId: 't-ghost', status: 'failed', summary: 'Yetim özet' },
    { speaker: 'note', kind: 'session_done', detail: '2026-08-30T10:02:00.000Z' },
  ],
  cost: { tokensIn: 9_000, tokensOut: 1_200, usd: 0.31 },
  startedAt: new Date('2026-08-30T10:00:00Z').toISOString(),
  endedAt: new Date('2026-08-30T10:02:00Z').toISOString(),
});

// 4c) WO-0074 (WO-0069): a FULLY-verified closable WO — the Kapat-dialog spec closes this one and
//     the honest derivation completes (merged_at stamped at close + the record-time verification
//     gate + the docs sha) → the green glow, the Kapandı readout, the seal. Two-leg plan on
//     purpose: the single-leg fixture ('Uygulama sürüyor') stays the unknown-verification chip's
//     pin (the DOSYA-record spec's assert).
const woDone = await mk('Tamamlanmış iş', 'E2E: closable with the verifier leg satisfied — the dialog-close completes.');
await store.approvePlan(woDone.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"tamamlanma turu","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```\n');
store.recordStep(woDone.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(woDone.id, 1, 'proceed', 'ok');
store.recordStepReport(woDone.id, 2, 'verifier', 'checked `src/a.ts:1`');
store.recordStepVerdict(woDone.id, 2, 'proceed', 'ok');
store.recordSession({
  providerSessionId: 'e2e-wo-done-run',
  owner: { kind: 'wo', workOrderId: woDone.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 15_000, tokensOut: 3_000, usd: 1.2 },
  startedAt: new Date('2026-08-16T17:00:00Z').toISOString(),
  endedAt: new Date('2026-08-16T17:06:00Z').toISOString(),
});
store.recordSession({
  providerSessionId: 'e2e-wo-done-verify',
  owner: { kind: 'wo', workOrderId: woDone.id },
  role: 'verifier',
  status: 'idle',
  stepIdx: 2,
  transcript: [],
  cost: { tokensIn: 8_000, tokensOut: 1_500, usd: 0.42 },
  startedAt: new Date('2026-08-16T17:07:00Z').toISOString(),
  endedAt: new Date('2026-08-16T17:09:00Z').toISOString(),
});

// 5) stopped_asking (WO-0031c) — an implementation WO paused on a permission ask: the amber moment
//    (ask card + `Sıra sende` substrip + glow-signal) rendered statically from the persisted session.
//    WO-0031f: the step aim is distinctive — the H-4 band-focus spec reads it back.
const wo5 = await mk('İzin bekliyor', 'E2E: a step paused on a permission ask.');
await store.approvePlan(wo5.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"askı senaryosunu yürü","scope":"all"}]\n```\n');
store.recordStep(wo5.id, 1, { status: 'active' });
store.recordSession({
  providerSessionId: 'e2e-ask-session',
  owner: { kind: 'wo', workOrderId: wo5.id },
  role: 'implementer',
  status: 'stopped_asking',
  stepIdx: 1,
  transcript: [{ speaker: 'assistant', text: 'E2E: about to write a file.' }],
  asks: [{ requestId: 'e2e-ask-r1', tool: 'Write', input: { file_path: 'docs/example.md' } }],
  startedAt: new Date('2026-08-16T14:00:00Z').toISOString(),
});

// 6) tur-2 D1: a second workspace whose ONLY work order is closed — the "Bütün işler tamam"
//    platform board. Shares ws1's decision store ON PURPOSE: numbering counts the store dir, so a
//    shared store keeps the global WO-NNNN primary keys unique (a second store would collide — TD-035).
const ws2 = await store.createWorkspace({
  label: 'arşiv',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});
const wo6 = await store.createWorkOrder({
  workspaceId: ws2.id,
  title: 'Eski iş',
  description: 'E2E: already closed — the only-closed board platform.',
  trackRepos: ws2.repos,
  reviewMode: 'gates',
  contextFiles: [],
});
// WO-0074 (WO-0069): the same honest verifier leg — the all-done platform exists only when the
// sole WO truly derives `closed`.
await store.approvePlan(wo6.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```\n');
store.recordStep(wo6.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo6.id, 1, 'proceed', 'ok');
store.recordStepReport(wo6.id, 2, 'verifier', 'checked `src/a.ts:1`');
store.recordStepVerdict(wo6.id, 2, 'proceed', 'ok');
await store.closeWorkOrder(wo6.id, 'e2e closed long ago');

// 7) WO-0031e tur-3: a third workspace whose only work order is CLOSABLE but not closed — the
//    awaiting-close platform board ("N iş kapatılmayı bekliyor" + CTA + ▸ Kapatılabilir). Same
//    shared decision store (TD-035 numbering). Its one implementer session carries a 4-line
//    transcript: the audit-row expansion spec. The deliberately long Objective makes the Belgeler
//    section overflow 980×620 so the tab-scroll spec has deterministic room to scroll.
const ws3 = await store.createWorkspace({
  label: 'raf',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});
const wo7 = await store.createWorkOrder({
  workspaceId: ws3.id,
  title: 'Raf işi',
  description: [
    'E2E: closable but not closed — the awaiting-close platform.',
    'Bu açıklama bilinçli olarak uzun tutuldu: Belgeler bölümü 980×620 gövdesinde rahatça',
    'taşmalı ki sekme değişimi kaydırması gerçek bir scroll mesafesi bulsun. Aşağıda amaç',
    'metni uzatmaktan başka bir işlevi olmayan cümleler var. Satır bir. Satır iki. Satır üç.',
    'Satır dört. Satır beş. Satır altı. Satır yedi. Satır sekiz. Satır dokuz. Satır on.',
    'Satır on bir. Satır on iki. Satır on üç. Satır on dört. Satır on beş. Satır on altı.',
    'Satır on yedi. Satır on sekiz. Satır on dokuz. Satır yirmi. Satır yirmi bir. Satır',
    'yirmi iki. Satır yirmi üç. Satır yirmi dört. Satır yirmi beş. Bu kadar yeter.',
  ].join(' '),
  trackRepos: ws3.repos,
  reviewMode: 'gates',
  contextFiles: [],
});
// WO-0074 (WO-0069): the awaiting-close platform's live close must COMPLETE the honest
// derivation (awaiting → all-done) — the two-leg plan + the resolvable verifier report.
await store.approvePlan(wo7.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```\n');
store.recordStep(wo7.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo7.id, 1, 'proceed', 'ok');
store.recordStepReport(wo7.id, 2, 'verifier', 'checked `src/a.ts:1`');
store.recordStepVerdict(wo7.id, 2, 'proceed', 'ok');
store.recordSession({
  providerSessionId: 'e2e-wo7-run',
  owner: { kind: 'wo', workOrderId: wo7.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [
    { speaker: 'assistant', text: 'Raf: döküm satırı 1 — plan onaylandı.' },
    { speaker: 'tool_use', tool: 'Bash', detail: 'npm test' },
    { speaker: 'tool_result', summary: 'Raf: döküm satırı 3 — testler geçti.', isError: false },
    { speaker: 'system', text: 'Raf: döküm satırı 4 — bitti.' },
  ],
  cost: { tokensIn: 9_000, tokensOut: 2_000, usd: 0.55 },
  startedAt: new Date('2026-08-16T16:00:00Z').toISOString(),
  endedAt: new Date('2026-08-16T16:05:00Z').toISOString(),
});

// 8) WO-0031f review: ten DONE steps with reports — the report-switch scroll spec (open an early
//    report, then a late one: the sibling closes, the new one opens AND the view arrives at its top;
//    ten rows guarantee real scroll travel under the 980×620 console).
const wo8 = await mk('Rapor turu', 'E2E: ten done steps — the report switch scroll.');
await store.approvePlan(
  wo8.id,
  '# E2E plan\n\n```steps\n' +
    JSON.stringify(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ role: n % 2 === 0 ? 'verifier' : 'implementer', aim: `adım ${n} amacı`, scope: 'all' })),
    ) +
    '\n```\n',
);
for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
  store.recordStep(wo8.id, n, { status: 'done', reportPath: `reports/step-0${n}-${n % 2 === 0 ? 'verifier' : 'implementer'}.md` });
  store.recordStepVerdict(wo8.id, n, 'proceed', 'ok');
}
store.recordSession({
  providerSessionId: 'e2e-wo8-run1',
  owner: { kind: 'wo', workOrderId: wo8.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 4_000, tokensOut: 900, usd: 0.31 },
  startedAt: new Date('2026-08-16T16:20:00Z').toISOString(),
  endedAt: new Date('2026-08-16T16:24:00Z').toISOString(),
});
store.recordSession({
  providerSessionId: 'e2e-wo8-run6',
  owner: { kind: 'wo', workOrderId: wo8.id },
  role: 'verifier',
  status: 'idle',
  stepIdx: 6,
  transcript: [],
  cost: { tokensIn: 6_000, tokensOut: 1_200, usd: 0.44 },
  startedAt: new Date('2026-08-16T17:00:00Z').toISOString(),
  endedAt: new Date('2026-08-16T17:05:00Z').toISOString(),
});

// 9) WO-0032: a fourth workspace ('çöp') with two WOs — the workspace-deletion specs' payload. Same
//    shared decision store (TD-035 numbering). The delete spec removes this whole workspace; nothing
//    else references it, so its permanent removal cannot disturb the other specs.
const ws4 = await store.createWorkspace({
  label: 'çöp',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});
await store.createWorkOrder({ workspaceId: ws4.id, title: 'Çöp işi 1', description: 'E2E: deleted with its workspace.', trackRepos: ws4.repos, reviewMode: 'gates', contextFiles: [] });
await store.createWorkOrder({ workspaceId: ws4.id, title: 'Çöp işi 2', description: 'E2E: deleted with its workspace.', trackRepos: ws4.repos, reviewMode: 'gates', contextFiles: [] });

// 10) WO-0045 operator tempo: a clean two-step APPROVED plan, nothing run — the Akış chip, the steer
//     composer, and the manuel-card specs' stage. Both steps pending; review_mode gates.
const wo9 = await mk('Akış turu', 'E2E: two-step approved plan, nothing run — the tempo surface.');
await store.approvePlan(
  wo9.id,
  '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"birinci adım","scope":"all"},{"role":"verifier","aim":"ikinci adım","scope":"all"}]\n```\n',
);

// 11) WO-0046 live honesty: the same clean two-step stage for the context readout and the staleness
//     line specs — flow stays AUTO so opening the detail self-starts step 1 (the fake drive the
//     scripted context_usage / old-stamped entries ride).
const wo10 = await mk('Doluluk turu', 'E2E: two-step approved plan, nothing run — the live-honesty surface.');
await store.approvePlan(
  wo10.id,
  '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"birinci adım","scope":"all"},{"role":"verifier","aim":"ikinci adım","scope":"all"}]\n```\n',
);

// 12) TD-053 (WO-0046 checkpoint): a WRITTEN-stage WO with no plan — the detail mounts with NO
//     steps, so runIdx's initializer finds nothing. The spec scripts a plan + approval WITHOUT
//     leaving the detail: the first step must self-start (the mount-only fill was the bug).
const wo11 = await mk('TD-053 turu', 'E2E: no plan yet — approve without re-entry.');

// 13) WO-0047 budget gate: two threshold-bearing workspaces — 'uyarı' ($4.20 of a $5 cap at warn
//     80% + a NULL-cost in-month row → the known-spend qualifier on every line) and 'kapı' ($5.10
//     of the same cap → hard stop; WO-B carries only a NULL-cost row so observed stays exactly
//     5.10 and the raise prefill is max(5.10+10, 5) = 15.1). Same shared decision store (TD-035
//     numbering). Dates are COMPUTED from the seed moment — the window is the CURRENT UTC month,
//     fixed stamps would age out at a month boundary (day ≤ 28 guards the 31st-in-a-30-day trap).
//     Steps stay pending (no recordStep): opening the detail auto-starts step 1 — allowed under
//     warn, REFUSED at the cap; the sessions' idle rows are only the spend the gate reads.
const ONE_STEP_PLAN = '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n';
const monthDay = (day: number, hour = 12): string => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), Math.min(day, 28), hour)).toISOString();
};
const wsWarn = await store.createWorkspace({
  label: 'uyarı',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});
await store.setBudget(wsWarn.id, { capUsd: 5, warnPercent: 80 });
const woWarn = await store.createWorkOrder({
  workspaceId: wsWarn.id,
  title: 'Uyarı işi',
  description: 'E2E: warn-level spend — the line, never the gate.',
  trackRepos: wsWarn.repos,
  reviewMode: 'gates',
  contextFiles: [],
});
await store.approvePlan(woWarn.id, ONE_STEP_PLAN);
store.recordSession({
  providerSessionId: 'e2e-budget-warn-run',
  owner: { kind: 'wo', workOrderId: woWarn.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 9_000, tokensOut: 2_000, usd: 4.2 },
  startedAt: monthDay(3),
  endedAt: monthDay(3),
});
store.recordSession({
  providerSessionId: 'e2e-budget-warn-null',
  owner: { kind: 'wo', workOrderId: woWarn.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  startedAt: monthDay(4),
  endedAt: monthDay(4),
});
const wsStop = await store.createWorkspace({
  label: 'kapı',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});
await store.setBudget(wsStop.id, { capUsd: 5, warnPercent: 80 });
const woStopA = await store.createWorkOrder({
  workspaceId: wsStop.id,
  title: 'Kapı işi A',
  description: 'E2E: over the cap — the refusal card, kept.',
  trackRepos: wsStop.repos,
  reviewMode: 'gates',
  contextFiles: [],
});
await store.approvePlan(woStopA.id, ONE_STEP_PLAN);
store.recordSession({
  providerSessionId: 'e2e-budget-stop-a',
  owner: { kind: 'wo', workOrderId: woStopA.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 9_000, tokensOut: 2_000, usd: 5.1 },
  startedAt: monthDay(5),
  endedAt: monthDay(5),
});
const woStopB = await store.createWorkOrder({
  workspaceId: wsStop.id,
  title: 'Kapı işi B',
  description: 'E2E: over the cap — the raise and the re-run.',
  trackRepos: wsStop.repos,
  reviewMode: 'gates',
  contextFiles: [],
});
await store.approvePlan(woStopB.id, ONE_STEP_PLAN);
store.recordSession({
  providerSessionId: 'e2e-budget-stop-b',
  owner: { kind: 'wo', workOrderId: woStopB.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  startedAt: monthDay(6),
  endedAt: monthDay(6),
});

// WO-0035: pin the suite's locale to tr. The default is system detection and Playwright's Electron
// runs under en-US — without this row the app would boot EN and every Turkish locator would break.
// The row is load-bearing for as long as detection is the default (order.md Notes).
await store.setLocale('tr');

// 14) WO-0049 roadmap GUI: a 'yol' workspace — the same SHARED decision store (TD-035 numbering)
//     + api/mobile code-repo dirs (the decision store 'repo' stays the store; tasks target code
//     repos only). A 5-faz roadmap.md: f0 done (2 closed WOs, $4.20) · f1 running (t1 closed $0.50,
//     t2 = sıradaki, t3 carries the OPEN WO chip at $1.62) · f2 blocked by f1 with notes (the Bloke
//     line, verbatim) · f3 done (1 closed WO $1.00 — the second done faz, so the fold runs) ·
//     f4 planlı. One ORPHAN open WO (task: f9-t9) pins the head's orphan-count + the detail chip's
//     degrade. Pinned facts: head `2/5 faz tamam · 2 açık iş emri · $7,32`; fold
//     `2 tamamlanan faz · f0 · f3 · 3 WO · $5,20`. The created ids are PRINTED (ROADMAP=) —
//     numbering is store-global and drifts as this seed evolves; specs never hard-code numbers.
mkdirSync(join(root, 'api'));
mkdirSync(join(root, 'mobile'));
gitSeed(join(root, 'api'));
gitSeed(join(root, 'mobile'));
const wsYol = await store.createWorkspace({
  label: 'yol',
  repos: [{ path: repo, remote: 'e2e-remote' }, { path: join(root, 'api') }, { path: join(root, 'mobile') }],
  decisionStorePath: repo,
});
const mkYol = (title: string, taskRef: string) =>
  store.createWorkOrder({
    workspaceId: wsYol.id,
    title,
    description: 'E2E: yol haritası bağlantılı iş emri.',
    trackRepos: wsYol.repos,
    reviewMode: 'gates',
    contextFiles: [],
    taskRef,
  });
const closeYol = async (wo: Awaited<ReturnType<typeof mkYol>>, usd: number) => {
  await store.approvePlan(wo.id, ONE_STEP_PLAN);
  store.recordStep(wo.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
  store.recordStepVerdict(wo.id, 1, 'proceed', 'ok');
  store.recordSession({
    providerSessionId: `e2e-yol-${wo.id}`,
    owner: { kind: 'wo', workOrderId: wo.id },
    role: 'implementer',
    status: 'idle',
    stepIdx: 1,
    transcript: [],
    cost: { tokensIn: 9_000, tokensOut: 2_000, usd },
    startedAt: monthDay(7),
    endedAt: monthDay(7),
  });
  await store.closeWorkOrder(wo.id, 'e2e yol closed');
};
await closeYol(await mkYol('Yol temel 1', 'f0-t1'), 3.1);
await closeYol(await mkYol('Yol temel 2', 'f0-t2'), 1.1);
await closeYol(await mkYol('Yol profil', 'f1-t1'), 0.5);
await closeYol(await mkYol('Yol altyapı', 'f3-t1'), 1.0);
const woFoto = await mkYol('Yol fotoğraf', 'f1-t3'); // OPEN — the running task's chip
store.recordSession({
  providerSessionId: `e2e-yol-${woFoto.id}`,
  owner: { kind: 'wo', workOrderId: woFoto.id },
  role: 'implementer',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 9_000, tokensOut: 2_000, usd: 1.62 },
  startedAt: monthDay(8),
  endedAt: monthDay(8),
});
const woYetim = await mkYol('Yol yetim', 'f9-t9'); // OPEN — the orphan ref: head-counted, chip-degraded
const { buildRoadmapMd } = await import('../src/core/roadmap-md.ts');
await store.saveRoadmap(
  wsYol.id,
  buildRoadmapMd({
    workspaceSlug: wsYol.id as string, // the derivation compares the front-matter against the workspace ID
    title: 'Yol Haritası',
    prose: 'E2E: fazlar, görevler ve bağımlılıklar.',
    fazlar: [
      {
        id: 'f0', title: 'Temel', aim: 'Kaide', blockedBy: [],
        tasks: [
          { id: 'f0-t1', title: 'Temel görev 1', repo: 'api' },
          { id: 'f0-t2', title: 'Temel görev 2', repo: 'api' },
        ],
      },
      {
        id: 'f1', title: 'Profil', aim: 'Profil yüzeyi', blockedBy: [],
        tasks: [
          { id: 'f1-t1', title: 'Profil oluşturma', repo: 'api' },
          { id: 'f1-t2', title: 'Doğrulama akışı', repo: 'api' }, // sıradaki — the first spawnable
          { id: 'f1-t3', title: 'Fotoğraf yükleme', repo: 'mobile' }, // kosuyor — the open WO chip
        ],
      },
      {
        id: 'f2', title: 'Değerlendirme', blockedBy: ['f1'],
        notes: 'E2E bloke notu — Faz 1 bitmeden başlanmaz',
        tasks: [{ id: 'f2-t1', title: 'Puanlama', repo: 'api' }],
      },
      {
        id: 'f3', title: 'Altyapı', blockedBy: [],
        tasks: [{ id: 'f3-t1', title: 'Depo düzeni', repo: 'api' }],
      },
      {
        id: 'f4', title: 'Bildirimler', aim: 'Push ve e-posta', blockedBy: [],
        tasks: [{ id: 'f4-t1', title: 'Push kanalı', repo: 'mobile' }],
      },
    ],
  }),
);
console.log(`ROADMAP=${JSON.stringify({ foto: String(woFoto.id), yetim: String(woYetim.id) })}`);

// 15) WO-0050 the draft worlds. 'taslak': a clean workspace, NO roadmap.md (the absent face + the
//     ✦ gate — spec 1's happy generate flow starts from scratch; the file never pre-exists).
//     'taslak-kirli': a seeded INVALID draft row (no fence) + its draft session row — the card's
//     parse-guard face (Onayla absent, İtiraz et gone, Sürdür the one action — dogfood 2026-08-29).
mkdirSync(join(root, 'repo-taslak'), { recursive: true });
mkdirSync(join(root, 'repo-kirli'), { recursive: true });
gitSeed(join(root, 'repo-taslak'));
gitSeed(join(root, 'repo-kirli'));
const wsTaslak = await store.createWorkspace({
  label: 'taslak',
  repos: [{ path: join(root, 'repo-taslak'), remote: 'e2e-taslak' }],
  decisionStorePath: join(root, 'repo-taslak'),
});
const wsKirli = await store.createWorkspace({
  label: 'taslak-kirli',
  repos: [{ path: join(root, 'repo-kirli'), remote: 'e2e-kirli' }],
  decisionStorePath: join(root, 'repo-kirli'),
});
store.recordSession({
  providerSessionId: 'e2e-kirli-architect',
  owner: { kind: 'draft', workspaceId: wsKirli.id },
  role: 'architect',
  status: 'idle',
  transcript: [{ speaker: 'assistant', text: 'çit koymayı unuttum' }],
  cost: { tokensIn: 500, tokensOut: 120, usd: 0.04 },
  startedAt: monthDay(9),
  endedAt: monthDay(9),
});
store.saveRoadmapDraft(wsKirli.id, '---\nworkspace: nope\ntitle: Kirli\n---\n\n# Kirli\n\nProse var, çit yok.\n', { providerSessionId: 'e2e-kirli-architect' });
// 'taslak-olu' (dogfood 2026-08-29): the SAME invalid shape as kirli but DISPOSABLE — the dead
// ✦ drive's resume journey (Sürdür → re-proposal) runs here, so the shared kirli world stays
// pristine for its read-only card specs and the WO-0051 chip spec.
mkdirSync(join(root, 'repo-olu'), { recursive: true });
gitSeed(join(root, 'repo-olu'));
const wsOlu = await store.createWorkspace({
  label: 'taslak-olu',
  repos: [{ path: join(root, 'repo-olu'), remote: 'e2e-olu' }],
  decisionStorePath: join(root, 'repo-olu'),
});
store.recordSession({
  providerSessionId: 'e2e-olu-architect',
  owner: { kind: 'draft', workspaceId: wsOlu.id },
  role: 'architect',
  status: 'idle',
  transcript: [{ speaker: 'assistant', text: 'öldü, teklif yok' }],
  cost: { tokensIn: 500, tokensOut: 120, usd: 0.04 },
  startedAt: monthDay(9),
  endedAt: monthDay(9),
});
store.saveRoadmapDraft(wsOlu.id, '---\nworkspace: nope\ntitle: Ölü\n---\n\n# Ölü\n\nSürüş öldü, çit yok.\n', { providerSessionId: 'e2e-olu-architect' });
// 'taslak-kapi': the draft's OWN budget gate world — at its cap before any ✦ click (ascii label:
// slugify strips the Turkish ı, so the label IS the slug the draft md's front-matter must name).
mkdirSync(join(root, 'repo-kapi'), { recursive: true });
gitSeed(join(root, 'repo-kapi'));
const wsTaslakKapi = await store.createWorkspace({
  label: 'taslak-kapi',
  repos: [{ path: join(root, 'repo-kapi'), remote: 'e2e-kapi' }],
  decisionStorePath: join(root, 'repo-kapi'),
});
await store.setBudget(wsTaslakKapi.id, { capUsd: 5, warnPercent: 80 });
store.recordSession({
  providerSessionId: 'e2e-kapi-architect',
  owner: { kind: 'draft', workspaceId: wsTaslakKapi.id },
  role: 'architect',
  status: 'idle',
  transcript: [],
  cost: { tokensIn: 900, tokensOut: 200, usd: 5.1 },
  startedAt: monthDay(10),
  endedAt: monthDay(10),
});
console.log(`TASLAK=${JSON.stringify({ taslak: String(wsTaslak.id), kirli: String(wsKirli.id), olu: String(wsOlu.id) })}`);

// 16) WO-0051 the DEPO world. 'taslak-depo': a workspace whose structure root CARRIES documents —
//     two root faz docs + adr/ (2) + notlar/ (1) = 5 .md, grouped at the first directory segment;
//     plus an EXTERNAL candidate OUTSIDE the structure root (repo root's ROADMAP-DIS.md — the
//     scan never sees it; the dışarıdan channel's whole point). No roadmap.md: the absent face
//     keeps the ✦ gate. The existing taslak worlds keep empty roots byte-identical — their
//     dialogs degrade to 'belge bulunamadı' and every WO-0050 spec keeps its GENERATE semantics.
const repoDepo = join(root, 'repo-taslak-depo');
mkdirSync(join(repoDepo, 'docs', 'adr'), { recursive: true });
gitSeed(repoDepo); // committed BEFORE the doc writes below — the later .md files stay untracked
mkdirSync(join(repoDepo, 'docs', 'notlar'), { recursive: true });
writeFileSync(join(repoDepo, 'docs', 'faz-0-altyapi.md'), '# Faz 0\nKullanıcı altyapısı.\n', 'utf8');
writeFileSync(join(repoDepo, 'docs', 'faz-1-profil.md'), '# Faz 1\nAntrenör profili.\n', 'utf8');
writeFileSync(join(repoDepo, 'docs', 'adr', 'ADR-9001-olcek.md'), '# ADR-9001\nÖlçek kararı.\n', 'utf8');
writeFileSync(join(repoDepo, 'docs', 'adr', 'ADR-9002-kesif.md'), '# ADR-9002\nKeşif kararı.\n', 'utf8');
writeFileSync(join(repoDepo, 'docs', 'notlar', 'gorusme.md'), '# Görüşme\nNotlar.\n', 'utf8');
writeFileSync(join(repoDepo, 'ROADMAP-DIS.md'), '# Dış plan\nYapı kökünün dışında.\n', 'utf8');
const wsDepo = await store.createWorkspace({
  label: 'taslak-depo',
  repos: [{ path: repoDepo, remote: 'e2e-depo' }],
  decisionStorePath: repoDepo,
});
console.log(`TASLAK_DEPO=${JSON.stringify({ depo: String(wsDepo.id), external: join(repoDepo, 'ROADMAP-DIS.md') })}`);

// 17) WO-0051 review f6 — the FLAT world: a pure-root scan (no subdirectories) exercises the
//     dialog's file-row branch and the capped-rows moreline, which the grouped world never
//     touches. Ten root files: 8 visible rows + the '+2 belge — tümü dahil' tail.
const repoDuz = join(root, 'repo-taslak-duz');
mkdirSync(join(repoDuz, 'docs'), { recursive: true });
gitSeed(repoDuz); // committed BEFORE the ten root docs below — they stay untracked
for (let i = 0; i < 10; i++) writeFileSync(join(repoDuz, 'docs', `faz-${i}-duz.md`), `# Faz ${i}\nDüz kök belgesi.\n`, 'utf8');
const wsDuz = await store.createWorkspace({
  label: 'taslak-duz',
  repos: [{ path: repoDuz, remote: 'e2e-duz' }],
  decisionStorePath: repoDuz,
});
console.log(`TASLAK_DUZ=${JSON.stringify({ duz: String(wsDuz.id) })}`);

// 18) WO-0054 — the usage worlds. 'kullanim': a budgeted workspace whose ledger carries every
//     shape the breakdown must split (cache-bearing, multi-model with lines that DO NOT sum to
//     the row's usd_delta — the F2 note's live state, single-model, ✦ draft-owned, out-of-month,
//     costed-but-unledgered, a ctx checkpoint, and a last-month-STARTED session with in-month
//     rows — the F1 divergence). 'bos': zero rows, no budget — the empty face. 'uyum': budgeted
//     and NON-divergent (its session's cost_usd == its row's usd_delta) — the count-0 control.
//     Figures (locale tr): head basis $17,78 (warn at $16), ledger basis $18,74 — the two bases
//     disagree by $0,96 and the head never reconciles. The zero-spend WO's absence is the pin.
const wsKullanim = await store.createWorkspace({
  label: 'kullanim',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo, // the SHARED root: WO numbering is per decision store and the PK is global
});
await store.setBudget(wsKullanim.id, { capUsd: 20, warnPercent: 80 });
const mkK = (title: string) =>
  store.createWorkOrder({ workspaceId: wsKullanim.id, title, description: 'E2E: usage ledger.', trackRepos: wsKullanim.repos, reviewMode: 'gates', contextFiles: [] });
const woK1 = await mkK('Kullanım uygulaması'); // WO-0001 — the spend leader
const woK2 = await mkK('Kullanım doğrulaması'); // WO-0002
await mkK('Kullanım boş işi'); // WO-0003 — zero-spend: ABSENT from the list (post-round2 filter)
const lastMonthDay = (day: number): string =>
  new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, Math.min(day, 28), 12)).toISOString();
const kOwner = (woId: typeof woK1.id) => ({ kind: 'wo', workOrderId: woId }) as const;
// 1) the implementer hero: cache-bearing, the ctx checkpoint's bearer
store.recordSession({
  providerSessionId: 'e2e-k-imp', owner: kOwner(woK1.id), role: 'implementer', status: 'idle',
  cost: { tokensIn: 252_988, tokensOut: 60_934, usd: 13.17 }, ctx: { usedTokens: 124_000, maxTokens: 200_000 },
  startedAt: monthDay(2), endedAt: monthDay(2),
});
store.recordTurnUsage(kOwner(woK1.id), 'e2e-k-imp', { at: monthDay(2, 9), delta: { tokensIn: 253_000, tokensOut: 61_000, usd: 13.17 }, usage: { cacheRead: 1_400_000, cacheCreation: 310_000 } });
// 2) the F1 divergence session: STARTED last month (the head's basis excludes it), its rows `at`
//    this month (the ledger includes them) — plus the out-of-month row the read must EXCLUDE.
store.recordSession({
  providerSessionId: 'e2e-k-old', owner: kOwner(woK1.id), role: 'implementer', status: 'idle',
  cost: { tokensIn: 50_000, tokensOut: 5_000, usd: 2.0 }, startedAt: lastMonthDay(15), endedAt: monthDay(6),
});
store.recordTurnUsage(kOwner(woK1.id), 'e2e-k-old', { at: lastMonthDay(20), delta: { tokensIn: 900_000, tokensOut: 90_000, usd: 9.99 } }); // EXCLUDED
store.recordTurnUsage(kOwner(woK1.id), 'e2e-k-old', { at: monthDay(5), delta: { tokensIn: 40_000, tokensOut: 4_000, usd: 1.5 } });
store.recordTurnUsage(kOwner(woK1.id), 'e2e-k-old', { at: monthDay(6), delta: { tokensIn: 10_000, tokensOut: 1_000, usd: 0.5 } });
// 3) the architect: a single-model row + the F2 multi-model row (lines Σ 1.0 ≠ usd_delta 1.44 —
//    the provider's own split on two channels; `model` stays NULL on the 2-line row)
store.recordSession({
  providerSessionId: 'e2e-k-arch', owner: kOwner(woK2.id), role: 'architect', status: 'idle',
  cost: { tokensIn: 141_000, tokensOut: 39_000, usd: 1.12 }, startedAt: monthDay(3), endedAt: monthDay(3),
});
store.recordTurnUsage(kOwner(woK2.id), 'e2e-k-arch', { at: monthDay(3, 10), delta: { tokensIn: 96_000, tokensOut: 11_000, usd: 0.72 }, usage: { modelUsage: [{ model: 'glm-5.3', tokensIn: 96_000, tokensOut: 11_000, usd: 0.72 }] } });
store.recordTurnUsage(kOwner(woK2.id), 'e2e-k-arch', {
  at: monthDay(3, 12), delta: { tokensIn: 50_000, tokensOut: 8_000, usd: 1.44 },
  usage: { modelUsage: [{ model: 'glm-5.3', tokensIn: 30_000, tokensOut: 5_000, usd: 0.6 }, { model: 'glm-5.3-flash', tokensIn: 20_000, tokensOut: 3_000, usd: 0.4 }] },
});
// 4) the ✦ draft owner — the 1832 un-pin's live row (workspace-keyed, work_order_id NULL)
store.recordSession({
  providerSessionId: 'e2e-k-draft', owner: { kind: 'draft', workspaceId: wsKullanim.id }, role: 'architect', status: 'idle',
  cost: { tokensIn: 201_000, tokensOut: 9_000, usd: 1.41 }, startedAt: monthDay(4), endedAt: monthDay(4),
});
store.recordTurnUsage({ kind: 'draft', workspaceId: wsKullanim.id }, 'e2e-k-draft', { at: monthDay(4, 10), delta: { tokensIn: 201_000, tokensOut: 9_000, usd: 1.41 } });
// 5) the pre-WO-0052 vintage: costed at the session level, ZERO per-turn rows → unledgeredCount 1
store.recordSession({
  providerSessionId: 'e2e-k-vintage', owner: kOwner(woK1.id), role: 'architect', status: 'idle',
  cost: { tokensIn: 30_000, tokensOut: 4_000, usd: 2.08 }, startedAt: monthDay(7), endedAt: monthDay(7),
});
// 'bos': zero usage rows, NO budget key — the empty face has nothing to lean on. Its default
// branch is deliberately `master`: the WO-0093 prep-failure spec branches a worktree from MAIN
// here and the missing base must refuse the start (AC 5, the verbatim failure arm). The tohum
// dir pre-seeds its own store past every id (the WO-0090 pattern — the work_order PK is global).
// 0100 (the original pin) collided live with `UNIQUE constraint failed: work_order.id` once the
// 'brifing' world (WO-0090) landed on main: its own tohum sits at 0099 and it seeds 3 WOs
// directly (0100/0101/0102) — bos's runtime create ('WO-0093 hazırlık hatası') landed on the
// same 0101 independently. 0130 clears every tohum + runtime ceiling in this file (wt's own
// runtime creates top out around 0113).
mkdirSync(join(root, 'repo-bos', 'docs', 'work-orders', 'WO-0130-tohum'), { recursive: true });
gitSeed(join(root, 'repo-bos'), 'master');
const wsBos = await store.createWorkspace({
  label: 'bos',
  repos: [{ path: join(root, 'repo-bos'), remote: 'e2e-bos' }],
  decisionStorePath: join(root, 'repo-bos'),
});
// 'uyum': budgeted, non-divergent — ONE in-month session whose cost_usd equals its row's
// usd_delta. Its decision store is the SAME shared root (WO numbering is per decision store and
// the work_order PK is global — a fresh root would re-mint an existing WO-0001).
const wsUyum = await store.createWorkspace({
  label: 'uyum',
  repos: [{ path: repo, remote: 'e2e-remote' }],
  decisionStorePath: repo,
});
await store.setBudget(wsUyum.id, { capUsd: 20, warnPercent: 80 });
const woUyum = await store.createWorkOrder({ workspaceId: wsUyum.id, title: 'Kullanım uyum işi', description: 'E2E: the non-divergent control.', trackRepos: wsUyum.repos, reviewMode: 'gates', contextFiles: [] });
store.recordSession({
  providerSessionId: 'e2e-u1', owner: { kind: 'wo', workOrderId: woUyum.id }, role: 'implementer', status: 'idle',
  cost: { tokensIn: 5_000, tokensOut: 500, usd: 0.5 }, startedAt: monthDay(8), endedAt: monthDay(8),
});
store.recordTurnUsage({ kind: 'wo', workOrderId: woUyum.id }, 'e2e-u1', { at: monthDay(8, 9), delta: { tokensIn: 5_000, tokensOut: 500, usd: 0.5 } });
console.log(`USAGE=${JSON.stringify({ kullanim: String(wsKullanim.id), bos: String(wsBos.id), uyum: String(wsUyum.id) })}`);

// 19) WO-0072 — the overview world. 'genel': one OPEN work order (written), one CLOSED one (the
//     real WO-0025 closure chain), a tech-debt.md carrying the three debt shapes (open+linked,
//     open+UNlinked, open-but-on-the-closed-WO — the drop), and a roadmap whose planli task sits
//     in an unblocked faz while the other two arms (kosuyor / blocked faz) must stay out. Its own
//     decision store — so the global-PK collision (TD-035) is dodged by PRE-SEEDING a directory
//     (WO-0090) that pushes this root's numbering past every existing id. ('bos' doubles as the
//     all-empty face: no WOs, no roadmap, no debt ledger.)
const repoGenel = join(root, 'repo-genel');
mkdirSync(join(repoGenel, 'docs', 'work-orders', 'WO-0090-tohum'), { recursive: true });
gitSeed(repoGenel);
const wsGenel = await store.createWorkspace({
  label: 'genel',
  repos: [{ path: repoGenel, remote: 'e2e-genel' }],
  decisionStorePath: repoGenel,
});
const woGOpen = await store.createWorkOrder({
  workspaceId: wsGenel.id, title: 'Genel açık iş', description: 'E2E: the overview projection.', trackRepos: wsGenel.repos, reviewMode: 'gates', contextFiles: [],
});
const woGClosed = await store.createWorkOrder({
  workspaceId: wsGenel.id, title: 'Genel kapalı iş', description: 'E2E: closed is nobody\'s turn.', trackRepos: wsGenel.repos, reviewMode: 'gates', contextFiles: [],
});
// The roadmap FIRST — the verifier gate is a record-time computation over resolvable
// `path:line` pointers (WO-0069), and the pointer below names this workspace's roadmap.md.
await store.updateWorkOrder(woGOpen.id, { taskRef: 'f0-t2' });
await store.saveRoadmap(
  wsGenel.id,
  [
    '---',
    'workspace: genel',
    'title: Genel yol haritası',
    '---',
    '',
    '# Genel yol haritası',
    '',
    '```fazlar',
    JSON.stringify([
      { id: 'f0', title: 'Birinci faz', blockedBy: [], tasks: [
        { id: 'f0-t1', title: 'Genel hazır görev', repo: 'repo-genel' },
        { id: 'f0-t2', title: 'Genel koşan görev', repo: 'repo-genel' },
      ] }],
    ),
    '```',
    '',
  ].join('\n'),
);
// The FULL WO-0025 closure chain, exactly as the pipeline records it: an implementer step, a
// VERIFIER step whose report's pointers resolve (the gate is the computation, not an `= 1`
// attestation — WO-0069), every verdict proceed, then the attested close.
await store.approvePlan(woGClosed.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"},{"role":"verifier","aim":"v","scope":"all"}]\n```\n');
store.recordStepReport(woGClosed.id, 1, 'implementer', '# uygulandı');
store.recordStepVerdict(woGClosed.id, 1, 'proceed', 'ok');
store.recordStepReport(woGClosed.id, 2, 'verifier', '# Rapor\n\n`docs/roadmap.md:1` doğrulandı.\n');
store.recordStepVerdict(woGClosed.id, 2, 'proceed', 'ok');
await store.closeWorkOrder(woGClosed.id, 'E2E: kapandı.');
writeFileSync(
  join(repoGenel, 'docs', 'tech-debt.md'),
  [
    '| id | opened by | description | risk | status |',
    '| --- | --- | --- | --- | --- |',
    `| TD-901 | ${String(woGClosed.id)} | **Kapalı işin borcu.** Görünmemeli. | low | open |`,
    `| TD-902 | ${String(woGOpen.id)} | **Açık işin borcu.** Çipi detayı açar. | medium | open |`,
    '| TD-903 | design | **Bağlantısız borç.** Çipsiz satır, gerekçesi satır. | low | open |',
    `| TD-904 | ${String(woGOpen.id)} | **Eksik satır.** |`,
    '',
  ].join('\n'),
  'utf8',
);
console.log(`GENEL=${JSON.stringify({ genel: String(wsGenel.id) })}`);

// 20) WO-0092 — the issue bridge world. 'sorun': the faithful antreo shape — a decision-store
//     repo (unparseable remote, degraded Depo card) + TWO code repos. 'sorun-api' parses to the
//     fixture forge repo — under DOCKET_E2E the composition root swaps the gh binary for the
//     scripted e2e-forge runner (electron/e2e-forge.ts), so the Depo card renders REAL adapter
//     output against the WO-0081 probe's wire shapes: 4 open issues, the #333 drill-down
//     carrying a body, the #329 drill-down failing (the degraded refusal path). 'sorun-mobile'
//     also parses (antreo-app/docs) but its ISSUE list fails — the m4 partial-success pin (the
//     fold's reason line). The decision store IS a connected repo (the structureRoot invariant —
//     a store that is no connection would fall back to process.cwd(), the app's own repo).
//     Pre-seeded past every existing id (the global work_order PK — the WO-0090 pattern).
const repoSorunDocs = join(root, 'sorun-docs');
mkdirSync(join(repoSorunDocs, 'docs', 'work-orders', 'WO-0095-tohum'), { recursive: true });
const repoSorunApi = join(root, 'sorun-api');
const repoSorunMobile = join(root, 'sorun-mobile');
gitSeed(repoSorunDocs);
gitSeed(repoSorunApi);
gitSeed(repoSorunMobile);
const wsSorun = await store.createWorkspace({
  label: 'sorun',
  repos: [
    { path: repoSorunDocs, remote: 'e2e-sorun-docs' },
    { path: repoSorunApi, remote: 'https://github.com/antreo-app/api' },
    { path: repoSorunMobile, remote: 'https://github.com/antreo-app/docs' },
  ],
  decisionStorePath: repoSorunDocs,
});
console.log(`SORUN=${JSON.stringify({ sorun: String(wsSorun.id) })}`);

// 21) WO-0090 — the briefing world. 'brifing': a GIT decision store (the only kind the briefing
//     check can look at — every other seeded repo is a plain dir, so their checks stay honestly
//     undefined and no line renders anywhere else in the suite). Three WOs: STALE (one resolving
//     pointer + one missing — the line names both the pointer and the checked sha), CLEAN (only
//     the resolving pointer — nothing renders), PLAIN (zero pointers — absent, never a failure).
//     Own store root, pre-seeded past every id ANY runtime flow mints too (the global work_order
//     PK): the sorun world's runtime spawns top out at WO-0098, so the tohum sits at WO-0099 and
//     these rows take WO-0100+ — a lower tohum made the batch spec's retry hit a PK collision.
const repoBrifing = join(root, 'brifing-store');
mkdirSync(join(repoBrifing, 'docs', 'work-orders', 'WO-0099-tohum'), { recursive: true });
mkdirSync(join(repoBrifing, 'src'), { recursive: true });
writeFileSync(join(repoBrifing, 'src', 'a.ts'), 'export {};\n');
execFileSync('git', ['-C', repoBrifing, 'init', '-q']);
execFileSync('git', ['-C', repoBrifing, 'add', '-A']);
execFileSync('git', ['-C', repoBrifing, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'seed']);
const wsBrifing = await store.createWorkspace({
  label: 'brifing',
  repos: [{ path: repoBrifing, remote: 'e2e-brifing' }],
  decisionStorePath: repoBrifing,
});
const mkB = (title: string, description: string) =>
  store.createWorkOrder({ workspaceId: wsBrifing.id, title, description, trackRepos: wsBrifing.repos, reviewMode: 'gates', contextFiles: [] });
await mkB('Brifing bayat', 'E2E: the stale briefing. src/a.ts:1 resolves; lib/kayip.dart:9 does not.');
await mkB('Brifing temiz', 'E2E: the clean briefing. src/a.ts:1 resolves.');
await mkB('Brifing sade', 'E2E: zero pointers, prose only. Saat 12:30.');
console.log(`BRIFING=${JSON.stringify({ ws: String(wsBrifing.id) })}`);

// 22) WO-0093 — the worktree world. 'wt': a single-repo workspace whose repo is a REAL local git
//     repo (main + one seed commit) — the faithful single-repo wave shape (the store IS the
//     track). TWO worktree-enabled orders ride the parallel spec (two isolated copies, two
//     branches, zero collisions); the closable chain + the dirty-kept / clean-removed close
//     specs ride them. `src-wt.txt` is COMMITTED — the verifier report's pointer resolves
//     against it (the WO-0069 record-time gate). Pre-seeded past every id (the WO-0090 pattern:
//     the work_order PK is global, the number is per decision store) — WO-0097 collided with the
//     sorun world's own documented ceiling (WO-0098, this file's own note above): its "tek
//     üretim" + "toplu üretim" specs can independently reach 098, and 'wt' seeding two WOs at
//     097 landed them on 098/099, so a later sorun-side create hit `UNIQUE constraint failed:
//     work_order.id` (the TD-035 pattern, caught live). 0110 clears every tohum in this file
//     with margin, not just today's ceiling.
const repoWt = join(root, 'repo-wt');
mkdirSync(join(repoWt, 'docs', 'work-orders', 'WO-0110-tohum'), { recursive: true });
// A file, not just the empty dir: git tracks nothing for a directory with no file in it, so
// `docs/work-orders/` itself would stay untracked — the later WO-0093 spec's own repo-cleanliness
// check (wtAssertRepoUntouched) reads `git status --porcelain`, which then compacts the WHOLE
// `docs/` tree into one `?? docs/` line once Kopya A/B's order.md lands (nothing tracked under it
// to force a finer breakdown) instead of the expected `?? docs/work-orders/…` per entry.
writeFileSync(join(repoWt, 'docs', 'work-orders', 'WO-0110-tohum', '.gitkeep'), '');
writeFileSync(join(repoWt, 'src-wt.txt'), 'wt seed\n');
gitSeed(repoWt);
const wsWt = await store.createWorkspace({
  label: 'wt',
  repos: [{ path: repoWt, remote: 'e2e-wt' }],
  decisionStorePath: repoWt,
});
const mkWt = (title: string) =>
  store.createWorkOrder({
    workspaceId: wsWt.id,
    title,
    description: 'E2E: worktree automation.',
    trackRepos: wsWt.repos,
    reviewMode: 'gates',
    contextFiles: [],
    checkout: true,
  });
const woWtA = await mkWt('Kopya A');
const woWtB = await mkWt('Kopya B');
console.log(`WT=${JSON.stringify({ ws: String(wsWt.id), a: String(woWtA.id), b: String(woWtB.id), repo: repoWt })}`);

console.log(`DB=${join(root, 'e2e.db')}`);
