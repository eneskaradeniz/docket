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

console.log(`DB=${join(root, 'e2e.db')}`);
