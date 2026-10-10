// The machine's own load, read by the dispatcher on each tick (A-117 …).
import type { LoadBand, MachineSample } from '../../domain/index';

export interface MachineProbe {
  /** One reading of the machine. Rejects when the machine cannot be read at all; a single
   *  unknown figure (free memory) is an absent field, never a rejection. */
  read(): Promise<MachineSample>;
}

/** What the dispatcher last decided and why. In memory only — it is never persisted. */
export interface DispatchStatus {
  readonly mode: 'fixed' | 'auto';
  readonly cap: number; // the operator's global limit
  readonly effective: number; // the global limit this tick used
  readonly band: LoadBand;
  readonly load1?: number; // absent when no machine reading was taken (fixed mode, failed probe)
  readonly cores?: number;
  readonly freeMemRatio?: number;
}

export interface DispatchStatusHolder {
  /** The last tick's status, or `undefined` before the first tick. */
  get(): DispatchStatus | undefined;
  set(status: DispatchStatus): void;
}
