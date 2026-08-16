// src/core/transcript-format.ts — pure projection of a TranscriptLine into an ANSI-styled
// string for the xterm terminal (TD-020). SGR codes are emitted directly (no dependency).
//
// The runner stream is structured, not ANSI (src/core/runner.ts RunnerEvent), so the terminal's
// styling is synthesized here from the TranscriptLine discriminator. Core cannot import src/ui/
// (ADR-0006): the tool→display-label mapping is injected via FormatOptions.labelFor (the wrapper
// passes `toolLabel` from labels.ts). All string munging lives here, never in src/ui/ — the
// `.replace(` proxy is banned in src/ui/ (ADR-0007).
import type { TranscriptLine } from './runner';
import type { TranscriptNoteKind } from './types';

// SGR codes. 24-bit foreground colours mirror the app's warm-dark tokens (src/index.css) so the DETAY
// stream reads as one system with the rest of the UI: denim (tool use), sage (ok result), clay (error).
const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const DENIM = '\x1b[38;2;111;155;176m'; // --color-denim #6f9bb0
const SAGE = '\x1b[38;2;138;161;114m'; // --color-sage   #8aa172
const CLAY = '\x1b[38;2;193;102;90m'; // --color-clay   #c1665a

/** Display-label resolver for tool ids. Default is identity (the raw id). */
export interface FormatOptions {
  labelFor?: (tool: string) => string;
  /** Display resolver for operator-side notes (WO-0031c): kind + optional detail → one line.
   *  Default: `kind` (` — detail` when present) — the raw ids, like the labelFor fallback. */
  noteFor?: (kind: TranscriptNoteKind, detail?: string) => string;
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
      const head = `${DIM}${DENIM}${labelFor(line.tool)}${RESET}`;
      return line.detail ? `${head} — ${line.detail}` : head;
    }
    case 'tool_result':
      return `${line.isError ? CLAY : SAGE}→ ${line.summary}${RESET}`;
    case 'system':
      return `${DIM}${line.text}${RESET}`;
    case 'note': {
      const noteFor = opts?.noteFor ?? ((kind: string, detail?: string) => (detail ? `${kind} — ${detail}` : kind));
      return `${DIM}${noteFor(line.kind, line.detail)}${RESET}`;
    }
  }
}
