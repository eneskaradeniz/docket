// system/process-registry tests — the child registry the managed quit reads (I-86) and the orphan
// reaper that cleans up after a crash (I-87). The kill surface, the clock and the sleeper are
// injected, so the escalation timing is measured on a fake timeline; only the spawn wrapper's
// registration lifecycle uses real short-lived node children.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { EpochMs } from '../../domain/index';

import {
  CHILDREN_FILE,
  PROCESS_STOP_GRACE_MS,
  childrenFilePath,
  createProcessRegistry,
  parsePsOutput,
  processRegistry,
  reapOrphanedChildren,
  registeredSpawn,
} from './process-registry';

// --- the injected machine -----------------------------------------------------------------------------

/** kill() as the registry sees it: records every signal, simulates liveness. */
class FakeKill {
  readonly signals: { readonly target: number; readonly signal: string }[] = [];
  private readonly deadAfter = new Set<string>();
  private alivePids = new Set<number>();

  constructor(alive: readonly number[] = []) {
    this.alivePids = new Set(alive);
  }

  /** Marks `pid` (or the group `-pgid`) dead; a SIGKILL always works unless `ignore` says otherwise. */
  dies(target: number, onSignal: string = 'SIGTERM'): void {
    this.deadAfter.add(`${target}:${onSignal}`);
  }

  readonly kill = (target: number, signal: NodeJS.Signals | 0): void => {
    const key = `${target}:${signal}`;
    if (signal !== 0) this.signals.push({ target, signal: String(signal) });
    if (this.deadAfter.has(key)) {
      this.alivePids.delete(Math.abs(target));
      return;
    }
    if (!this.alivePids.has(Math.abs(target))) {
      const error = new Error('unknown pid') as NodeJS.ErrnoException;
      error.code = 'ESRCH';
      throw error;
    }
  };
}

/** A clock that only moves when the registry sleeps — the timeline the timing rules read. */
class FakeTimeline {
  private current = 1_000;
  readonly slept: number[] = [];

  readonly now = (): EpochMs => this.current;

  readonly delay = async (ms: number): Promise<void> => {
    this.slept.push(ms);
    this.current += ms;
  };

  elapsed(): number {
    return this.current - 1_000;
  }
}

const makeRegistry = (alive: readonly number[] = []) => {
  const kill = new FakeKill(alive);
  const timeline = new FakeTimeline();
  const registry = createProcessRegistry({ kill: kill.kill, now: timeline.now, delay: timeline.delay });
  return { kill, timeline, registry };
};

afterEach(() => {
  // The shared registry is module state; a test that touched it must leave it empty.
  for (const child of processRegistry.list()) processRegistry.unregister(child.pid);
});

// --- the registry (I-86) ------------------------------------------------------------------------------

describe('createProcessRegistry', () => {
  it('I-86: register and unregister expose exactly the live children with their group, kind and label', () => {
    const { registry } = makeRegistry();
    registry.register({ pid: 11, pgid: 11, kind: 'agent', label: 'provider-x run 01A', command: '/usr/local/bin/provider-x', startedAt: 5, stop: () => undefined });
    registry.register({ pid: 12, pgid: undefined, kind: 'git', label: 'git', command: 'git', startedAt: 6 });
    expect(registry.list()).toStrictEqual([
      { pid: 11, pgid: 11, kind: 'agent', label: 'provider-x run 01A', command: '/usr/local/bin/provider-x', startedAt: 5 },
      { pid: 12, pgid: undefined, kind: 'git', label: 'git', command: 'git', startedAt: 6 },
    ]);
    registry.unregister(11);
    expect(registry.list().map((child) => child.pid)).toStrictEqual([12]);
    // A stale unregister is a no-op, never a throw.
    registry.unregister(11);
  });

  it('I-86: stopAll runs each child’s own stop first, then SIGTERMs the process groups, and a child that dies needs nothing else', async () => {
    const kill = new FakeKill([21, 22]);
    kill.dies(-21, 'SIGTERM'); // the group dies on the graceful signal
    kill.dies(22, 'SIGTERM');
    const stopped: string[] = [];
    const timeline = new FakeTimeline();
    const registry = createProcessRegistry({ kill: kill.kill, now: timeline.now, delay: timeline.delay });
    registry.register({ pid: 21, pgid: 21, kind: 'agent', label: 'agent', command: 'agent', startedAt: 1, stop: () => stopped.push('agent') });
    registry.register({ pid: 22, pgid: undefined, kind: 'probe', label: 'probe', command: 'probe', startedAt: 2 });

    const report = await registry.stopAll();
    expect(stopped).toStrictEqual(['agent']);
    // The agent entry is addressed by its group, the probe by its bare pid.
    expect(kill.signals).toContainEqual({ target: -21, signal: 'SIGTERM' });
    expect(kill.signals).toContainEqual({ target: 22, signal: 'SIGTERM' });
    expect(report).toStrictEqual({ total: 2, killed: 0, timedOut: false });
    // Both are gone, so no poll sleep was even needed beyond the settle beat.
    expect(kill.signals.filter((entry) => entry.signal === 'SIGKILL')).toStrictEqual([]);
  });

  it('I-86: a child that ignores SIGTERM gets SIGKILL only after the 5 s grace, and the pass is bounded', async () => {
    const kill = new FakeKill([31]);
    kill.dies(-31, 'SIGKILL'); // ignores SIGTERM, dies on SIGKILL
    const timeline = new FakeTimeline();
    const registry = createProcessRegistry({ kill: kill.kill, now: timeline.now, delay: timeline.delay });
    registry.register({ pid: 31, pgid: 31, kind: 'agent', label: 'agent', command: 'agent', startedAt: 1 });

    const report = await registry.stopAll();
    expect(report).toStrictEqual({ total: 1, killed: 1, timedOut: false });
    const sigterms = kill.signals.filter((entry) => entry.signal === 'SIGTERM');
    const sigkills = kill.signals.filter((entry) => entry.signal === 'SIGKILL');
    expect(sigterms.length).toBe(1);
    expect(sigkills).toStrictEqual([{ target: -31, signal: 'SIGKILL' }]);
    // The grace window is exactly the bound: the kill lands at the deadline, never later.
    expect(timeline.elapsed()).toBeLessThanOrEqual(PROCESS_STOP_GRACE_MS + 500);
    expect(timeline.elapsed()).toBeGreaterThanOrEqual(PROCESS_STOP_GRACE_MS);
  });

  it('I-86: a child already gone is skipped — no signal, no wait, no error — and one that never dies only times out', async () => {
    const kill = new FakeKill([41]);
    const timeline = new FakeTimeline();
    const registry = createProcessRegistry({ kill: kill.kill, now: timeline.now, delay: timeline.delay });
    registry.register({ pid: 40, pgid: 40, kind: 'git', label: 'git', command: 'git', startedAt: 1 }); // never alive
    registry.register({ pid: 41, pgid: 41, kind: 'gate', label: 'gate', command: 'sh', startedAt: 2 }); // never dies

    const report = await registry.stopAll();
    expect(kill.signals.filter((entry) => entry.target === -40)).toStrictEqual([]);
    expect(report.total).toBe(2);
    expect(report.killed).toBe(1);
    expect(report.timedOut).toBe(true);
  });

  it('I-86: killAllSync is a synchronous last resort that never throws, whatever kill does', () => {
    const kill = new FakeKill([51, 52]);
    const registry = createProcessRegistry({ kill: kill.kill });
    registry.register({ pid: 51, pgid: 51, kind: 'agent', label: 'a', command: 'a', startedAt: 1 });
    registry.register({ pid: 52, pgid: undefined, kind: 'git', label: 'g', command: 'g', startedAt: 2 });
    expect(() => registry.killAllSync()).not.toThrow();
    expect(kill.signals.filter((entry) => entry.signal === 'SIGKILL')).toStrictEqual([
      { target: -51, signal: 'SIGKILL' },
      { target: 52, signal: 'SIGKILL' },
    ]);
  });

  it('I-86: the mirror file carries pid, group, start time and command for every live child, and drops them as they leave', () => {
    const dir = mkdtempSync(join(tmpdir(), 'docket-registry-'));
    const mirrorPath = () => join(dir, 'run', CHILDREN_FILE);
    const registry = createProcessRegistry({ mirrorPath });
    registry.register({ pid: 61, pgid: 61, kind: 'agent', label: 'agent 01A', command: '/bin/agent', startedAt: 77 });
    registry.register({ pid: 62, pgid: undefined, kind: 'probe', label: 'probe', command: 'probe', startedAt: 78 });

    const read = (): unknown => JSON.parse(readFileSync(join(dir, 'run', CHILDREN_FILE), 'utf8'));
    expect(read()).toStrictEqual([
      { pid: 61, pgid: 61, startedAt: 77, command: '/bin/agent' },
      { pid: 62, startedAt: 78, command: 'probe' },
    ]);
    registry.unregister(61);
    expect(read()).toStrictEqual([{ pid: 62, startedAt: 78, command: 'probe' }]);
  });
});

// --- the spawn wrapper (I-86) -------------------------------------------------------------------------

describe('registeredSpawn', () => {
  it('I-86: a wrapped child registers on spawn and unregisters on close; stopAll ends a sleeping child', async () => {
    const before = new Set(processRegistry.list().map((child) => child.pid));
    const child = registeredSpawn(
      process.execPath,
      ['-e', 'setInterval(() => undefined, 50)'],
      { stdio: 'ignore' },
      { kind: 'probe', label: 'test child' },
    );
    if (child.pid === undefined) throw new Error('test child must spawn');
    expect(processRegistry.list().find((entry) => entry.pid === child.pid && !before.has(entry.pid))?.kind).toBe('probe');
    // The close promise exists before the stop: the child can die the moment the signal leaves.
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));

    const report = await processRegistry.stopAll();
    expect(report.total).toBeGreaterThan(0);
    await closed;
    expect(processRegistry.list().map((entry) => entry.pid)).not.toContain(child.pid);
  }, 10_000);
});

// --- the reaper (I-87) --------------------------------------------------------------------------------

describe('reapOrphanedChildren', () => {
  const makeReapDir = (): string => mkdtempSync(join(tmpdir(), 'docket-reap-'));

  const writeChildren = (dir: string, rows: readonly unknown[]): void => {
    mkdirSync(dirname(childrenFilePath(dir)), { recursive: true });
    writeFileSync(childrenFilePath(dir), JSON.stringify(rows), 'utf8');
  };

  it('I-87: seeded cases — matching entry killed, PID-reused entry spared, dead entry dropped, file rewritten', async () => {
    const dir = makeReapDir();
    writeChildren(dir, [
      { pid: 81, pgid: 81, startedAt: 4_000, command: '/usr/local/bin/agent' }, // matches → killed
      { pid: 82, pgid: 82, startedAt: 4_000, command: '/usr/local/bin/agent' }, // reused pid, later start → spared
      { pid: 83, pgid: 83, startedAt: 4_000, command: 'git' }, // reused pid, other binary → spared
      { pid: 84, pgid: 84, startedAt: 4_000, command: 'git' }, // not alive → dropped
    ]);
    const kill = new FakeKill([81, 82, 83]);
    const report = await reapOrphanedChildren({
      dataDir: dir,
      kill: kill.kill,
      inspect: async (pid) => {
        if (pid === 81) return { startedAt: 4_050, command: '/usr/local/bin/agent --flag' };
        if (pid === 82) return { startedAt: 999_999, command: '/usr/local/bin/agent' };
        if (pid === 83) return { startedAt: 4_050, command: '/usr/bin/editor --flag' };
        return undefined;
      },
    });
    expect(report).toStrictEqual({ killed: 1, dropped: 4 });
    expect(kill.signals).toStrictEqual([{ target: -81, signal: 'SIGKILL' }]);
    expect(JSON.parse(readFileSync(childrenFilePath(dir), 'utf8'))).toStrictEqual([]);
  });

  it('I-87: a missing or corrupt children.json is tolerated — nothing is killed, the file ends up valid', async () => {
    const dir = makeReapDir();
    const kill = new FakeKill([91]);
    const missing = await reapOrphanedChildren({ dataDir: dir, kill: kill.kill });
    expect(missing).toStrictEqual({ killed: 0, dropped: 0 });
    expect(existsSync(childrenFilePath(dir))).toBe(false);

    mkdirSync(dirname(childrenFilePath(dir)), { recursive: true });
    writeFileSync(childrenFilePath(dir), 'not json at all', 'utf8');
    const corrupt = await reapOrphanedChildren({ dataDir: dir, kill: kill.kill });
    expect(corrupt).toStrictEqual({ killed: 0, dropped: 0 });
    expect(kill.signals).toStrictEqual([]);
    expect(JSON.parse(readFileSync(childrenFilePath(dir), 'utf8'))).toStrictEqual([]);
  });

  it('I-87: the ps listing parses pid, start stamp (padded day included) and full command', () => {
    const listing = [
      '   PID  LSTART  COMMAND',
      ' 4242 Mon Oct 12 21:00:00 2026 /usr/local/bin/agent --run 01A',
      ' 4243 Mon Sep  1 08:07:08 2026 /opt/homebrew/bin/git diff --name-only',
      'not a ps row',
      '',
    ].join('\n');
    const rows = parsePsOutput(listing);
    expect(rows.size).toBe(2);
    const agent = rows.get(4242);
    expect(agent?.command).toBe('/usr/local/bin/agent --run 01A');
    expect(agent?.startedAt).toBe(Date.parse('Mon Oct 12 21:00:00 2026'));
    const git = rows.get(4243);
    expect(git?.command).toBe('/opt/homebrew/bin/git diff --name-only');
    expect(git?.startedAt).toBe(Date.parse('Mon Sep 1 08:07:08 2026'));
  });
});
