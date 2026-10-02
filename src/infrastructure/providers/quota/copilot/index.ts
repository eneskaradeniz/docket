// Copilot quota surface public API — the snapshot mapper. The probe that would call the
// provider SDK's quota RPC ships separately, because that SDK is not a dependency of this
// repository; the mapper is the whole deliverable until that decision changes.
export * from './quota-mapper';
