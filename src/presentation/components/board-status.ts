// components/board-status.ts — the words and hues a work order's status carries on the board's
// Kanban cards: one label key per known status, one lamp and one text hue per tone. A status
// outside the closed set shows as its own dim slug instead of pretending a known state.
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { CardTone } from '../stores/board';

export const STATUS_KEY: Readonly<Record<string, LabelKey>> = {
  ready: 'wo.status.ready',
  running: 'wo.status.running',
  gating: 'wo.status.gating',
  awaiting_human: 'wo.status.awaiting_human',
  limit_waiting: 'wo.status.limit_waiting',
  blocked: 'wo.status.blocked',
  done: 'wo.status.done',
};

export const statusLabel = (locale: Locale, status: string): string => {
  const key = STATUS_KEY[status];
  return key === undefined ? status : t(locale, key);
};

/** The lamp before the status word: a queued card carries a hollow ring, a running one breathes
 *  (still under reduced motion), an unknown status carries no lamp. */
export const TONE_LAMP: Readonly<Record<CardTone, string>> = {
  ready: 'bg-transparent ring-[1.5px] ring-inset ring-inkdim',
  running: 'bg-proceed motion-safe:animate-pulse [animation-duration:var(--motion-board-pulse)]',
  gating: 'bg-info',
  attention: 'bg-signal',
  blocked: 'bg-error',
  done: 'bg-proceed',
  unknown: 'hidden',
};

export const TONE_TEXT: Readonly<Record<CardTone, string>> = {
  ready: 'text-inkdim',
  running: 'text-proceed',
  gating: 'text-info',
  attention: 'text-signal-soft',
  blocked: 'text-error',
  done: 'text-inkdim',
  unknown: 'text-inkdim',
};
