// Machine-aware concurrency: how busy the machine is, how many runs that allows, and what cap to
// suggest. Contract: docs/v2/domain.md section 8 (R-69 … R-72).

export interface MachineSample {
  readonly cores: number;
  readonly load1: number; // the 1-minute load average
  readonly freeMemRatio?: number; // 0..1; absent = unknown
  readonly totalMemBytes: number;
}

export type LoadBand = 'free' | 'reduced' | 'busy';

const REDUCED_ENTER = 0.6;
const REDUCED_LEAVE = 0.5;
const BUSY_ENTER = 1.0;
const BUSY_LEAVE = 0.85;
const MEM_BUSY_ENTER = 0.15;
const MEM_BUSY_LEAVE = 0.2;
const MAX_CAP = 16;
const GIB = 1024 ** 3;

/** The thresholds differ on the way in and the way out so a load hovering near one never flaps. */
export function loadBand(sample: MachineSample, previous: LoadBand): LoadBand {
  const perCore = sample.load1 / Math.max(1, sample.cores);
  const mem = sample.freeMemRatio;
  if (perCore >= BUSY_ENTER || (mem !== undefined && mem < MEM_BUSY_ENTER)) return 'busy';
  switch (previous) {
    case 'busy':
      // One band per sample: a busy machine is seen as reduced before it is seen as free.
      return perCore < BUSY_LEAVE && (mem === undefined || mem >= MEM_BUSY_LEAVE) ? 'reduced' : 'busy';
    case 'reduced':
      return perCore < REDUCED_LEAVE ? 'free' : 'reduced';
    case 'free':
      return perCore >= REDUCED_ENTER ? 'reduced' : 'free';
  }
}

/** The global limit for new starts. Busy admits nothing new while a run is active, but a
 *  machine with no run still makes progress. */
export function effectiveGlobal(cap: number, band: LoadBand, running: number): number {
  const wanted = band === 'free' ? cap : band === 'reduced' ? Math.max(1, Math.floor(cap / 2)) : Math.max(1, running);
  return Math.min(cap, wanted);
}

/** Agents mostly wait on the model, so half the cores bound the build/test spikes and about
 *  4 GB per run bounds memory. */
export function suggestDispatchCap(machine: { readonly cores: number; readonly totalMemBytes: number }): number {
  const byCores = Math.floor(machine.cores / 2);
  const byMemory = Math.floor(machine.totalMemBytes / GIB / 4);
  return Math.max(1, Math.min(MAX_CAP, byCores, byMemory));
}
