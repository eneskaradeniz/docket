import { useEffect, useRef } from 'react';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import type { TranscriptLine } from '../../../core/runner';
import { formatTranscriptLine } from '../../../core/transcript-format';
import { useLabels } from '../../data/locale';

// xterm paints its own canvas and does NOT inherit CSS, so the terminal theme must be read from the app's
// CSS tokens at construction (and re-read on a light/dark toggle). Values mirror src/index.css @theme; the
// fallbacks keep it legible if a var is ever missing. No hard-coded white anywhere.
function readTokens(): ITheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string): string => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--color-bg', '#0e1520'),
    foreground: v('--color-ink', '#e7edf4'),
    selectionBackground: 'rgba(245,181,68,0.22)',
    black: v('--color-hairline', '#263349'),
    brightBlack: v('--color-inkdim', '#8b95a7'),
    red: v('--color-error', '#e5484d'),
    green: v('--color-proceed', '#4cc38a'),
    yellow: v('--color-signal', '#f5b544'),
    blue: v('--color-info', '#6ca0ce'),
    cyan: v('--color-info', '#6ca0ce'),
    white: v('--color-ink', '#e7edf4'),
    brightWhite: v('--color-ink', '#e7edf4'),
  };
}

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
  compact,
}: {
  entries: TranscriptLine[];
  /** Changes when the stream should clear (a fresh drive). SessionPane feeds the provider session id. */
  resetKey?: string;
  /** WO-0031f v6: the in-row form of the active step's spine row — a shorter floor (120px vs 220px). */
  compact?: boolean;
}) {
  const { toolLabel, UI } = useLabels();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const writtenCountRef = useRef(0);
  const lastResetKeyRef = useRef<string | undefined>(undefined);
  // TD-038.3: the pulse's dispose timer rides this ref — cleared on the effect's cleanup AND on
  // unmount, so a disposed terminal is never decorated by a timer that outlived it.
  const pulseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Create the terminal once; refit whenever the CONTAINER resizes; dispose on unmount. `disableStdin`
  // keeps it read-only (input stays the prompt + drive controls). A ResizeObserver (WO-0031c) — not the
  // old window listener — covers the tab-switch case: a forceMount-hidden tab panel collapses to 0 and
  // re-expands on return, and only the element's own box tells that story. No marker-style options are
  // set — the boundary check's vendor-name regex matches a bare word that overlaps xterm option names.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const term = new XTerm({
      scrollback: 5000,
      disableStdin: true,
      fontFamily: 'IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      theme: readTokens(),
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
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        // ignore — a transient zero-size while a tab panel is hidden or mid-layout
      }
    });
    resizeObserver.observe(el);
    termRef.current = term;
    // A fresh terminal instance replays from the start (also covers a strict-mode remount).
    writtenCountRef.current = 0;
    lastResetKeyRef.current = undefined;
    // Re-theme when the app toggles light/dark (the html.light class swaps the CSS vars). Re-apply in place
    // so scrollback survives — no remount.
    const observer = new MutationObserver(() => {
      if (termRef.current) termRef.current.options.theme = readTokens();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  // Diff new entries into the terminal; clear on a resetKey change. Splitting on `\n` and
  // writeln-ing each piece gives CR+LF per source row (no staircase). convertEol stays off.
  // WO-0031c: operator-side notes (interrupt/close/force-kill) render through UI.noteFor.
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
    // WO-0031d / v4 §7 — the newline pulse: only a LIVE append (something was already written in this
    // mount; a resume seed writes 0→N and stays calm) washes its last line briefly. The decoration API
    // has no animation; the pulse is register → dispose. Reduced-motion never registers it.
    const pulse = writtenCountRef.current > 0 && writtenCountRef.current < entries.length;
    for (let i = writtenCountRef.current; i < entries.length; i++) {
      const formatted = formatTranscriptLine(entries[i], { labelFor: toolLabel, noteFor: UI.noteFor });
      for (const piece of formatted.split('\n')) term.writeln(piece);
    }
    writtenCountRef.current = entries.length;
    if (pulse && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      try {
        const marker = term.registerMarker(-1);
        if (marker) {
          const deco = term.registerDecoration({ marker, width: term.cols, backgroundColor: 'rgba(76, 195, 138, 0.12)' });
          pulseTimerRef.current = setTimeout(() => { deco?.dispose(); marker.dispose(); }, 400);
        }
      } catch {
        // decoration surface unavailable — the pulse is optional by ruling
      }
    }
    return () => {
      if (pulseTimerRef.current !== null) {
        clearTimeout(pulseTimerRef.current);
        pulseTimerRef.current = null;
      }
    };
  }, [entries, resetKey, toolLabel, UI]);

  return (
    <div className={compact ? 'h-full min-h-[120px] w-full flex-1 overflow-hidden rounded-md border border-hairline bg-bg p-1.5' : 'h-full min-h-[220px] w-full flex-1 overflow-hidden rounded-md border border-hairline bg-bg p-1.5'}>
      <div ref={containerRef} className="h-full w-full" />
    </div>
  );
}
