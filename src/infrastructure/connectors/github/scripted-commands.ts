// The scripted exec port the gh adapter tests drive. The adapters take the argument-vector
// shape, so the fake records and scripts exactly that — bin and args, no line building here
// (rendering belongs to the connector context, whose own tests prove it).
import type { CommandResult, ConnectorCommand, ConnectorCommands } from '../../../application/index';

export interface ScriptedCall {
  readonly bin: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>> | undefined;
}

export interface ScriptedCommands extends ConnectorCommands {
  /** Scripts the result for one exact command; same-command scripts are consumed in order. */
  script(command: ConnectorCommand, result: CommandResult): void;
  calls(): readonly ScriptedCall[];
}

// The full argument vector is the key, so two commands differing only in word boundaries never
// collide the way a joined string would.
const keyOf = (command: ConnectorCommand): string => JSON.stringify([command.bin, ...command.args]);

export const createScriptedCommands = (): ScriptedCommands => {
  const scripts = new Map<string, CommandResult[]>();
  const calls: ScriptedCall[] = [];
  return {
    run: async (cwd, command, _timeoutMs, env) => {
      calls.push({ bin: command.bin, args: command.args, cwd, env });
      const queue = scripts.get(keyOf(command));
      // Without a script the command succeeds with no output, like the line-based fake's default.
      const scripted = queue?.shift();
      return scripted === undefined ? { exitCode: 0, durationMs: 0, outputTail: '' } : scripted;
    },
    script: (command, result) => {
      const queue = scripts.get(keyOf(command));
      if (queue === undefined) scripts.set(keyOf(command), [result]);
      else queue.push(result);
    },
    calls: () => [...calls],
  };
};

/** The gh argument vector every adapter test scripts. */
export const gh = (...args: string[]): ConnectorCommand => ({ bin: 'gh', args });
