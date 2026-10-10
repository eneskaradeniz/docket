// The machine's load as the OS reports it, plus the in-memory holder of the dispatcher's last
// status (I-50, I-51). The OS calls are injected so tests never read the real machine.
import { execFile } from 'node:child_process';
import { cpus, freemem, loadavg, platform, totalmem } from 'node:os';

import type { MachineSample } from '../../domain/index';

import type { DispatchStatus, DispatchStatusHolder, MachineProbe } from '../../application/index';

export interface MachineOs {
  readonly platform: string;
  cores(): number;
  load1(): number;
  totalMemBytes(): number;
  freeMemBytes(): number;
  /** The text `sysctl -n kern.memorystatus_level` prints (macOS only; rejects on failure). */
  readMemoryStatusLevel(): Promise<string>;
}

const SYSCTL_TIMEOUT_MS = 2_000;

const readSysctlLevel = (): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile('sysctl', ['-n', 'kern.memorystatus_level'], { timeout: SYSCTL_TIMEOUT_MS }, (error, stdout) => {
      if (error !== null) reject(error);
      else resolve(stdout);
    });
  });

const nodeOs = (): MachineOs => ({
  platform: platform(),
  cores: () => cpus().length,
  load1: () => loadavg()[0] ?? 0,
  totalMemBytes: totalmem,
  freeMemBytes: freemem,
  readMemoryStatusLevel: readSysctlLevel,
});

/** 0..1 or `undefined` when the machine cannot tell. macOS reports free memory as a percentage
 *  of the OS's own accounting, because `os.freemem()` there counts reclaimable cache as used. */
const freeRatio = async (machine: MachineOs, totalMemBytes: number): Promise<number | undefined> => {
  try {
    if (machine.platform === 'darwin') {
      const percent = Number.parseFloat(await machine.readMemoryStatusLevel());
      return Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent / 100 : undefined;
    }
    if (!(totalMemBytes > 0)) return undefined;
    const ratio = machine.freeMemBytes() / totalMemBytes;
    return Number.isFinite(ratio) && ratio >= 0 && ratio <= 1 ? ratio : undefined;
  } catch {
    return undefined;
  }
};

export const createNodeMachineProbe = (machine: MachineOs = nodeOs()): MachineProbe => ({
  read: async (): Promise<MachineSample> => {
    const cores = machine.cores();
    const load1 = machine.load1();
    const totalMemBytes = machine.totalMemBytes();
    const freeMemRatio = await freeRatio(machine, totalMemBytes);
    return { cores, load1, totalMemBytes, ...(freeMemRatio === undefined ? {} : { freeMemRatio }) };
  },
});

export const createMemoryDispatchStatus = (): DispatchStatusHolder => {
  let status: DispatchStatus | undefined;
  return {
    get: () => (status === undefined ? undefined : { ...status }),
    set: (next: DispatchStatus): void => {
      status = { ...next };
    },
  };
};
