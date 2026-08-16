import { describe, expect, it } from 'vitest';
import { formatTranscriptLine } from '../transcript-format';
import type { TranscriptLine } from '../runner';

const ESC = '\x1b';

const assistant = (text: string): TranscriptLine => ({ speaker: 'assistant', text });
const toolUse = (tool: string, detail: string): TranscriptLine => ({ speaker: 'tool_use', tool, detail });
const toolResult = (summary: string, isError = false): TranscriptLine => ({ speaker: 'tool_result', summary, isError });
const system = (text: string): TranscriptLine => ({ speaker: 'system', text });
const note = (kind: 'interrupt_sent' | 'session_closed' | 'force_killed', detail?: string): TranscriptLine =>
  ({ speaker: 'note', kind, ...(detail !== undefined ? { detail } : {}) });

describe('formatTranscriptLine — TranscriptLine → ANSI for the terminal', () => {
  describe('assistant', () => {
    it('plain text passes through with no SGR styling', () => {
      expect(formatTranscriptLine(assistant('Hello there.'))).toBe('Hello there.');
    });
    it('empty string passes through', () => {
      expect(formatTranscriptLine(assistant(''))).toBe('');
    });
    it('embedded newlines are preserved verbatim (the wrapper, not the formatter, splits)', () => {
      expect(formatTranscriptLine(assistant('line one\nline two'))).toBe('line one\nline two');
    });
  });

  describe('tool_use', () => {
    it('wraps the raw tool id in dim denim when no labelFor is given', () => {
      expect(formatTranscriptLine(toolUse('Write', 'src/a.ts'))).toBe(`${ESC}[2m${ESC}[38;2;111;155;176mWrite${ESC}[0m — src/a.ts`);
    });
    it('uses the labelFor result in place of the raw id', () => {
      expect(formatTranscriptLine(toolUse('Write', 'src/a.ts'), { labelFor: () => 'Write file' })).toBe(
        `${ESC}[2m${ESC}[38;2;111;155;176mWrite file${ESC}[0m — src/a.ts`,
      );
    });
    it('omits the detail segment when detail is empty', () => {
      expect(formatTranscriptLine(toolUse('Grep', ''))).toBe(`${ESC}[2m${ESC}[38;2;111;155;176mGrep${ESC}[0m`);
    });
  });

  describe('tool_result', () => {
    it('renders sage with an arrow on success', () => {
      expect(formatTranscriptLine(toolResult('1 file read'))).toBe(`${ESC}[38;2;138;161;114m→ 1 file read${ESC}[0m`);
    });
    it('renders clay on error', () => {
      expect(formatTranscriptLine(toolResult('boom', true))).toBe(`${ESC}[38;2;193;102;90m→ boom${ESC}[0m`);
    });
    it('preserves a multi-line summary verbatim', () => {
      expect(formatTranscriptLine(toolResult('a\nb'))).toBe(`${ESC}[38;2;138;161;114m→ a\nb${ESC}[0m`);
    });
  });

  describe('system', () => {
    it('renders dim', () => {
      expect(formatTranscriptLine(system('session started'))).toBe(`${ESC}[2msession started${ESC}[0m`);
    });
  });

  describe('note (WO-0031c — synthetic operator-side notes: interrupt wind-down, session close, force kill)', () => {
    it('renders the noteFor result dim (display copy injected from labels, never core)', () => {
      expect(formatTranscriptLine(note('interrupt_sent'), { noteFor: () => '⏸ kesme sinyali gönderildi' })).toBe(
        `${ESC}[2m⏸ kesme sinyali gönderildi${ESC}[0m`,
      );
    });
    it('falls back to the raw kind when no noteFor is given', () => {
      expect(formatTranscriptLine(note('session_closed', '$3.60 · 00:14'))).toBe(
        `${ESC}[2msession_closed — $3.60 · 00:14${ESC}[0m`,
      );
    });
    it('the detail rides through noteFor (kind + detail in, one display string out)', () => {
      const noteFor = (kind: string, detail?: string): string => `■ ${kind}${detail ? ` — ${detail}` : ''}`;
      expect(formatTranscriptLine(note('session_closed', '$3.60 · 00:14'), { noteFor })).toBe(
        `${ESC}[2m■ session_closed — $3.60 · 00:14${ESC}[0m`,
      );
      expect(formatTranscriptLine(note('force_killed'), { noteFor })).toBe(`${ESC}[2m■ force_killed${ESC}[0m`);
    });
  });

  it('leaves no SGR run open past the final reset (no leak across writeln)', () => {
    const styled = [
      formatTranscriptLine(toolUse('Write', 'a')), // reset is mid-line, before the plain detail
      formatTranscriptLine(toolResult('a')),
      formatTranscriptLine(toolResult('a', true)),
      formatTranscriptLine(system('a')),
    ];
    for (const s of styled) {
      const tail = s.slice(s.lastIndexOf(`${ESC}[0m`) + 4);
      expect(tail).not.toMatch(/\x1b\[/); // nothing styled after the last reset
    }
  });
});
