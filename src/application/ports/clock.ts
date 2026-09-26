// Time port — application code never reads a system clock directly; infrastructure supplies it.
import type { EpochMs } from '../../domain/index';

export interface Clock {
  now(): EpochMs;
}
