// e2e/seed.ts — builds a throwaway workspace + WOs across stages for the UI driver (WO-0031).
// Run via tsx: prints `DB=<path>` for the driver. Never touches the operator's real db/repo.
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'docket-e2e-'));
const repo = join(root, 'repo');
mkdirSync(join(repo, 'docs', 'work-orders'), { recursive: true });

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
  workOrderId: wo3.id,
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
  workOrderId: wo3.id,
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
await store.approvePlan(wo4.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n');
store.recordStep(wo4.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo4.id, 1, 'proceed', 'ok');
store.recordSession({
  providerSessionId: 'e2e-wo4-plan',
  workOrderId: wo4.id,
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
  workOrderId: wo4.id,
  role: 'implementer',
  status: 'idle',
  transcript: [],
  startedAt: new Date('2026-08-16T14:15:00Z').toISOString(),
  endedAt: new Date('2026-08-16T14:15:30Z').toISOString(),
});
store.recordSession({
  providerSessionId: 'e2e-wo4-run',
  workOrderId: wo4.id,
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
  workOrderId: wo4.id,
  role: 'verifier',
  status: 'idle',
  stepIdx: 1,
  transcript: [],
  cost: { tokensIn: 24_000, tokensOut: 5_000, usd: 2.03 },
  startedAt: new Date('2026-08-16T15:10:00Z').toISOString(),
  endedAt: new Date('2026-08-16T15:29:00Z').toISOString(),
});
await store.closeWorkOrder(wo4.id, 'e2e closed');

// 5) stopped_asking (WO-0031c) — an implementation WO paused on a permission ask: the amber moment
//    (ask card + `Sıra sende` substrip + glow-signal) rendered statically from the persisted session.
const wo5 = await mk('İzin bekliyor', 'E2E: a step paused on a permission ask.');
await store.approvePlan(wo5.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n');
store.recordStep(wo5.id, 1, { status: 'active' });
store.recordSession({
  providerSessionId: 'e2e-ask-session',
  workOrderId: wo5.id,
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
await store.approvePlan(wo6.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n');
store.recordStep(wo6.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo6.id, 1, 'proceed', 'ok');
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
await store.approvePlan(wo7.id, '# E2E plan\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n');
store.recordStep(wo7.id, 1, { status: 'done', reportPath: 'reports/step-01-implementer.md' });
store.recordStepVerdict(wo7.id, 1, 'proceed', 'ok');
store.recordSession({
  providerSessionId: 'e2e-wo7-run',
  workOrderId: wo7.id,
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

console.log(`DB=${join(root, 'e2e.db')}`);
