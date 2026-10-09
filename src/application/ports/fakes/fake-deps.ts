// A complete AppDeps of fakes — the test bundle every use case and service is driven with.
import type { AppDeps } from '../deps';

import { createFakeAccountRepo } from './fake-account-repo';
import { createFakeAccountTestRepo } from './fake-account-test-repo';
import { createFakeBindingRepo } from './fake-binding-repo';
import { createFakeCapabilityCatalog } from './fake-capability-catalog';
import { createFakeCheckpointCommitter } from './fake-checkpoints';
import { createFakeClock } from './fake-clock';
import { createFakeCommandRunner, createFakeEvidenceChecker, createFakeSecretScanner, createFakeWorktrees } from './fake-repo-tools';
import { createFakeDefinitionStore } from './fake-definition-store';
import { createFakeEventLog } from './fake-event-log';
import { createFakeGitProbe } from './fake-git-probe';
import { createFakeIdGen } from './fake-id-gen';
import { createFakeInstructionFiles } from './fake-instruction-files';
import { createFakeModelCatalog } from './fake-model-catalog';
import { createFakeNotifier } from './fake-notifier';
import { createFakeProjectRepo } from './fake-project-repo';
import { createFakeProposalRepo } from './fake-proposal-repo';
import { createFakeQueueRepo } from './fake-queue-repo';
import { createFakeRepoFolders } from './fake-repo-folders';
import { createFakeRepoRegistry } from './fake-repo-registry';
import { createFakeRunRepo } from './fake-run-repo';
import { createFakeScratchDirs } from './fake-scratch-dirs';
import { createFakeSecretVault } from './fake-secret-vault';
import { createFakeTransportResolver } from './fake-transport';
import { createFakeWorkOrderRepo } from './fake-work-order-repo';
import { createFakeWorktreeFiles } from './fake-worktree-files';

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
  capabilities: createFakeCapabilityCatalog(),
  modelCatalog: createFakeModelCatalog(),
  projects: createFakeProjectRepo(),
  repos: createFakeRepoRegistry(),
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
  git: createFakeGitProbe(),
  notifier: createFakeNotifier(),
  instructionFiles: createFakeInstructionFiles(),
  checkpoints: createFakeCheckpointCommitter(),
  accountTests: createFakeAccountTestRepo(),
  scratch: createFakeScratchDirs(),
  repoFolders: createFakeRepoFolders(),
  worktreeFiles: createFakeWorktreeFiles(),
  ...overrides,
});
