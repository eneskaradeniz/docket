// Gate command execution: exactly the configured environment, own process group, bounded output tail.
import type { CommandRunner } from '../../application/index';

export interface CommandRunnerConfig {
  readonly env: Readonly<Record<string, string>>; // the complete child environment (built by the composition root)
  readonly tailBytes?: number; // default 8192
}

export function createCommandRunner(config: CommandRunnerConfig): CommandRunner {
  void config;
  throw new Error('not implemented');
}
