// Node MachineProbe and in-memory DispatchStatusHolder — rules I-50 and I-51 of
// docs/v2/infrastructure.md. The OS calls are injected, so nothing here reads the real machine.
import { describe, expect, it } from 'vitest';

import { createFakeDispatchStatus } from '../../application/ports/fakes';

import { createMemoryDispatchStatus, createNodeMachineProbe, type MachineOs } from './machine-probe';

const GIB = 1024 ** 3;

const os = (over: Partial<MachineOs> = {}): MachineOs => ({
  platform: 'linux',
  cores: () => 8,
  load1: () => 2.5,
  totalMemBytes: () => 16 * GIB,
  freeMemBytes: () => 4 * GIB,
  readMemoryStatusLevel: async () => {
    throw new Error('sysctl must not be called off darwin');
  },
  ...over,
});

describe('createNodeMachineProbe', () => {
  it('I-50: reads cores, the 1-minute load and total memory from the OS; off darwin free memory is freemem / totalmem', async () => {
    const sample = await createNodeMachineProbe(os()).read();
    expect(sample).toStrictEqual({ cores: 8, load1: 2.5, totalMemBytes: 16 * GIB, freeMemRatio: 0.25 });
  });

  it('I-50: on darwin the free ratio is the OS memory-status level (a percentage) divided by 100, not os.freemem', async () => {
    const probe = createNodeMachineProbe(
      os({ platform: 'darwin', freeMemBytes: () => 0.1 * GIB, readMemoryStatusLevel: async () => '62\n' }),
    );
    expect(await probe.read()).toStrictEqual({ cores: 8, load1: 2.5, totalMemBytes: 16 * GIB, freeMemRatio: 0.62 });
  });

  it('I-50: a failed free-memory reading — a rejected call, unparsable text, a value outside 0..100, zero total memory — leaves freeMemRatio absent', async () => {
    const darwin = (read: () => Promise<string>) => createNodeMachineProbe(os({ platform: 'darwin', readMemoryStatusLevel: read }));
    for (const read of [
      async () => {
        throw new Error('no sysctl');
      },
      async () => 'not a number',
      async () => '140',
      async () => '-3',
      async () => '',
    ]) {
      const sample = await darwin(read).read();
      expect(sample).toStrictEqual({ cores: 8, load1: 2.5, totalMemBytes: 16 * GIB });
    }
    const empty = await createNodeMachineProbe(os({ totalMemBytes: () => 0 })).read();
    expect('freeMemRatio' in empty).toBe(false);
  });

  it('I-50: a failing OS read of cores, load or total memory rejects, so the dispatcher can fall back', async () => {
    await expect(
      createNodeMachineProbe(
        os({
          load1: () => {
            throw new Error('no loadavg');
          },
        }),
      ).read(),
    ).rejects.toThrow('no loadavg');
  });

  it('I-50: every reading is fresh — the probe caches nothing between calls', async () => {
    let load = 1;
    const probe = createNodeMachineProbe(os({ load1: () => load }));
    expect((await probe.read()).load1).toBe(1);
    load = 9;
    expect((await probe.read()).load1).toBe(9);
  });
});

describe('dispatch status holder', () => {
  it('I-51: the memory holder and the fake run the same cases — empty before a first set, last set wins, copies in and out', () => {
    for (const holder of [createMemoryDispatchStatus(), createFakeDispatchStatus()]) {
      expect(holder.get()).toBeUndefined();
      const status = { mode: 'auto', cap: 4, effective: 2, band: 'reduced', load1: 7, cores: 10 } as const;
      holder.set(status);
      expect(holder.get()).toStrictEqual(status);
      expect(holder.get()).not.toBe(holder.get());
      holder.set({ mode: 'fixed', cap: 4, effective: 4, band: 'free' });
      expect(holder.get()).toStrictEqual({ mode: 'fixed', cap: 4, effective: 4, band: 'free' });
    }
  });
});
