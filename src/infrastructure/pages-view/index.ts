// Public API of infrastructure/pages-view — the policy behind the isolated page viewer
// (docs/v2/infrastructure.md I-63 … I-70). Pure: no Electron import lives here.
export * from './allow';
export * from './headers';
export * from './page-url';
export * from './resolve';
export * from './responder';
export * from './view-requests';
export * from './view-host';
