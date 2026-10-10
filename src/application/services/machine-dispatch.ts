// services/machine-dispatch.ts — the per-tick composition that turns the operator's limits and the
// machine's load into the limits one dispatcher tick runs with (docs/v2/application.md A-120 …
// A-125). The decision rules live in the domain (`loadBand`, `effectiveGlobal`); this file only
// reads the ports, remembers the band between ticks and writes the status.
import type { DispatchLimits, MachineSample } from '../../domain/index';
import { effectiveGlobal, loadBand } from '../../domain/index';

import type { AppDeps } from '../ports/index';
import { getDispatchLimits, getDispatchMode } from '../use-cases/index';

/**
 * The limits for this tick. `fixed` answers the stored limits as they are. `auto` reads the machine
 * and throttles only the global limit for new starts; a run already running is never touched (the
 * dispatcher only decides about queued items). A probe failure counts as a free machine for this
 * tick and is reported through `onProbeError`, never thrown.
 */
export async function resolveDispatchLimits(
  deps: Pick<AppDeps, 'settings' | 'machine' | 'runs' | 'dispatchStatus'>,
  onProbeError?: (error: unknown) => void,
): Promise<DispatchLimits> {
  const limits = await getDispatchLimits(deps);
  const mode = await getDispatchMode(deps);
  const cap = limits.global;

  if (mode === 'fixed') {
    deps.dispatchStatus.set({ mode, cap, effective: cap, band: 'free' });
    return limits;
  }

  let sample: MachineSample;
  try {
    sample = await deps.machine.read();
  } catch (error) {
    onProbeError?.(error);
    deps.dispatchStatus.set({ mode, cap, effective: cap, band: 'free' });
    return limits;
  }

  const previous = deps.dispatchStatus.get()?.band ?? 'free';
  const band = loadBand(sample, previous);
  const running = (await deps.runs.listActive()).length;
  const global = effectiveGlobal(cap, band, running);

  deps.dispatchStatus.set({
    mode,
    cap,
    effective: global,
    band,
    load1: sample.load1,
    cores: sample.cores,
    ...(sample.freeMemRatio === undefined ? {} : { freeMemRatio: sample.freeMemRatio }),
  });
  return {
    global,
    perRepo: Math.min(limits.perRepo, global),
    perAccount: Object.fromEntries(Object.entries(limits.perAccount).map(([id, limit]) => [id, Math.min(limit, global)])),
  };
}
