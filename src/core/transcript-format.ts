// src/core/transcript-format.ts — pure projection of a TranscriptLine into an ANSI-styled
// string for the xterm terminal (TD-020). SGR codes are emitted directly (no dependency).
//
// The runner stream is structured, not ANSI (src/core/runner.ts RunnerEvent), so the terminal's
// styling is synthesized here from the TranscriptLine discriminator. Core cannot import src/ui/
// (ADR-0006): the tool→display-label mapping is injected via FormatOptions.labelFor (the wrapper
// passes `toolLabel` from labels.ts). All string munging lives here, never in src/ui/ — the
// `.replace(` proxy is banned in src/ui/ (ADR-0007).
import type { TranscriptLine } from './runner';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const BRIGHT_RED = '\x1b[91m';

/** Display-label resolver for tool ids. Default is identity (the raw id). */
export interface FormatOptions {
  labelFor?: (tool: string) => string;
}

/**
 * Style one TranscriptLine for `term.writeln`. Multi-line text is preserved verbatim — the
 * terminal wrapper splits on `\n` so each source line becomes its own row (CR+LF per row).
 */
export function formatTranscriptLine(line: TranscriptLine, opts?: FormatOptions): string {
  const labelFor = opts?.labelFor ?? ((t: string) => t);
  switch (line.speaker) {
    case 'assistant':
      return line.text;
    case 'tool_use': {
      const head = `${DIM}${CYAN}${labelFor(line.tool)}${RESET}`;
      return line.detail ? `${head} — ${line.detail}` : head;
    }
    case 'tool_result':
      return `${line.isError ? BRIGHT_RED : GREEN}→ ${line.summary}${RESET}`;
    case 'system':
      return `${DIM}${line.text}${RESET}`;
  }
}
