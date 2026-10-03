// use-cases/account-test.ts — the account test ("Test et"), docs/v2/application.md A-68 … A-74.
// One small real request on the account's route with a classified result. It is not a work-order
// run: no RunRecord, no queue item, no worktree, and no event is persisted.
import type { AccountId, AccountTestClass, AccountTestOutcome, AgentEvent, EpochMs, Result, RoleDef, RoleSlug, ScopedSpend } from '../../domain/index';
import { ACCOUNT_TEST_PROMPT, classifyAccountTest, combinedSpendStatus, err, ok } from '../../domain/index';

import type { AccountTestRecord, AppDeps, RunHandle } from '../ports';
import { spendWindow } from '../services/dispatcher';
import { spendConsentSatisfied } from '../services/spend-consent';

/** From the transport start to the deadline. */
export const ACCOUNT_TEST_TIMEOUT_MS = 90_000;

// The id is a fixed, valid slug; the assertion mirrors how the built-in library declares its roles.
export const ACCOUNT_TEST_ROLE: RoleDef = {
  id: 'account-test' as RoleSlug,
  name: 'Account test',
  instructions: ACCOUNT_TEST_PROMPT,
  writeScope: { kind: 'none' },
  capabilities: [],
  active: true,
};

export type AccountTestError = 'not_found' | 'busy' | 'unsupported' | 'needs_spend_consent' | 'spend_cap_reached';

export interface AccountTestView {
  readonly state: 'running' | 'ok' | 'failed';
  readonly class: AccountTestClass | null; // failed only
  readonly model: string | null; // null = the route's default model
  readonly at: EpochMs; // endedAt, or startedAt while running
  readonly detail: string | null; // failed only; redacted, at most 300 code points
}

/** The surface's view of a stored record (A-72). */
export const accountTestViewOf = (record: AccountTestRecord): AccountTestView => {
  const failed = record.state === 'failed';
  return {
    state: record.state,
    class: failed ? (record.class ?? null) : null,
    model: record.model,
    at: record.endedAt ?? record.startedAt,
    detail: failed ? (record.detail ?? null) : null,
  };
};

const SYSTEM_ACTOR = { kind: 'system', component: 'account-test' } as const;

interface Collected {
  readonly events: AgentEvent[];
  timedOut: boolean;
}

/** Reads the run to its end or its deadline. Permission asks are denied, usage is recorded as
 *  account spend, and nothing reaches RunRepo or the work-order stream. */
const collect = async (
  deps: Pick<AppDeps, 'accounts'>,
  accountId: AccountId,
  handle: RunHandle,
): Promise<Collected> => {
  const collected: Collected = { events: [], timedOut: false };
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    deadline = setTimeout(() => resolve('expired'), ACCOUNT_TEST_TIMEOUT_MS);
  });
  const iterator = handle.events[Symbol.asyncIterator]();
  try {
    for (;;) {
      const step = await Promise.race([iterator.next(), expired]);
      if (step === 'expired') {
        collected.timedOut = true;
        // The stream is not awaited again: a transport that ignores stop() must not hang the test.
        await handle.stop().catch(() => undefined);
        void Promise.resolve(iterator.return?.()).catch(() => undefined);
        break;
      }
      if (step.done === true) break;
      const event = step.value;
      collected.events.push(event);
      if (event.type === 'permission_ask') handle.answerPermission(event.id, 'deny');
      if (event.type === 'usage' && event.costUsd !== undefined) {
        await deps.accounts.recordSpend({ kind: 'account_test', accountId, at: event.at, usd: event.costUsd });
      }
    }
  } finally {
    if (deadline !== undefined) clearTimeout(deadline);
  }
  return collected;
};

export async function testAccount(
  deps: Pick<
    AppDeps,
    'clock' | 'ids' | 'log' | 'accounts' | 'transports' | 'modelCatalog' | 'capabilities' | 'accountTests' | 'scratch'
  >,
  input: { readonly id: AccountId; readonly model?: string },
): Promise<Result<AccountTestView, AccountTestError>> {
  const { id } = input;
  // A-68: every refusal comes before the first write, in this order.
  const account = await deps.accounts.get(id);
  if (account === undefined) return err('not_found');
  if ((await deps.accountTests.get(id))?.state === 'running') return err('busy');
  const transport = await deps.transports.forAccount(id);
  if (transport === undefined) return err('unsupported');
  if (!(await spendConsentSatisfied(deps, id, input.model))) return err('needs_spend_consent');
  const now = deps.clock.now();
  const scoped: ScopedSpend[] = [];
  for (const { scope, cap } of account.caps) {
    const window = spendWindow(scope, now);
    scoped.push({ scope, observedUsd: await deps.accounts.spend({ accountId: id, from: window.from, to: window.to }), cap });
  }
  if (combinedSpendStatus(scoped).status === 'hard_stop') return err('spend_cap_reached');

  // A-69
  const model = input.model ?? null;
  const startedAt = deps.clock.now();
  await deps.accountTests.save({ accountId: id, model, state: 'running', startedAt });
  const saveThrown = (): Promise<void> =>
    deps.accountTests.save({ accountId: id, model, state: 'failed', class: 'unknown', detail: '', startedAt, endedAt: deps.clock.now() });

  const scratch = await deps.scratch.create('account-test').catch(async (error: unknown) => {
    await saveThrown();
    throw error;
  });
  let outcome: AccountTestOutcome;
  try {
    const started = await transport.start({
      runId: deps.ids.next<'run'>(),
      cwd: scratch.path,
      role: ACCOUNT_TEST_ROLE,
      route: input.model === undefined ? { accountId: id } : { accountId: id, model: input.model },
      prompt: ACCOUNT_TEST_PROMPT,
      capabilities: [],
    });
    if (!started.ok) {
      outcome = classifyAccountTest({ startFailure: started.error, events: [], timedOut: false });
    } else {
      const collected = await collect(deps, id, started.value);
      outcome = classifyAccountTest({ events: collected.events, timedOut: collected.timedOut });
    }
  } catch (error) {
    await saveThrown();
    throw error;
  } finally {
    await scratch.dispose();
  }

  // A-70
  const endedAt = deps.clock.now();
  const record: AccountTestRecord = outcome.ok
    ? { accountId: id, model, state: 'ok', startedAt, endedAt }
    : { accountId: id, model, state: 'failed', class: outcome.class, detail: outcome.detail, startedAt, endedAt };
  await deps.accountTests.save(record);
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: endedAt,
    actor: SYSTEM_ACTOR,
    action: 'account.tested',
    subject: { kind: 'account', id },
    detail: { model: input.model ?? '*', result: outcome.ok ? 'ok' : outcome.class },
  });
  // The view is what the repo holds, so the adapter's redaction shows in the answer too.
  const stored = await deps.accountTests.get(id);
  return ok(accountTestViewOf(stored ?? record));
}
