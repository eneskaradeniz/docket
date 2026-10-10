// In-memory MachineProbe and DispatchStatusHolder — the machine reading a test scripted.
import type { MachineSample } from '../../../domain/index';

import type { DispatchStatus, DispatchStatusHolder, MachineProbe } from '../machine-probe';

export interface FakeMachineProbe extends MachineProbe {
  /** The reading every following `read()` answers. */
  set(sample: MachineSample): void;
  /** Makes every following `read()` reject, until `set` is called again. */
  fail(): void;
  readonly reads: () => number;
}

const GIB = 1024 ** 3;

/** Defaults to an idle 10-core, 16 GB machine. */
export const createFakeMachineProbe = (
  initial: MachineSample = { cores: 10, load1: 0, totalMemBytes: 16 * GIB },
): FakeMachineProbe => {
  let sample: MachineSample | undefined = initial;
  let reads = 0;
  return {
    set: (next: MachineSample): void => {
      sample = next;
    },
    fail: (): void => {
      sample = undefined;
    },
    reads: () => reads,
    read: async (): Promise<MachineSample> => {
      reads += 1;
      if (sample === undefined) throw new Error('machine probe failed');
      return { ...sample };
    },
  };
};

export const createFakeDispatchStatus = (): DispatchStatusHolder => {
  let status: DispatchStatus | undefined;
  return {
    get: () => (status === undefined ? undefined : { ...status }),
    set: (next: DispatchStatus): void => {
      status = { ...next };
    },
  };
};
