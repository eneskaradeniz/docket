// infrastructure layer barrel — electron/main.ts (Phase 4) imports only this file.
// scenarios/ holds test files only and is deliberately not re-exported.
export * from './system/index';
export * from './storage/sqlite/index';
export * from './storage/keychain/index';
export * from './storage/definitions-yaml/index';
export * from './vcs/index';
export * from './gates/index';
export * from './providers/index';
export * from './compose/index';
