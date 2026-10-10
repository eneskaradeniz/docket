// A complete AppDeps of fakes — the test bundle every use case and service is driven with.
import type { AppDeps } from '../deps';

import { createFakeAccountRepo } from './fake-account-repo';
import { createFakeAccountTestRepo } from './fake-account-test-repo';
import { createFakeActionRepo, createFakeGrantRepo } from './fake-action-repo';
import { createFakeAppSettingsRepo } from './fake-app-settings-repo';
import { createFakeAttachmentFiles } from './fake-attachment-files';
import { createFakeBindingRepo } from './fake-binding-repo';
import { createFakeCapabilityCatalog } from './fake-capability-catalog';
import { createFakeCapabilityDiscovery } from './fake-capability-discovery';
import { createFakeCheckpointCommitter } from './fake-checkpoints';
import { createFakeClock } from './fake-clock';
import { createFakeCommandRunner, createFakeEvidenceChecker, createFakeSecretScanner, createFakeWorktrees } from './fake-repo-tools';
import { createFakeConversationRepo } from './fake-conversation-repo';
import { createFakeDefinitionStore } from './fake-definition-store';
import { createFakeEventLog } from './fake-event-log';
import { createFakeGitProbe } from './fake-git-probe';
import { createFakeIdGen } from './fake-id-gen';
import { createFakeDispatchStatus, createFakeMachineProbe } from './fake-machine-probe';
import { createFakeInstructionFiles } from './fake-instruction-files';
import { createFakeModelCatalog } from './fake-model-catalog';
import { createFakeNotifier } from './fake-notifier';
import { createFakePageFiles } from './fake-page-files';
import { createFakePageRepo } from './fake-page-repo';
import { createFakePhaseAutoRunRepo } from './fake-phase-auto-run-repo';
import { createFakeProjectRepo } from './fake-project-repo';
import { createFakeProposalRepo } from './fake-proposal-repo';
import { createFakeQueueRepo } from './fake-queue-repo';
import { createFakeRepoFolders } from './fake-repo-folders';
import { createFakeRepoFileReader } from './fake-repo-file-reader';
import { createFakeRepoRegistry } from './fake-repo-registry';
import { createFakeRunDirs } from './fake-run-dirs';
import { createFakeRunRepo } from './fake-run-repo';
import { createFakeRunTokens } from './fake-run-tokens';
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
  capabilityDiscovery: createFakeCapabilityDiscovery(),
  modelCatalog: createFakeModelCatalog(),
  projects: createFakeProjectRepo(),
  repos: createFakeRepoRegistry(),
  bindings: createFakeBindingRepo(),
  queue: createFakeQueueRepo(),
  definitions: createFakeDefinitionStore(),
  proposals: createFakeProposalRepo(),
  pages: createFakePageRepo(),
  pageFiles: createFakePageFiles(),
  conversations: createFakeConversationRepo(),
  attachmentFiles: createFakeAttachmentFiles(),
  actions: createFakeActionRepo(),
  grants: createFakeGrantRepo(),
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
  settings: createFakeAppSettingsRepo(),
  phaseAutoRuns: createFakePhaseAutoRunRepo(),
  scratch: createFakeScratchDirs(),
  repoFolders: createFakeRepoFolders(),
  repoFiles: createFakeRepoFileReader(),
  worktreeFiles: createFakeWorktreeFiles(),
  machine: createFakeMachineProbe(),
  dispatchStatus: createFakeDispatchStatus(),
  runTokens: createFakeRunTokens(),
  runDirs: createFakeRunDirs(),
  mcpEndpoint: undefined,
  ...overrides,
});
