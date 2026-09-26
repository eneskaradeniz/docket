// The fallback prompt when session/load cannot restore the previous conversation. The summary
// is built only from what the protocol itself replayed before the load failed (a failed load
// may still have streamed part of the history), so the fresh session keeps the earlier context
// without the client inventing any. Contract: docs/v2/providers.md → "ACP transport (P-17)".
import type { TranscriptEntry } from './map-update';

/** One replayed entry contributes at most this many characters. */
const ENTRY_LIMIT = 400;
/** The whole transcript summary contributes at most this many characters. */
const TOTAL_LIMIT = 2000;

const HEADER =
  'The previous session could not be loaded, so this is a fresh session. ' +
  'A truncated transcript of the earlier conversation follows; treat it as context ' +
  'and continue with the new instructions after it.';

export function buildResumePrompt(prompt: string, transcript: readonly TranscriptEntry[]): string {
  const lines: string[] = [HEADER, ''];
  let used = 0;
  for (const entry of transcript) {
    if (used >= TOTAL_LIMIT) break;
    const room = Math.min(ENTRY_LIMIT, TOTAL_LIMIT - used);
    const text = entry.text.length > room ? `${entry.text.slice(0, room)}…` : entry.text;
    used += text.length;
    lines.push(`[${entry.role}] ${text}`);
  }
  lines.push('', '--- end of previous transcript ---', '', prompt);
  return lines.join('\n');
}
