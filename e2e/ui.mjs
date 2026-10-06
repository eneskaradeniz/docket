// e2e/ui.mjs — the v2 smoke (`npm run test:ui`: build first, then this file). It launches the
// BUILT Electron app against a deterministic seed and walks the machine's real surfaces:
// shell → cockpit → board → work-order detail → a permission ask raised by a REAL scripted
// transport run → the answer → the badge clearing to absence.
//
// How the launched instance is pointed at the seed: the app's one storage-location seam is the
// DOCKET_DATA_DIR variable, so the harness launches Electron with it aimed at the temp data dir
// the seed wrote the database into. The app then boots through its own, only override mechanism
// — nothing patched, the operator's real ~/.docket untouched.
//
// How the open ask is produced: the seed registers an account for the provider whose CLI the
// smoke impersonates (an ACP transport), and the discovery override variable names the scripted
// agent binary the seed staged. The stage is enqueued through the REAL detail button; the
// dispatcher starts it; the agent runs one permission round-trip over the real ACP transport and
// the executor parks the run on the in-process permission board — the badge counts a real ask.
//
// Answer surface declaration: the screens now afford both decisions (the detail's gate rows and
// asks feed carry approve/reject, the cockpit's ask row carries Reddet/İzin ver), but the walk
// still drives BOTH the human-gate decision and the permission answer through the real bridge
// (window.docket.command) in the page — the exact command those buttons issue, kept independent
// of button layout. Everything else is real clicks on real DOM. The answer path
// bridge → api → permission board → executor → transport → agent → finished → UiEvent →
// re-query → badge is the full pipeline, honestly measured.
//
// Every wait is a poll with an explicit budget: the dispatcher ticks every 5 s and the ask
// appears only after a tick plus a transport handshake, so dispatcher-driven steps carry the
// widest budgets. Timeouts are minutes-of-margin, never tight races.
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { _electron as electron } from 'playwright-core';
import { acquireE2eLock } from './lock.mjs';
import { appendCheck, beginReport, REPORT_PATH } from './report.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
// One Electron suite per machine, like the harness before it: parallel launches of this size
// starve each other's dispatchers and flake for timing reasons no fix in the app could cure.
await acquireE2eLock(ROOT);

if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
  console.error('the built app is missing — run npm run test:ui (it builds first)');
  process.exit(1);
}
// The smoke's specs land in the same structured report the audits write, so a run of `test:ui`
// leaves a machine-readable record too.
beginReport();

// --- the seed ----------------------------------------------------------------------------------------
const seedOut = execFileSync('npx', ['tsx', 'e2e/seed-smoke.ts'], { cwd: ROOT, encoding: 'utf8' });
const seedLine = seedOut.trim().split('\n').find((line) => line.startsWith('SEED='));
if (seedLine === undefined) throw new Error('the seed failed: no SEED= line');
const SEED = JSON.parse(seedLine.slice(5));
console.log(`seed home: ${SEED.home}`);

// Turkish is the app's default locale and the seed ran with a fresh profile, so every label the
// walk asserts is the default bundle's copy.
const L = {
  home: 'Anasayfa',
  badge: 'Senden bekleyenler',
  awaiting: 'İnsan yanıtı bekleniyor',
  ask: 'İzin bekleniyor',
  ready: 'Hazır',
  done: 'Tamamlandı',
  runningRun: 'Koşuyor',
  succeededRun: 'Başarılı',
  runsEmpty: 'Bu iş emrinde henüz koşu yok.',
  attentionEmpty: 'Senden bekleyen yok',
  startStage: 'Aşamayı başlat',
  enqueuedNotice: 'Aşama kuyruğa alındı.',
};
const TITLE = SEED.title;
const OPERATOR = { kind: 'user', id: 'duman-operatoru', label: 'Duman operatörü' };

const app = await electron.launch({
  args: [join(ROOT, 'dist-electron', 'main.js')],
  env: { ...process.env, DOCKET_DATA_DIR: SEED.dataDir, DOCKET_OPENCODE_BIN: SEED.agentBin },
});
const page = await app.firstWindow();

const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));

// --- helpers -----------------------------------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll until fn returns truthy; throws with the label when the budget is spent. */
const waitFor = async (label, fn, timeoutMs = 20_000, stepMs = 400) => {
  const started = Date.now();
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(stepMs);
  }
};

/** True once the locator matches at least one node. */
const present = async (locator) => (await locator.count()) > 0;

const query = (body) => page.evaluate((q) => window.docket.query(q), body);
const command = (body) =>
  page.evaluate(([actor, c]) => window.docket.command(actor, c), [OPERATOR, body]);

// The attention badge and the cockpit's door moved out of the sidebar: the badge rides the title
// bar's Anasayfa button, and the cockpit is reached through that button.
const badge = () => page.locator(`[aria-label="${L.badge}"]`);
const homeButton = () => page.getByRole('button', { name: L.home });
// The sidebar's project row: the seed attaches one single-repo project, which the tree renders as
// one flat row carrying the project's display name, and clicking it opens the main repo's board.
const repoRow = () => page.locator('nav button').filter({ hasText: 'Duman projesi' });

const cockpitAttention = async () => {
  const view = await query({ type: 'cockpit' });
  return view.attention ?? [];
};
const detailView = () => query({ type: 'workOrder.detail', id: SEED.workOrderId });
const attentionKind = (kind) =>
  cockpitAttention().then((items) => items.some((item) => item.kind === kind && item.workOrderId === SEED.workOrderId));

const failures = [];
let specIndex = 0;
const spec = async (name, fn) => {
  specIndex += 1;
  try {
    await fn();
    console.log(`  ok ${specIndex}. ${name}`);
    appendCheck({ id: `smoke-${specIndex}`, screen: name, size: '', theme: '', status: 'ok', detail: '' });
  } catch (error) {
    failures.push(name);
    console.log(`  FAIL ${specIndex}. ${name}\n    ${String(error).split('\n').slice(0, 4).join('\n    ')}`);
    appendCheck({
      id: `smoke-${specIndex}`,
      screen: name,
      size: '',
      theme: '',
      status: 'FAIL',
      detail: String(error).split('\n').slice(0, 4).join('\n'),
    });
    try {
      const shot = join(SEED.home, `smoke-fail-${specIndex}.png`);
      await page.screenshot({ path: shot });
      console.log(`    screenshot: ${shot}`);
    } catch {
      // the window may already be gone; the failure text is the record
    }
  }
};

// --- the walk ----------------------------------------------------------------------------------------

await spec('shell renders with the seeded attention badge (1)', async () => {
  await waitFor('the title bar home button', () => present(homeButton()), 30_000);
  await waitFor('the tree repo row', () => present(repoRow()));
  const count = await waitFor('the badge', async () => {
    if (!(await present(badge()))) return undefined;
    return (await badge().textContent())?.trim();
  });
  assert.equal(count, '1');
});

await spec('cockpit lists the seeded work order as awaiting a human', async () => {
  const kinds = await waitFor('the attention item', () => attentionKind('awaiting_human'));
  assert.ok(kinds);
  // The attention row is a list item with an Aç button, not a button itself.
  const card = page.locator('main li').filter({ hasText: TITLE }).filter({ hasText: L.awaiting });
  await waitFor('the attention card', () => present(card));
});

await spec('board renders the columns of the seeded definitions', async () => {
  await repoRow().click();
  await waitFor('the board heading', () => present(page.locator('main h1').filter({ hasText: 'duman' })));
  // one work order waiting in review, none running yet — on a short flow every stage is an open
  // lane headed with its name, the empty ones included.
  await waitFor("the 'İnceleme' column", () => present(page.locator('main section h2').filter({ hasText: 'İnceleme' })));
  await waitFor("the empty 'Uygulama' column", () => present(page.locator('main section h2').filter({ hasText: 'Uygulama' })));
  const card = page.locator('main section button').filter({ hasText: TITLE });
  await waitFor('the seeded card', () => present(card));
  assert.ok((await card.textContent())?.includes(L.awaiting), 'the card status is not awaiting_human');
});

await spec('the card opens the work-order detail', async () => {
  await page.locator('main section button').filter({ hasText: TITLE }).click();
  await waitFor('the detail heading', () => present(page.locator('main h1').filter({ hasText: TITLE })));
  await waitFor('the awaiting status badge', () =>
    present(page.locator('main [role="status"], main span').filter({ hasText: L.awaiting }).first()),
  );
  await waitFor('the empty runs section', () => present(page.getByText(L.runsEmpty, { exact: true })));
  const view = await detailView();
  assert.equal(view.state.status, 'awaiting_human');
  assert.equal(view.state.stage, 'inceleme');
});

await spec('the human gate is decided through the bridge; the badge clears to absence', async () => {
  // No screen carries a gate-decide button yet (the detail's gate list is unfed by composition),
  // so the decision rides the bridge — the exact command a button would issue.
  const result = await command({
    type: 'gate.decide',
    workOrderId: SEED.workOrderId,
    gate: 'onay',
    decision: 'approved',
  });
  assert.ok(result.ok, `gate.decide failed: ${JSON.stringify(result)}`);
  // The command's workOrders.changed emission is what re-queries the cockpit store, so the badge
  // clearing here proves the command → event → re-query path deterministically.
  await waitFor('the badge to vanish', async () => ((await present(badge())) ? undefined : true), 15_000);
  await waitFor('the ready status', () => present(page.locator('main span').filter({ hasText: L.ready }).first()));
  const view = await detailView();
  assert.equal(view.state.status, 'ready');
  assert.equal(view.state.stage, 'uygulama');
});

await spec('the stage is enqueued through the real start button', async () => {
  const start = page.locator('main button').filter({ hasText: L.startStage });
  await waitFor('the start button', () => present(start));
  await start.click();
  // The confirmation now leaves as the one toast (ToastHost, top right) and dismisses itself
  // after 5 s, so the poll reads the card, not a standing strip.
  await waitFor('the enqueue notice', () =>
    present(page.locator('[data-toast-host] [role="status"]').filter({ hasText: L.enqueuedNotice })),
  );
});

await spec('the scripted transport run opens a real permission ask', async () => {
  // Dispatcher cadence (a tick every 5 s) plus the first transport factory build and the ACP
  // handshake set the pace; the budget covers all of it with wide margin.
  await waitFor('the permission ask in attention', () => attentionKind('permission_ask'), 45_000);
  await homeButton().click();
  // The ask row speaks the ask itself — the target and the İzin bekleniyor badge — in place of
  // the work order's title, so the row is found by the badge copy alone.
  const card = page.locator('main li').filter({ hasText: L.ask });
  await waitFor('the ask card', () => present(card));
  await waitFor('the badge to read 1', async () => {
    if (!(await present(badge()))) return undefined;
    return (await badge().textContent())?.trim() === '1' ? true : undefined;
  });
});

await spec('the detail shows the waiting run', async () => {
  // The ask row carries Reddet/İzin ver, no Aç — the detail is reached through the running row,
  // which names the run's stage.
  await page.locator('main button').filter({ hasText: 'uygulama' }).click();
  await waitFor('the detail heading', () => present(page.locator('main h1').filter({ hasText: TITLE })));
  const view = await waitFor('an active run', async () => {
    const detail = await detailView();
    const active = detail.runs.find((run) => run.endedAt === undefined || run.endedAt === null);
    return active === undefined ? undefined : { detail, active };
  });
  const row = page.locator('main li').filter({ hasText: view.active.id });
  await waitFor('the run row', () => present(row));
  assert.ok((await row.textContent())?.includes(L.runningRun), 'the run row is not marked running');
});

await spec('the ask is answered through the bridge and the run completes', async () => {
  const detail = await detailView();
  const active = detail.runs.find((run) => run.endedAt === undefined || run.endedAt === null);
  assert.ok(active !== undefined, 'no active run to answer');
  // The ACP transport numbers a run's asks ask-1, ask-2 … as they arrive; this run raises exactly
  // one, so its id is the transport's first. A wrong id answers not_found and fails below.
  const result = await command({
    type: 'permission.answer',
    runId: active.id,
    askId: 'ask-1',
    decision: 'allow',
  });
  assert.ok(result.ok, `permission.answer failed: ${JSON.stringify(result)}`);
  // The answer releases the parked executor; the agent ends its turn; the run closes and the
  // work order completes. The bridge read is direct (no store cache); the DOM follows.
  await waitFor('the run to succeed', async () => {
    const view = await detailView();
    return view.runs.some((run) => run.id === active.id && run.outcome === 'succeeded') &&
      view.state.status === 'done'
      ? true
      : undefined;
  }, 30_000);
});

await spec('the badge clears to absence and the work order is done', async () => {
  await waitFor('the done status badge', () =>
    present(page.locator('main span').filter({ hasText: L.done }).first()),
  );
  await waitFor('the succeeded run badge', () =>
    present(page.locator('main li').filter({ hasText: L.succeededRun })),
  );
  await homeButton().click();
  await waitFor('the empty attention copy', () => present(page.getByText(L.attentionEmpty, { exact: true })));
  // The badge renders nothing at zero — absence is the cleared state, never a printed 0.
  await waitFor('the badge to vanish', async () => ((await present(badge())) ? undefined : true), 15_000);
});

await spec('the renderer raised no page errors', async () => {
  assert.deepEqual(pageErrors, []);
});

// --- teardown ----------------------------------------------------------------------------------------
console.log(
  failures.length === 0
    ? '\nsmoke: all specs passed'
    : `\nsmoke: ${failures.length} failing spec(s): ${failures.join(' | ')}`,
);
console.log(`report: ${REPORT_PATH}`);
await app.close().catch(() => undefined);
process.exit(failures.length === 0 ? 0 : 1);
