import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { TranscriptLine } from '../../../core/runner';
import { formatTranscriptLine } from '../../../core/transcript-format';
import { toolLabel } from '../../data/labels';

// xterm.js terminal for the live session transcript (TD-020). Replaces the flat Transcript list.
// The terminal is a read-only view of the same `LiveSessionState.entries` fold the list consumed;
// the runner stream and the prompt/drive controls are unchanged. The transcript is ephemeral
// (ADR-0010) — a fresh drive clears the terminal, resume appends the new stream to a blank one.
//
// Run-verified, not unit-tested (ADR-0006: React components are verified by running them; vitest
// excludes .tsx anyway). The byte-for-byte styling contract lives in core's formatTranscriptLine.
export function Terminal({
  entries,
  resetKey,
}: {
  entries: TranscriptLine[];
  /** Changes when the stream should clear (a fresh drive). SessionPane feeds the provider session id. */
  resetKey?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const writtenCountRef = useRef(0);
  const lastResetKeyRef = useRef<string | undefined>(undefined);

  // Create the terminal once; refit on resize; dispose on unmount. `disableStdin` keeps it
  // read-only (input stays the prompt + drive controls). No marker-style options are set — the
  // boundary check's vendor-name regex matches a bare word that overlaps xterm option names.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new XTerm({
      scrollback: 5000,
      disableStdin: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      theme: { background: '#ffffff', foreground: '#1e293b' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(el);
    try {
      fit.fit();
    } catch {
      // The container can be zero-sized in a layout race; safe to skip the first fit.
    }
    const onResize = (): void => {
      try {
        fit.fit();
      } catch {
        // ignore — a transient zero-size during resize
      }
    };
    window.addEventListener('resize', onResize);
    termRef.current = term;
    // A fresh terminal instance replays from the start (also covers a strict-mode remount).
    writtenCountRef.current = 0;
    lastResetKeyRef.current = undefined;
    return () => {
      window.removeEventListener('resize', onResize);
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Diff new entries into the terminal; clear on a resetKey change. Splitting on `\n` and
  // writeln-ing each piece gives CR+LF per source row (no staircase). convertEol stays off.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    if (resetKey !== lastResetKeyRef.current) {
      term.reset();
      writtenCountRef.current = 0;
      lastResetKeyRef.current = resetKey;
    }
    // Defensive: entries shrank without a resetKey change — treat as a reset.
    if (writtenCountRef.current > entries.length) {
      term.reset();
      writtenCountRef.current = 0;
    }
    for (let i = writtenCountRef.current; i < entries.length; i++) {
      const formatted = formatTranscriptLine(entries[i], { labelFor: toolLabel });
      for (const piece of formatted.split('\n')) term.writeln(piece);
    }
    writtenCountRef.current = entries.length;
  }, [entries, resetKey]);

  return (
    <div className="h-64 w-full overflow-hidden rounded-md border border-slate-200 bg-white">
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
