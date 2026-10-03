// Quota service — owns the schedule of quota reads (P-49, A-80). A read never starts a run: the
// probes behind pollQuota ask the CLI's usage surface and nothing else. The composition root
// starts the service when the app is ready and stops it on quit; the interval timers are injected
// so tests drive the schedule with fakes.
import type { AccountId } from '../../domain/index';

import type { AccountRecord, AppDeps, QuotaProbeResolver } from '../ports';
import { pollQuota } from '../use-cases/quota-poll';

export const QUOTA_POLL_INTERVAL_MS = 300_000;

export interface QuotaService {
  /** Polls every account once (in repo order, one at a time), then on every interval. */
  start(): void;
  stop(): void;
  /** One account or all; resolves when the polls end. */
  refresh(accountId?: AccountId): Promise<void>;
}

export interface QuotaTimers {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

export function createQuotaService(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'capabilities'>,
  probes: QuotaProbeResolver,
  timers: QuotaTimers,
  onChanged: () => void,
): QuotaService {
  const inFlight = new Map<AccountId, Promise<void>>();
  let handle: unknown;
  let started = false;

  /** A route kind with no poll surface (`none`) is skipped, and so is one whose quota only runs
   * push (`rate_limit_events`): polling it would read the machine's subscription login for an
   * account that rides an API key. */
  const hasPoll = (account: AccountRecord): boolean => {
    const kindId = deps.capabilities.routeKindOf(account);
    const probe = kindId === undefined ? undefined : deps.capabilities.routeKind(kindId)?.quotaProbe;
    return probe !== 'none' && probe !== 'rate_limit_events';
  };

  const pollOnce = async (account: AccountRecord): Promise<void> => {
    try {
      // The outcome needs no handling here: a failed poll keeps the stored meters (P-49), and
      // the surface re-reads them on the event either way.
      await pollQuota(deps, probes, { accountId: account.id });
    } catch {
      // pollQuota does not throw; a broken port must still not take the schedule down.
    }
    try {
      onChanged();
    } catch {
      // A broken listener must not stop the next poll.
    }
  };

  const poll = (account: AccountRecord): Promise<void> => {
    if (!hasPoll(account)) return Promise.resolve();
    const running = inFlight.get(account.id);
    if (running !== undefined) return running;
    const next = pollOnce(account).finally(() => {
      inFlight.delete(account.id);
    });
    inFlight.set(account.id, next);
    return next;
  };

  const refresh = async (accountId?: AccountId): Promise<void> => {
    try {
      if (accountId !== undefined) {
        const account = await deps.accounts.get(accountId);
        if (account !== undefined) await poll(account);
        return;
      }
      for (const account of await deps.accounts.list()) await poll(account);
    } catch {
      // A store that throws ends this pass; the next interval tries again.
    }
  };

  return {
    start: () => {
      if (started) return;
      started = true;
      void refresh();
      handle = timers.setInterval(() => {
        void refresh();
      }, QUOTA_POLL_INTERVAL_MS);
    },
    stop: () => {
      if (!started) return;
      started = false;
      timers.clearInterval(handle);
      handle = undefined;
    },
    refresh,
  };
}
