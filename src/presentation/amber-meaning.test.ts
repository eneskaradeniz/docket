/// <reference types="vite/client" />
// amber-meaning.test.ts — U-373: amber carries one meaning — the operator is needed. It marks an
// open permission ask, a pending gate, a waiting count, an account that needs login or discovery
// (U-34), a meter entering its warning band (U-31), a proposal or a warning that waits on a
// person — and it fills the view's single primary action (U-375); nothing else takes it. A
// selected row or segment option never takes amber: selection is a neutral fill, a raised surface
// with ink text. The keyboard focus ring is exempt (focus is not a meaning). The presentation
// sources are scanned for every amber token outside focus utilities; each line that still carries
// one must sit in a file the map below records, with the exact count it holds — a new amber line
// anywhere, or a recorded count gone stale, fails here first.
import { describe, expect, it } from 'vitest';

const raw = (glob: Record<string, unknown>): Readonly<Record<string, string>> => glob as Record<string, string>;

const SOURCES = raw(
  import.meta.glob(['./**/*.ts', './**/*.tsx', './**/*.css', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);

// The focus utilities come off before the scan: the focus ring may take amber.
const FOCUS_UTILITY = /(?:focus-visible|focus-within|focus):[^\s'"`]*/g;

// An amber token is a Tailwind utility or a raw var reference on the signal family — bg-signal,
// text-signal-soft, border-signal/45, border-t-signal, outline-signal, accent-signal,
// var(--signal) — or the tone-map key that names one. A bare word (a tone name in a prop, prose)
// is not a colour and does not match.
const AMBER = /--signal|[a-z]+-signal|signal\s*:/;

const amberLines = (source: string): readonly number[] =>
  source
    .split('\n')
    .flatMap((line, index) => (AMBER.test(line.replace(FOCUS_UTILITY, '')) ? [index + 1] : []));

/** Files that hold amber, with the count of amber lines each holds and the meaning that keeps it:
 *  an ask, a gate, a waiting count, a warning band (U-31), a needs-login/discovery state (U-34),
 *  or the primary button (U-375). */
const ALLOWED: Readonly<Record<string, number>> = {
  // The token definitions themselves — the colour exists; this scan polices its use.
  './styles/tokens.css': 11,
  // The primary tier's fill (U-375) and the asks' confirm buttons that draw it.
  './components/action-button.tsx': 1,
  './components/chat-style.tsx': 1,
  './components/permission-prompt.tsx': 1,
  './screens/page-viewer.tsx': 2,
  './screens/proposals.tsx': 4,
  './screens/roadmap.tsx': 4,
  './components/title-bar.tsx': 1,
  // Permission asks and pending gates — attention that waits on a person.
  './screens/live.tsx': 2,
  './screens/detail.tsx': 5,
  './components/detail-decision-card.tsx': 2,
  './components/detail-strip.tsx': 2,
  './components/cockpit-attention.tsx': 2,
  './components/stage-skip-proposal-card.tsx': 1,
  './components/overlay-editor.tsx': 1,
  './components/account-test.tsx': 1,
  './components/repo-relink-banner.tsx': 1,
  './components/setup-import-repos.tsx': 1,
  './screens/library.tsx': 1,
  './components/chat-feed.tsx': 1,
  // Waiting counts and needs-login/discovery lamps (U-34).
  './screens/cockpit.tsx': 1,
  './components/cockpit-format.ts': 2,
  './components/cockpit-projects.tsx': 3,
  './components/cockpit-states.tsx': 1,
  './components/board-card.tsx': 3,
  './components/board-column.tsx': 2,
  './components/board-list.tsx': 1,
  './components/board-status.ts': 2,
  './components/sidebar-tree.tsx': 1,
  './components/sidebar-accounts.tsx': 1,
  './components/sidebar-nav.tsx': 1,
  './components/status-lamp.tsx': 1,
  './components/state-badge.tsx': 1,
  './components/account-groups.tsx': 1,
  './components/settings-menu.tsx': 1,
  './components/chat-dock.tsx': 1,
  // Warnings and meters that wait on a person: the U-31 warning band, spend waste, truncation,
  // the warn toast voice, notes that name a problem to fix.
  './components/meter-list.tsx': 4,
  './components/project-spend-header.tsx': 2,
  './screens/account-view.tsx': 2,
  './components/concurrency-section.tsx': 1,
  './components/setting-row.tsx': 1,
  './components/memory-section.tsx': 1,
  './components/model-list.tsx': 1,
  './components/account-editor.tsx': 2,
  './components/settings-cards.tsx': 2,
  './components/toast-host.tsx': 3,
  './components/chat-composer.tsx': 2,
  './components/detail-run-card.tsx': 1,
  './components/detail-work-order-usage.tsx': 4,
  './components/provider-list.tsx': 1,
};

describe('amber meaning', () => {
  it('U-373: amber marks only the operator-needed sites the map records — selection, decoration and status-without-need draw neutral fills or ink', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) => {
      const lines = amberLines(source);
      const recorded = ALLOWED[file];
      if (recorded === undefined) return lines.length > 0 ? [`${file}: amber on lines ${lines.join(', ')} — no record`] : [];
      return lines.length !== recorded ? [`${file}: ${lines.length} amber lines (${lines.join(', ')}), recorded ${recorded}`] : [];
    });
    expect(offenders).toEqual([]);
  });
});
