// Fakes barrel — one in-memory fake per port, plus the ready-made AppDeps bundle.
// Contract: docs/v2/application.md (rules for fakes A-1 … A-4).
export * from './fake-account-repo';
export * from './fake-binding-repo';
export * from './fake-clock';
export * from './fake-definition-store';
export * from './fake-deps';
export * from './fake-event-log';
export * from './fake-forge';
export * from './fake-id-gen';
export * from './fake-notifier';
export * from './fake-proposal-repo';
export * from './fake-queue-repo';
export * from './fake-run-repo';
export * from './fake-secret-vault';
export * from './fake-transport';
export * from './fake-workspace-tools';
export * from './fake-work-order-repo';
