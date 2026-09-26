// A complete AppDeps of fakes — the test bundle every use case and service is driven with.
import type { AppDeps } from '../deps';

import { createFakeAccountRepo } from './fake-account-repo';
import { createFakeBindingRepo } from './fake-binding-repo';
import { createFakeClock } from './fake-clock';
import { createFakeCommandRunner, createFakeEvidenceChecker, createFakeSecretScanner, createFakeWorktrees } from './fake-workspace-tools';
import { createFakeDefinitionStore } from './fake-definition-store';
import { createFakeEventLog } from './fake-event-log';
import { createFakeIdGen } from './fake-id-gen';
import { createFakeNotifier } from './fake-notifier';
import { createFakeProposalRepo } from './fake-proposal-repo';
import { createFakeQueueRepo } from './fake-queue-repo';
import { createFakeRunRepo } from './fake-run-repo';
import { createFakeSecretVault } from './fake-secret-vault';
import { createFakeTransportResolver } from './fake-transport';
import { createFakeWorkOrderRepo } from './fake-work-order-repo';

/**
 * Builds a fresh bundle of every fake; `overrides` replaces exactly the ports it names, so a test
 * keeps hold of the fakes whose helpers it wants to drive (advance, seed, script, …).
 */
export const createFakeDeps = (overrides: Partial<AppDeps> = {}): AppDeps => ({
  clock: createFakeClock(),
  ids: createFakeIdGen(),
  log: createFakeEventLog(),
  workOrders: createFakeWorkOrderRepo(),
  runs: createFakeRunRepo(),
  accounts: createFakeAccountRepo(),
  bindings: createFakeBindingRepo(),
  queue: createFakeQueueRepo(),
  definitions: createFakeDefinitionStore(),
  proposals: createFakeProposalRepo(),
  secrets: createFakeSecretVault(),
  transports: createFakeTransportResolver(),
  commands: createFakeCommandRunner(),
  secretScanner: createFakeSecretScanner(),
  worktrees: createFakeWorktrees(),
  evidence: createFakeEvidenceChecker(),
  notifier: createFakeNotifier(),
  ...overrides,
});
