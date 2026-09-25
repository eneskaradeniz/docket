// src/adapters/cli-runner/index.test.ts — the engine against a SCRIPTED FAKE BINARY (WO-0105).
// A real spawn, real signals, real pipes — no child_process mocks: the adapter's contract is
// proven the way it runs. The fake vendor speaks a tiny neutral NDJSON protocol (started /
// text / usage / done / fail / note); the test def maps it to RunnerEvents — vendor vocabulary
// belongs to defs, and this def's vocabulary is the test's own.
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DriveInput, RunnerEvent, SessionRunner, WoDriveInput } from '../../core/runner';
import type { WorkOrderId } from '../../core/types';
import type { ProviderStatus } from '../../core/app-settings';
import { checkCliVendor, createCliRunner } from './index';
import { decodeJsonLine, type CliParseState, type CliRunnerDef } from './def';

const DIR = mkdtempSync(join(tmpdir(), 'docket-cli-runner-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

// The fake binary: reads the prompt off stdin, behaves by flag, emits NDJSON lines.
const SCRIPT = join(DIR, 'fake.mjs');
writeFileSync(
  SCRIPT,
  `import process from 'node:process';
const argv = process.argv.slice(2);
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
if (argv.includes('--do=hang')) {
  process.on('SIGINT', () => process.exit(0)); // the graceful-stop shape: exit, no done line
  setInterval(() => {}, 1000);
  emit({ type: 'started', sessionId: 't-hang' });
} else if (argv.includes('--do=echo-argv')) {
  emit({ type: 'started', sessionId: 't-argv' });
  emit({ type: 'note', text: argv.join(' ') });
  emit({ type: 'done', result: 'argv done' });
} else if (argv.includes('--do=echo-env')) {
  emit({ type: 'started', sessionId: 't-env' });
  emit({ type: 'note', text: process.env.DOCKET_FAKE_ENV_MARK ?? 'no-mark' });
  emit({ type: 'done', result: 'env done' });
} else if (argv.includes('--do=clean-silent')) {
  emit({ type: 'started', sessionId: 't-silent' });
  // exits 0 with NO done line — the honest-missing-result arm
} else if (argv.includes('--do=fail')) {
  emit({ type: 'started', sessionId: 't-fail' });
  process.stderr.write('boom: you shall not pass (auth)');
  process.exit(3);
} else if (argv.includes('--do=no-terminal')) {
  emit({ type: 'started', sessionId: 't-noterm' });
  emit({ type: 'text', text: 'partial' });
  process.exit(1);
} else if (argv.includes('--version')) {
  process.stdout.write('fake-cli 1.2.3\\n');
} else if (argv.includes('status')) {
  process.stdout.write('logged in via chatgpt\\n');
} else {
  // the happy path: read the prompt, speak, cost, done
  let prompt = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (c) => (prompt += c));
  process.stdin.on('end', () => {
    emit({ type: 'started', sessionId: 't-1' });
    emit({ type: 'text', text: 'the answer to ' + prompt.trim() });
    emit({ type: 'usage', tokensIn: 10, tokensOut: 5, usd: 0.01 });
    emit({ type: 'done', result: 'final word' });
  });
}
`,
);

/** The test def: the tiny neutral protocol → RunnerEvents. This is a DEF's whole job. */
function testDef(over: Partial<CliRunnerDef> = {}): CliRunnerDef {
  return {
    id: 'fake-cli',
    displayName: 'Fake CLI',
    bin: process.execPath,
    buildArgs: (input) => [
      SCRIPT,
      // the sandbox grammar: read-only for the verifier, the def's own choice per role
      ...(input.role === 'verifier' ? ['--sandbox', 'read-only'] : ['--sandbox', 'workspace-write']),
      ...(input.model !== undefined ? ['--model', input.model] : []),
      ...(input.resume !== undefined ? ['resume', input.resume] : []),
      ...(input.prompt.includes('HANG') ? ['--do=hang'] : []),
      ...(input.prompt.includes('ECHO-ARGV') ? ['--do=echo-argv'] : []),
      ...(input.prompt.includes('ECHO-ENV') ? ['--do=echo-env'] : []),
      ...(input.prompt.includes('CLEAN-SILENT') ? ['--do=clean-silent'] : []),
      ...(input.prompt.includes('FAIL') ? ['--do=fail'] : []),
      ...(input.prompt.includes('NO-TERMINAL') ? ['--do=no-terminal'] : []),
    ],
    parseLine: (line, state) => {
      const m = decodeJsonLine(line);
      if (m === undefined) return [];
      const out: RunnerEvent[] = [];
      if (m.type === 'started' && typeof m.sessionId === 'string') {
        state.sessionId = m.sessionId;
        out.push({ kind: 'started', sessionId: m.sessionId });
      }
      if (m.type === 'text' && typeof m.text === 'string') out.push({ kind: 'assistant_text', text: m.text });
      if (m.type === 'note' && typeof m.text === 'string') out.push({ kind: 'assistant_text', text: m.text });
      if (m.type === 'done') {
        // the def's protocol choice: the usage LINE carries the cost, done carries the result —
        // the parser merges them (a real def maps whatever its vendor actually sends)
        const u = (state as UsageState).usage;
        out.push({
          kind: 'turn_complete',
          stopReason: 'end',
          cost: {
            usd: typeof u?.usd === 'number' ? u.usd : 0,
            tokensIn: typeof u?.tokensIn === 'number' ? u.tokensIn : 0,
            tokensOut: typeof u?.tokensOut === 'number' ? u.tokensOut : 0,
          },
          ...(typeof m.result === 'string' ? { result: m.result } : {}),
        });
      }
      if (m.type === 'usage') {
        (state as UsageState).usage = { usd: m.usd, tokensIn: m.tokensIn, tokensOut: m.tokensOut };
      }
      return out;
    },
    classifyError: (raw) => (raw.includes('you shall not pass') ? 'auth_failed' : undefined),
    ...over,
  };
}

interface UsageState extends CliParseState {
  usage?: { usd?: unknown; tokensIn?: unknown; tokensOut?: unknown };
}

const planDrive = (prompt: string, over: Partial<WoDriveInput> = {}): DriveInput =>
  ({ role: 'architect', workOrderId: WO_T, mode: 'plan', prompt, ...over });
const WO_T = 'WO-T' as WorkOrderId;

/** Drive to completion; `afterStart` runs once the session opened (the interrupt test's hook). */
async function collect(r: SessionRunner, input: DriveInput, afterStart?: (r: SessionRunner) => Promise<void>): Promise<RunnerEvent[]> {
  const out: RunnerEvent[] = [];
  let hooked = false;
  for await (const ev of r.drive(input)) {
    out.push(ev);
    if (!hooked && ev.kind === 'started' && afterStart) {
      hooked = true;
      await afterStart(r);
    }
  }
  return out;
}

describe('the generic CLI-spawn engine (WO-0105)', () => {
  it('the happy path: started → text → turn_complete with the vendor-reported cost and result', async () => {
    const r = createCliRunner(testDef());
    // a DIRECT drive (the plan-fallback test below covers the plan arm)
    const out = await collect(r, { role: 'implementer', workOrderId: WO_T, mode: 'direct', prompt: 'what is the answer' });
    expect(out.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'turn_complete']);
    const done = out.find((e) => e.kind === 'turn_complete') as Extract<RunnerEvent, { kind: 'turn_complete' }>;
    expect(done.result).toBe('final word');
    // the usage LINE's figures, merged by the def's parser — the vendor-reported cost, nothing invented
    expect(done.cost).toEqual({ usd: 0.01, tokensIn: 10, tokensOut: 5 });
    expect((out[0] as { sessionId: string }).sessionId).toBe('t-1');
  }, 15_000);

  it('the prompt rides STDIN (never argv) — the process sees exactly the def-built flags', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('ECHO-ARGV'));
    const note = out.find((e) => e.kind === 'assistant_text') as Extract<RunnerEvent, { kind: 'assistant_text' }>;
    expect(note.text).toContain('--sandbox workspace-write'); // architect → the writing sandbox
    expect(note.text).not.toContain('ECHO-ARGV'); // the prompt never rode argv
  }, 15_000);

  it('the role→sandbox mapping: the VERIFIER builds the read-only sandbox', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, { role: 'verifier', workOrderId: WO_T, mode: 'direct', prompt: 'ECHO-ARGV' });
    const note = out.find((e) => e.kind === 'assistant_text') as Extract<RunnerEvent, { kind: 'assistant_text' }>;
    expect(note.text).toContain('--sandbox read-only');
  }, 15_000);

  it('the model preference and the resume id reach the def\'s args builder verbatim', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('ECHO-ARGV', { model: 'tier-x', resume: 'thread-9' }));
    const note = out.find((e) => e.kind === 'assistant_text') as Extract<RunnerEvent, { kind: 'assistant_text' }>;
    expect(note.text).toContain('--model tier-x');
    expect(note.text).toContain('resume thread-9');
  }, 15_000);

  it('the backend PROFILE env composes into the spawn (WO-0098 carries over unchanged)', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('ECHO-ENV', { profile: { name: 'P', env: { DOCKET_FAKE_ENV_MARK: 'reached' } } }));
    const note = out.find((e) => e.kind === 'assistant_text') as Extract<RunnerEvent, { kind: 'assistant_text' }>;
    expect(note.text).toBe('reached');
  }, 15_000);

  it('interrupt closes CALM: the interrupted event, never the fail card (WO-0039)', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('HANG'), async (rr) => {
      await new Promise((res) => setTimeout(res, 400)); // let it start + hang
      await rr.interrupt();
    });
    expect(out.map((e) => e.kind)).toEqual(['started', 'interrupted']);
  }, 15_000);

  it('a failed exit classifies through the def and surfaces one error event', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('FAIL'));
    expect(out.map((e) => e.kind)).toEqual(['started', 'error']);
    const err = out[1] as Extract<RunnerEvent, { kind: 'error' }>;
    expect(err.code).toBe('auth_failed');
    expect(err.message).toContain('you shall not pass');
  }, 15_000);

  it('a non-zero exit with NO terminal event is the honest missing-result error (never a fabricated turn_complete)', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('NO-TERMINAL'));
    expect(out.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'error']);
    expect((out[2] as { message: string }).message).toMatch(/code 1/);
  }, 15_000);

  it('a CLEAN exit with no terminal event is also an error — "the stream ended without a result"', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('CLEAN-SILENT'));
    expect(out.map((e) => e.kind)).toEqual(['started', 'error']);
    expect((out[1] as { message: string }).message).toMatch(/without a result/);
  }, 15_000);

  it('the plan fallback: a plan drive ending with a result and no plan_ready — the result IS the plan (the SDK twin)', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('plan it'));
    expect(out.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'plan_ready', 'turn_complete']);
    expect((out[2] as { planText: string }).planText).toBe('final word');
  }, 15_000);

  it('the plan fallback NEVER fires for a non-plan drive (a step drive keeps its plain turn_complete)', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, { role: 'implementer', workOrderId: WO_T, mode: 'direct', prompt: 'do it', stepIndex: 1 });
    expect(out.map((e) => e.kind)).toEqual(['started', 'assistant_text', 'turn_complete']);
  }, 15_000);

  it('a missing binary across bin + fallbackBins is the executable_missing close', async () => {
    const r = createCliRunner(testDef({ bin: 'docket-no-such-bin-a', fallbackBins: ['docket-no-such-bin-b'] }));
    const out = await collect(r, planDrive('x'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'error', code: 'executable_missing' });
  }, 15_000);

  it('every content event carries a receive-stamp (the liveness anchor)', async () => {
    const r = createCliRunner(testDef());
    const out = await collect(r, planDrive('x'));
    for (const e of out) {
      if ('at' in e) expect(typeof (e as { at?: string }).at).toBe('string');
    }
  }, 15_000);
});

describe('checkCliVendor — the zero-prompt vendor check (WO-0105)', () => {
  it('the version probe + the declared auth probe classify honestly', async () => {
    const def = testDef({
      versionArgs: [SCRIPT, '--version'], // the test binary IS the node script (a real def probes its own bin)
      authProbe: {
        args: [SCRIPT, 'status'],
        parse: (stdout): ProviderStatus | undefined =>
          stdout.includes('logged in') ? { ok: true, source: 'chatgpt' } : { ok: false, code: 'auth_missing', message: stdout.trim() },
      },
    });
    expect(await checkCliVendor(def)).toEqual({ ok: true, source: 'chatgpt' });
  }, 15_000);

  it('no declared auth probe → installed, login state honestly unknown (never a guess)', async () => {
    expect(await checkCliVendor(testDef())).toEqual({ ok: true, source: 'installed' });
  }, 15_000);

  it('a missing binary answers executable_missing', async () => {
    const def = testDef({ bin: 'docket-no-such-bin-c' });
    expect(await checkCliVendor(def)).toMatchObject({ ok: false, code: 'executable_missing' });
  }, 15_000);
});
