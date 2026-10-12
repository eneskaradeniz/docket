// electron/quit-prompt.ts — the in-app quit confirmation, main-process side (U-294, U-296). main.ts
// supplies the Electron surfaces (the window, the event push, the native dialog) as functions; this
// module owns the order: make sure a window exists and is shown, send the renderer the request,
// wait up to two seconds for its acknowledgement, and fall back to the native dialog when none
// comes. Waiting for the operator's answer is unbounded; only the acknowledgement is timed.
// It imports no Electron module, so vitest drives it with fakes.
import type { ActiveWork } from '../src/application/index';

/** The renderer has this long, from the window being shown, to say the modal is up. */
export const QUIT_ACK_TIMEOUT_MS = 2_000;

export interface QuitPromptPorts {
  /** Creates or restores the main window when none is open; shows and focuses it. Resolves once the
   *  window is shown (and its page had its chance to load). */
  readonly ensureWindow: () => Promise<void>;
  /** Pushes `quit.requested` to the window over the event bridge: titles only. */
  readonly request: (runs: readonly string[], chats: readonly string[]) => void;
  /** The native dialog, exactly as before the modal existed; true = quit and stop. */
  readonly nativeAsk: (work: ActiveWork) => Promise<boolean>;
  readonly delay: (ms: number) => Promise<void>;
}

export interface QuitPrompt {
  /** Resolves true for “Kapat ve durdur”, false for “Vazgeç”. A second call while one is open
   *  refocuses the open prompt and shares its answer. */
  ask(work: ActiveWork): Promise<boolean>;
  /** The renderer says its modal is on screen (`quit.ack`). */
  ack(): void;
  /** The renderer's answer (`quit.answer`). Ignored when no prompt waits or it fell back. */
  answer(accept: boolean): void;
  /** True while a prompt waits for its answer (modal or native). */
  readonly open: () => boolean;
}

interface Pending {
  readonly work: ActiveWork;
  readonly settle: (accept: boolean) => void;
  readonly promise: Promise<boolean>;
  /** Resolves on the renderer's first `quit.ack` — one signal per prompt, awaited by every
   *  presentation of it, so a repeated request never strands an earlier one in the fallback. */
  readonly ackArrived: Promise<void>;
  readonly signalAck: () => void;
  /** True once the renderer acknowledged; read after the race, which cannot say which side won. */
  acked: boolean;
  /** The native dialog took over: modal answers and late acks no longer count. */
  fellBack: boolean;
}

export const createQuitPrompt = (ports: QuitPromptPorts): QuitPrompt => {
  let pending: Pending | undefined;

  const titles = (work: ActiveWork): { runs: readonly string[]; chats: readonly string[] } => ({
    runs: work.runs.map((run) => run.title),
    chats: work.chats.map((chat) => chat.title),
  });

  /** Shows the window, sends the request, and reports whether the renderer acknowledged in time.
   *  Every presentation of one prompt awaits the same ack signal, so a second request during (or
   *  after) the ack window resolves with the modal up rather than drifting into the fallback. */
  const present = async (current: Pending): Promise<boolean> => {
    await ports.ensureWindow();
    const { runs, chats } = titles(current.work);
    ports.request(runs, chats);
    await Promise.race([current.ackArrived, ports.delay(QUIT_ACK_TIMEOUT_MS)]);
    return current.acked;
  };

  const fallBack = async (current: Pending): Promise<void> => {
    if (current.fellBack) return;
    current.fellBack = true;
    current.settle(await ports.nativeAsk(current.work));
  };

  return {
    open: () => pending !== undefined,
    ask: (work) => {
      if (pending !== undefined) {
        const current = pending;
        // A second quit request refocuses the open prompt. The request is sent again so a window
        // the operator closed and reopened shows the modal; no acknowledgement means the native
        // dialog answers instead.
        if (!current.fellBack) {
          void present(current).then((acked) => (acked ? undefined : fallBack(current)));
        }
        return current.promise;
      }
      let settle: (accept: boolean) => void = () => undefined;
      const promise = new Promise<boolean>((resolve) => {
        settle = resolve;
      });
      let signalAck: () => void = () => undefined;
      const ackArrived = new Promise<void>((resolve) => {
        signalAck = resolve;
      });
      const current: Pending = { work, settle, promise, ackArrived, signalAck, acked: false, fellBack: false };
      pending = current;
      void promise.then(() => {
        if (pending === current) pending = undefined;
      });
      void present(current)
        .then((acked) => (acked ? undefined : fallBack(current)))
        .catch(() => fallBack(current));
      return promise;
    },
    ack: () => {
      if (pending === undefined || pending.fellBack) return;
      pending.acked = true;
      pending.signalAck();
    },
    answer: (accept) => {
      if (pending === undefined || pending.fellBack) return;
      pending.settle(accept);
    },
  };
};
