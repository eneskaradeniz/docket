/// <reference types="vite/client" />
// mono-scale.test.ts — U-372: monospace is the face of machine data alone — paths, versions,
// commands, ids, money, the work-order code — never of a status chip, a segment's options, a
// section header, a name or a standing word. The presentation sources are scanned for the
// `font-mono` utility; a component keeps it only where every one of its mono lines prints such
// data, and the allowlist below pins those lines per file: a new mono line anywhere — an
// allowlisted file included — must either come off mono or extend its entry with the reason.
// The files are read through the bundler's raw imports — the presentation layer names no Node
// builtin, tests included.
import { describe, expect, it } from 'vitest';

const raw = (glob: Record<string, unknown>): Readonly<Record<string, string>> => glob as Record<string, string>;

const SOURCES = raw(
  import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.test.ts', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);

const MONO = /font-mono/;

/** One allowlisted component: `lines` is how many of its lines carry `font-mono`, `why` the
 *  machine data (U-372's list) those lines print. */
interface MonoEntry {
  readonly file: string;
  readonly lines: number;
  readonly why: string;
}

const MONO_FILES: readonly MonoEntry[] = [
  { file: './components/account-editor-dialog.tsx', lines: 1, why: 'the header meta: identity dir · endpoint host' },
  { file: './components/account-editor.tsx', lines: 3, why: 'identity-dir and endpoint-host facts, the spend money figure, the cap money input' },
  { file: './components/account-groups.tsx', lines: 1, why: 'the row meta: account path · host' },
  { file: './components/account-test.tsx', lines: 1, why: 'the CLI test run output (pre)' },
  { file: './components/builtin-mcp-row.tsx', lines: 2, why: 'the MCP server tool-name lists (run · / chat ·)' },
  { file: './components/capability-section.tsx', lines: 7, why: 'source paths, commands and plugin source paths of every capability' },
  { file: './components/chat-feed.tsx', lines: 3, why: 'tool-result table cells, the card type id (repo/target), raw tool output' },
  { file: './components/chat-image-enlarge-dialog.tsx', lines: 1, why: 'the enlarged image file name' },
  { file: './components/chat-style.tsx', lines: 3, why: 'source/reference chips and the thumb: file names, sent refs, work-order codes' },
  { file: './components/connectors-section.tsx', lines: 2, why: 'connector version, the connector CLI error text' },
  { file: './components/detail-decision-card.tsx', lines: 12, why: 'git-ref inputs (commit, base), environment ids, permission tool name and target, error/code lines, PR and release refs' },
  { file: './components/detail-files.tsx', lines: 1, why: 'the changed-file list rows' },
  { file: './components/detail-run-card.tsx', lines: 1, why: 'the run short code' },
  { file: './components/detail-usage-line.tsx', lines: 1, why: 'token and money metering line' },
  { file: './components/detail-work-order-usage.tsx', lines: 6, why: 'token, run, cache, pay and plan metering lines' },
  { file: './components/error-boundary.tsx', lines: 1, why: 'the stack trace (pre)' },
  { file: './components/flow-strip.tsx', lines: 2, why: 'flow-version and role-version chips' },
  { file: './components/memory-section.tsx', lines: 1, why: 'the memory row source run id' },
  { file: './components/model-list.tsx', lines: 2, why: 'the $ billing mark, the money cap input' },
  { file: './components/past-versions-modal.tsx', lines: 1, why: 'the version badge text' },
  { file: './components/permission-prompt.tsx', lines: 1, why: 'the path the permission ask is about' },
  { file: './components/project-bundle-dialog.tsx', lines: 1, why: 'the definition id renames (id → to)' },
  { file: './components/project-spend-header.tsx', lines: 3, why: 'repo-id spend chips with money, the of-cap money line' },
  { file: './components/provider-list.tsx', lines: 3, why: 'provider version, binary path, install URL' },
  { file: './components/repo-relink-banner.tsx', lines: 1, why: 'the repo path to relink' },
  { file: './components/run-pinned-versions-view.tsx', lines: 1, why: 'the pinned version chips' },
  { file: './components/search-palette.tsx', lines: 1, why: 'the esc keycap (a keyboard command)' },
  { file: './components/setup-copy-from.tsx', lines: 1, why: 'the typed target path input' },
  { file: './components/setup-import-repos.tsx', lines: 2, why: 'the typed parent path input, repo directory names' },
  { file: './components/setup-proposal-diff.tsx', lines: 4, why: 'flow/role/policy/command config summaries, the test-command input' },
  { file: './components/setup-summary.tsx', lines: 1, why: 'the repo id' },
  { file: './components/sidebar-accounts.tsx', lines: 1, why: 'the tightest quota percent meter' },
  { file: './components/sidebar-nav.tsx', lines: 1, why: 'the search keycap (a keyboard command)' },
  { file: './components/tracker-link-section.tsx', lines: 2, why: 'the tracker scope and connection ids' },
  { file: './components/version-badge.tsx', lines: 1, why: 'the version badge text' },
  { file: './components/board-card.tsx', lines: 1, why: 'the work-order code' },
  { file: './components/board-list.tsx', lines: 1, why: 'the row work-order code' },
  { file: './components/cockpit-attention.tsx', lines: 2, why: 'the work-order code, the permission ask target path' },
  { file: './components/cockpit-closed.tsx', lines: 1, why: 'the work-order code' },
  { file: './components/cockpit-running.tsx', lines: 1, why: 'the work-order code' },
  { file: './screens/account-view.tsx', lines: 3, why: 'the plan id, the quota percent meter, the work-order code' },
  { file: './screens/board.tsx', lines: 1, why: 'the repo identifier as the board title' },
  { file: './screens/detail.tsx', lines: 8, why: 'gate and machine-gate ids, check names, work-order code, repo id, repo-context path, environment ids' },
  { file: './screens/live.tsx', lines: 4, why: 'tool names and their targets, the ask tool name and target' },
  { file: './screens/new-project.tsx', lines: 3, why: 'the typed repo-path and parent-path inputs' },
  { file: './screens/page-viewer.tsx', lines: 3, why: 'version references, the page diff body' },
  { file: './screens/proposals.tsx', lines: 3, why: 'proposal targets (paths), the diff body' },
  { file: './screens/roadmap.tsx', lines: 4, why: 'work-order code links/chips, task repo identifiers' },
  { file: './screens/settings.tsx', lines: 2, why: 'the app version strings (current, next)' },
  { file: './screens/storage-open-error.tsx', lines: 2, why: 'the storage paths the error names' },
  { file: './screens/wizard.tsx', lines: 5, why: 'keyboard command keycaps (Alt, ↑, ↓), the $ money mark, the money input' },
];

describe('mono scale', () => {
  it('U-372: monospace stays only on the allowlisted machine-data lines, counts pinned', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const actual = new Map<string, number>();
    for (const [file, source] of Object.entries(SOURCES)) {
      const count = source.split('\n').filter((line) => MONO.test(line)).length;
      if (count > 0) actual.set(file, count);
    }
    const allowed = new Map(MONO_FILES.map((entry) => [entry.file, entry.lines]));
    const outside = [...actual.entries()]
      .filter(([file]) => !allowed.has(file))
      .map(([file, count]) => `${file}: ${count} mono line(s) not in the allowlist`);
    const drift = MONO_FILES.flatMap((entry) => {
      const count = actual.get(entry.file);
      return count === entry.lines ? [] : [`${entry.file}: expected ${entry.lines} mono line(s), found ${count ?? 0}`];
    });
    expect([...outside, ...drift]).toEqual([]);
  });
});
