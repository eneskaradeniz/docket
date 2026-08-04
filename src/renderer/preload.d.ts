// Renderer-side type for the preload bridge (electron/preload.ts). The exposed
// surface is the WorkOrderSource port only — no Node surface leaks (ADR-0006/0001).
import type { WorkOrderSource } from '../core/source';

declare global {
  interface Window {
    docket: { source: WorkOrderSource };
  }
}
