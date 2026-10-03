// components/info-bubble.tsx — the one info bubble behind every ⓘ, `?` and dashed term (U-27).
// The open/close decisions are the pure reducer in stores/info-bubble.ts and the placement is
// placeBubble; this file owns the DOM only: the button trigger, the hidden-until-open tooltip,
// the listeners (outside click, Esc, scroll, focus-out) and the timer that feeds ticks back.
// One module-level state serves every instance, so only one bubble is open at a time.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import {
  INITIAL_INFO_BUBBLE,
  reduceInfoBubble,
  type InfoBubbleEvent,
  type InfoBubbleState,
} from '../stores/info-bubble';
import { MOTION } from './motion';
import { placeBubble, type BubblePlacement, type Rect } from './bubble-place';

let state: InfoBubbleState = INITIAL_INFO_BUBBLE;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

const dispatch = (event: InfoBubbleEvent): void => {
  const next = reduceInfoBubble(state, event);
  if (next === state) return;
  state = next;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  if (state.pending !== null) {
    const wait = Math.max(0, state.pending.dueAt - Date.now());
    timer = setTimeout(() => dispatch({ type: 'tick', now: Date.now() }), wait);
  }
  listeners.forEach((l) => l());
};

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = (): InfoBubbleState => state;

const toRect = (r: DOMRect): Rect => ({ left: r.left, top: r.top, width: r.width, height: r.height });

/** The nearest panel the bubble must stay inside, else the page. */
const boundsOf = (el: HTMLElement): Rect => {
  const panel = el.closest<HTMLElement>('[data-bubble-bounds]');
  return panel !== null
    ? toRect(panel.getBoundingClientRect())
    : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
};

export interface InfoBubbleProps {
  readonly locale: Locale;
  /** What the bubble is about; the trigger's aria-label is "Bilgi: <subject>". */
  readonly subject: string;
  /** Optional bold first line. */
  readonly title?: string;
  /** Plain text, at most three sentences. */
  readonly body: string;
}

export function InfoBubble({ locale, subject, title, body }: InfoBubbleProps) {
  const id = useId();
  const bubbleId = `${id}-bubble`;
  const wrapRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const shared = useSyncExternalStore(subscribe, snapshot);
  const open = shared.openId === id;
  const [placement, setPlacement] = useState<BubblePlacement | null>(null);

  useLayoutEffect(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!open || trigger === null || bubble === null) {
      setPlacement(null);
      return;
    }
    setPlacement(
      placeBubble(
        toRect(trigger.getBoundingClientRect()),
        { width: bubble.offsetWidth, height: bubble.offsetHeight },
        boundsOf(trigger),
      ),
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return;
      dispatch({ type: 'escape' });
      triggerRef.current?.focus();
    };
    const onPointerDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && wrapRef.current?.contains(e.target)) return;
      dispatch({ type: 'outside-click' });
    };
    const onScroll = (e: Event): void => {
      if (e.target instanceof Node && bubbleRef.current?.contains(e.target)) return;
      dispatch({ type: 'scroll' });
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Leaving the screen with the bubble up must not leave the shared state pointing at us.
  useEffect(() => () => dispatch({ type: 'focus-out', id }), [id]);

  const onBlur = useCallback(
    (e: React.FocusEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && wrapRef.current?.contains(next)) return;
      dispatch({ type: 'focus-out', id });
    },
    [id],
  );

  const above = placement?.side === 'above';
  return (
    <span ref={wrapRef} className="inline-flex flex-none" onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${t(locale, 'info.trigger.prefix')}${subject}`}
        aria-expanded={open}
        aria-describedby={bubbleId}
        onPointerEnter={(e) => {
          if (e.pointerType === 'mouse') dispatch({ type: 'hover-enter', id, now: Date.now() });
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === 'mouse') dispatch({ type: 'hover-leave', id, now: Date.now() });
        }}
        onFocus={(e) => {
          if (e.currentTarget.matches(':focus-visible')) dispatch({ type: 'focus-visible', id, now: Date.now() });
        }}
        onClick={() => dispatch({ type: 'toggle', id, now: Date.now() })}
        className="group grid h-6 w-6 flex-none place-items-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-signal-soft"
      >
        <span
          aria-hidden="true"
          className="grid h-4 w-4 place-items-center text-[12px] leading-none text-inkdim group-hover:text-ink"
        >
          ⓘ
        </span>
      </button>
      <div
        ref={bubbleRef}
        id={bubbleId}
        role="tooltip"
        hidden={!open}
        onPointerEnter={() => dispatch({ type: 'bubble-enter', id, now: Date.now() })}
        onPointerLeave={() => dispatch({ type: 'bubble-leave', id, now: Date.now() })}
        style={{
          position: 'fixed',
          left: placement?.left ?? 0,
          top: placement?.top ?? 0,
          opacity: placement === null ? 0 : 1,
          transitionDuration: `${MOTION.bubble.fadeMs}ms`,
        }}
        className="z-50 w-max min-w-[200px] max-w-[320px] rounded-card border border-bord bg-surface px-3 py-2 text-left text-[12px] leading-snug text-ink transition-opacity motion-reduce:transition-none"
      >
        {placement !== null && (
          <span
            aria-hidden="true"
            style={{ left: placement.arrowLeft - 4 }}
            className={`absolute h-2 w-2 rotate-45 bg-surface ${
              above ? '-bottom-1 border-b border-r border-bord' : '-top-1 border-l border-t border-bord'
            }`}
          />
        )}
        {title !== undefined && <b className="mb-1 block font-semibold">{title}</b>}
        <span className="block text-inkdim">{body}</span>
      </div>
    </span>
  );
}
