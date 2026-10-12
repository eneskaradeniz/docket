// electron/quit-flow.ts — the managed quit, in testable pieces. main.ts supplies the Electron
// surfaces (the native dialog, the window, app.quit) as injected functions; this module owns the
// decisions: when to ask, what the dialog lists, the shutdown order and its 8-second bound. It
// imports no Electron module, so vitest drives it like any other unit.
import type { ActiveWork, ProcessRegistry } from '../src/application/index';
import type { Locale } from '../src/presentation/labels/t';
import { t } from '../src/presentation/labels/t';

import { dataDirOutsideDocketHome } from './dev-bridge';

/** The e2e harness switch: `DOCKET_QUIT_CONFIRM=accept|cancel` answers the quit confirmation. */
export const QUIT_CONFIRM_ENV = 'DOCKET_QUIT_CONFIRM';

/** The whole confirm→stop→cancel→quit sequence ends inside this bound, whatever hangs. */
export const QUIT_SEQUENCE_BOUND_MS = 8_000;

/** The dialog lists at most this many work lines, then “+N more”. */
export const QUIT_MAX_DETAIL_LINES = 5;

export type QuitConfirmAnswer = 'accept' | 'cancel';

export interface QuitConfirmGate {
  /** `DOCKET_QUIT_CONFIRM`, verbatim. */
  readonly value: string | undefined;
  /** `app.isPackaged` — a packaged build never auto-answers. */
  readonly isPackaged: boolean;
  /** `DOCKET_DATA_DIR`, verbatim; unset means the app runs on its real storage. */
  readonly dataDir: string | undefined;
  /** The operator's real data directory (`~/.docket`). */
  readonly docketHome: string;
}

/** The harness answer, honoured only under the same data-dir rule the CDP/dev bridge uses: an
 *  unpackaged app whose data dir sits outside the operator's real one. Everywhere else the native
 *  dialog is the only way to answer, so an ordinary `electronApp.close()` is never short-circuited. */
export const quitConfirmAutoAnswer = (gate: QuitConfirmGate): QuitConfirmAnswer | undefined => {
  if (gate.isPackaged || gate.dataDir === undefined || gate.dataDir === '') return undefined;
  if (!dataDirOutsideDocketHome(gate.dataDir, gate.docketHome)) return undefined;
  return gate.value === 'accept' || gate.value === 'cancel' ? gate.value : undefined;
};

/** The dialog's work lines: every active run and chat turn by title, at most five, then the
 *  “+N more” line for the rest. Runs first, then chats, in the order activeWork listed them. */
export const quitDetailLines = (
  work: ActiveWork,
  moreLine: (hidden: number) => string,
): readonly string[] => {
  const titles = [...work.runs.map((run) => run.title), ...work.chats.map((chat) => chat.title)];
  const shown = titles.slice(0, QUIT_MAX_DETAIL_LINES);
  const hidden = titles.length - shown.length;
  return hidden > 0 ? [...shown, moreLine(hidden)] : [...shown];
};

export interface QuitDialogContent {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly cancelLabel: string;
  readonly stopLabel: string;
}

/** Formats the native confirmation dialog content from the active locale's label bundle (U-295). */
export const formatQuitDialog = (work: ActiveWork, locale: Locale): QuitDialogContent => {
  const total = work.runs.length + work.chats.length;
  const title = t(locale, 'quit.title');
  const body = t(locale, 'quit.body').replace('{n}', String(total));
  const note = t(locale, 'quit.note');
  const cancelLabel = t(locale, 'quit.cancel');
  const stopLabel = t(locale, 'quit.stop');
  const more = (hidden: number): string => t(locale, 'quit.more').replace('{n}', String(hidden));
  const lines = quitDetailLines(work, more);

  return {
    title,
    message: title,
    detail: `${body}\n\n${lines.join('\n')}\n\n${note}`,
    cancelLabel,
    stopLabel,
  };
};

export interface QuitFlowPorts {
  /** The work in flight, as the application sees it. */
  readonly work: () => Promise<ActiveWork>;
  /** The confirmation; resolves true for “Quit and stop”, false for “Cancel”. */
  readonly ask: (work: ActiveWork) => Promise<boolean>;
  /** The process registry: stop every child (graceful, then signals). */
  readonly registry: Pick<ProcessRegistry, 'stopAll' | 'killAllSync'>;
  /** The cancel-all sweep: every run still active is closed as cancelled. */
  readonly cancelRuns: () => Promise<void>;
  /** Ends the app (app.quit). */
  readonly quit: () => void;
  readonly now: () => number;
  readonly delay: (ms: number) => Promise<void>;
  /** Failure text only — names, never payloads. */
  readonly log: (message: string) => void;
}

/** The managed quit. No user-visible work → no dialog, the children are still stopped. Work in
 *  flight → ask first; Cancel changes nothing. Confirm (or no work) → stop every registered child
 *  (each run ends cancelled through its own normal path), sweep whatever stayed active, quit. The
 *  sequence is bounded: a stop that never ends is cut off by the synchronous last resort, the
 *  sweep still runs, and the app quits. */
export const managedQuit = async (ports: QuitFlowPorts): Promise<void> => {
  const work = await ports.work();
  if (work.runs.length > 0 || work.chats.length > 0) {
    if (!(await ports.ask(work))) return;
  }

  let swept = false;
  const sweep = async (): Promise<void> => {
    if (swept) return;
    swept = true;
    await ports.cancelRuns();
  };

  const startedAt = ports.now();
  const sequence = (async () => {
    const report = await ports.registry.stopAll();
    if (report.timedOut) ports.log(`stop pass ended with children still alive (${report.killed} killed)`);
    await sweep();
  })().catch((error: unknown) => {
    // The quit never dies with the shutdown: a failing step is logged by name and the bound path
    // still ends the children.
    ports.log(`quit sequence step failed: ${error instanceof Error ? error.name : 'unknown'}`);
    return undefined;
  });
  const bound = ports.delay(QUIT_SEQUENCE_BOUND_MS).then(() => {
    // The bound fired: whatever hung does not get to hang the quit with it.
    ports.log(`quit sequence overran ${QUIT_SEQUENCE_BOUND_MS} ms after ${ports.now() - startedAt} ms; killing synchronously`);
    ports.registry.killAllSync();
    return true as const;
  });

  await Promise.race([sequence, bound]);
  await sweep();
  ports.quit();
};
