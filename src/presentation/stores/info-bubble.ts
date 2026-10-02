// stores/info-bubble.ts — the info bubble's open/close rules as a pure reducer (U-27). Time is
// injected through each event's `now`; a pending open or close is a due-time the component's timer
// feeds back as a `tick`, so the reducer never reads a clock. One state serves every bubble on the
// screen, which is how only one can be open at a time.

export const INFO_BUBBLE_TIMING = { openMs: 400, closeMs: 150 } as const;

interface Pending {
  readonly action: 'open' | 'close';
  readonly id: string;
  readonly dueAt: number;
}

export interface InfoBubbleState {
  readonly openId: string | null;
  /** Click/Enter/Space pinned it: a pointer leaving no longer closes it. */
  readonly pinned: boolean;
  /** The pointer is on the open bubble itself. */
  readonly onBubble: boolean;
  readonly pending: Pending | null;
}

export const INITIAL_INFO_BUBBLE: InfoBubbleState = { openId: null, pinned: false, onBubble: false, pending: null };

export type InfoBubbleEvent =
  | { readonly type: 'hover-enter'; readonly id: string; readonly now: number }
  | { readonly type: 'hover-leave'; readonly id: string; readonly now: number }
  | { readonly type: 'bubble-enter'; readonly id: string; readonly now: number }
  | { readonly type: 'bubble-leave'; readonly id: string; readonly now: number }
  | { readonly type: 'focus-visible'; readonly id: string; readonly now: number }
  | { readonly type: 'toggle'; readonly id: string; readonly now: number }
  | { readonly type: 'focus-out'; readonly id: string }
  | { readonly type: 'escape' }
  | { readonly type: 'outside-click' }
  | { readonly type: 'scroll' }
  | { readonly type: 'tick'; readonly now: number };

const openNow = (id: string, pinned: boolean): InfoBubbleState => ({ openId: id, pinned, onBubble: false, pending: null });

const scheduleClose = (s: InfoBubbleState, id: string, now: number): InfoBubbleState =>
  s.openId === id && !s.pinned && !s.onBubble
    ? { ...s, pending: { action: 'close', id, dueAt: now + INFO_BUBBLE_TIMING.closeMs } }
    : s;

export const reduceInfoBubble = (s: InfoBubbleState, e: InfoBubbleEvent): InfoBubbleState => {
  switch (e.type) {
    case 'hover-enter':
      if (s.openId === e.id) return { ...s, pending: null };
      return { ...s, pending: { action: 'open', id: e.id, dueAt: e.now + INFO_BUBBLE_TIMING.openMs } };
    case 'hover-leave': {
      const cleared = s.pending?.action === 'open' && s.pending.id === e.id ? { ...s, pending: null } : s;
      return scheduleClose(cleared, e.id, e.now);
    }
    case 'bubble-enter':
      return s.openId === e.id ? { ...s, onBubble: true, pending: null } : s;
    case 'bubble-leave':
      return scheduleClose({ ...s, onBubble: false }, e.id, e.now);
    case 'focus-visible':
      return openNow(e.id, false);
    case 'toggle':
      return s.openId === e.id && s.pinned ? INITIAL_INFO_BUBBLE : openNow(e.id, true);
    case 'focus-out':
      return s.openId === e.id ? INITIAL_INFO_BUBBLE : s;
    case 'escape':
    case 'outside-click':
    case 'scroll':
      return INITIAL_INFO_BUBBLE;
    case 'tick': {
      const p = s.pending;
      if (p === null || e.now < p.dueAt) return s;
      return p.action === 'open' ? openNow(p.id, false) : INITIAL_INFO_BUBBLE;
    }
  }
};
