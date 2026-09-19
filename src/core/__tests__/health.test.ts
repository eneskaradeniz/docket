import { describe, expect, it } from 'vitest';
import type { DependencyHealth, SystemHealth, SystemHealthWatch } from '../health';

// WO-0066 — the health shapes. The port declares; the behavior pins live in the adapter's
// gitHealth tests (the only logic-carrying check). Core pins the contract's shape: the union,
// the absence discipline, and a minimal watch implementation typechecking.

describe('health shapes (WO-0066)', () => {
  it('DependencyHealth: ok with an optional version; degraded carries the reason verbatim', () => {
    const okGit: DependencyHealth = { tool: 'git', state: 'ok', version: '2.50.1' };
    const okBare: DependencyHealth = { tool: 'forge', state: 'ok' };
    expect('version' in okBare).toBe(false); // absence stays absence
    const degraded: DependencyHealth = { tool: 'agent', state: { degraded: 'gh: Not logged in' } };
    expect(degraded.state).toEqual({ degraded: 'gh: Not logged in' });
    void okGit;
  });

  it('SystemHealth carries the stamp; a minimal watch typechecks against the port', async () => {
    const watch: SystemHealthWatch = {
      systemHealth: () =>
        Promise.resolve<SystemHealth>({
          at: '2026-09-19T12:00:00Z',
          checks: [{ tool: 'git', state: 'ok', version: '2.50.1' }],
        }),
    };
    const health = (await watch.systemHealth())!;
    expect(health.checks[0]!.tool).toBe('git');
    expect(health.at).toBe('2026-09-19T12:00:00Z');
  });
});
