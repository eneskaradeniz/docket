// toasts.test.ts — U-50: the one toast service. Every sentence of the rule runs here against a
// clock the test drives by hand: the one call, the three-visible cap (the oldest leaves outright),
// the 5 s self-dismiss (warn and error 8 s), the hover/focus pause that holds a toast open and
// resumes where it stood, and the close control that removes it and stops its timer. U-50a adds
// the optional `copy` text and how an ok:false command result maps onto the toast: the code's
// label as text, the raw code only behind the copy button.
import { afterEach, describe, expect, it } from 'vitest';

import { t } from '../labels/t';
import { GENERIC_FAILURE_KEY, failureKey } from './results';
import { MAX_VISIBLE_TOASTS, TOAST_MS, createToastStore, toastOutcome, toastStore } from './toasts';

// The outcome bridge writes into the app's own service; each of its tests reads the newest
// toast there and leaves nothing standing for the next one.
afterEach(() => {
  for (const item of toastStore.state()) toastStore.close(item.id);
});

/** The clock fake: time moves only when the test says so, so the durations read in fake
 *  milliseconds instead of real seconds. */
const manualClock = () => {
  let now = 0;
  let seq = 0;
  const jobs = new Map<number, { readonly at: number; readonly fn: () => void }>();
  return {
    now: () => now,
    set: (fn: () => void, ms: number) => {
      seq += 1;
      jobs.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear: (handle: unknown) => {
      jobs.delete(handle as number);
    },
    advance: (ms: number) => {
      now += ms;
      for (const [id, job] of [...jobs.entries()]) {
        if (job.at <= now) {
          jobs.delete(id);
          job.fn();
        }
      }
    },
  };
};

const storeWithClock = () => {
  const clock = manualClock();
  return { clock, store: createToastStore(clock) };
};

describe('createToastStore', () => {
  it('U-50: state() returns the same reference until the stack changes', () => {
    const { store } = storeWithClock();
    // useSyncExternalStore compares snapshots by reference: a fresh array per read would loop
    // re-renders (React error #185). Reading alone must never look like a change.
    const empty = store.state();
    expect(store.state()).toBe(empty);
    store.toast({ type: 'info', text: 'one' });
    const one = store.state();
    expect(one).not.toBe(empty);
    expect(store.state()).toBe(one);
    store.toast({ type: 'info', text: 'two' });
    const two = store.state();
    expect(two).not.toBe(one);
    store.close(two[0].id);
    const oneAgain = store.state();
    expect(oneAgain).not.toBe(two);
    // A hold moves timing, not the stack — the snapshot stands.
    store.pause(oneAgain[0].id);
    expect(store.state()).toBe(oneAgain);
    store.resume(oneAgain[0].id);
    expect(store.state()).toBe(oneAgain);
    // Empty again is the standing empty reference, not a fresh array.
    store.close(oneAgain[0].id);
    const emptyAgain = store.state();
    expect(emptyAgain).toEqual([]);
    expect(store.state()).toBe(emptyAgain);
  });

  it('U-50: the one call shows a toast of the given type and text, newest on top', () => {
    const { store } = storeWithClock();
    store.toast({ type: 'success', text: 'Kurulum tamamlandı · 2 hesap hazır' });
    store.toast({ type: 'warn', text: 'Erişim anahtarı taşınmadı' });
    const items = store.state();
    expect(items).toHaveLength(2);
    // The stack reads newest first — the second call sits above the first.
    expect(items[0]).toMatchObject({ type: 'warn', text: 'Erişim anahtarı taşınmadı' });
    expect(items[1]).toMatchObject({ type: 'success', text: 'Kurulum tamamlandı · 2 hesap hazır' });
  });

  it('U-50: at most three toasts stay visible — the fourth drops the oldest outright', () => {
    const { store } = storeWithClock();
    expect(MAX_VISIBLE_TOASTS).toBe(3);
    for (let n = 1; n <= 4; n += 1) store.toast({ type: 'info', text: `toast-${n}` });
    const texts = store.state().map((item) => item.text);
    expect(texts).toEqual(['toast-4', 'toast-3', 'toast-2']);
    // The dropped oldest is gone for good: waiting past every duration leaves the three that
    // were scheduled, and nothing fires for a toast that no longer exists.
    const clock = storeWithClock();
    for (let n = 1; n <= 5; n += 1) clock.store.toast({ type: 'info', text: `t${n}` });
    expect(clock.store.state()).toHaveLength(3);
  });

  it('U-50: a toast dismisses itself after 5 s; warn and error after 8 s', () => {
    const { clock, store } = storeWithClock();
    expect(TOAST_MS.success).toBe(5000);
    expect(TOAST_MS.info).toBe(5000);
    expect(TOAST_MS.warn).toBe(8000);
    expect(TOAST_MS.error).toBe(8000);
    store.toast({ type: 'success', text: 'ok' });
    store.toast({ type: 'warn', text: 'warn' });
    store.toast({ type: 'error', text: 'error' });
    clock.advance(4999);
    expect(store.state()).toHaveLength(3);
    clock.advance(1);
    expect(store.state().map((item) => item.text)).toEqual(['error', 'warn']);
    clock.advance(2999);
    expect(store.state()).toHaveLength(2);
    clock.advance(1);
    expect(store.state()).toEqual([]);
  });

  it('U-50: a toast pauses while hovered or focused and resumes where it stood', () => {
    const { clock, store } = storeWithClock();
    store.toast({ type: 'error', text: 'Kaydedilemedi' });
    const id = store.state()[0].id;
    clock.advance(3000);
    // The hover (or the close button's focus) holds the toast open for as long as it stands.
    store.pause(id);
    clock.advance(600000);
    expect(store.state()).toHaveLength(1);
    // Leaving (or blurring) resumes from where the pause caught it, not from the start.
    store.resume(id);
    clock.advance(4999);
    expect(store.state()).toHaveLength(1);
    clock.advance(1);
    expect(store.state()).toEqual([]);
    // Repeated pauses keep their arithmetic: 3 s stood, 2 s stood, then a second hold.
    store.toast({ type: 'success', text: 'again' });
    const second = store.state()[0].id;
    clock.advance(3000);
    store.pause(second);
    clock.advance(1000);
    store.resume(second);
    clock.advance(1999);
    expect(store.state()).toHaveLength(1);
    store.pause(second);
    clock.advance(5000);
    store.resume(second);
    clock.advance(1);
    expect(store.state()).toEqual([]);
  });

  it('U-50: the close control removes the toast and stops its timer', () => {
    const { clock, store } = storeWithClock();
    store.toast({ type: 'success', text: 'ok' });
    const id = store.state()[0].id;
    store.close(id);
    expect(store.state()).toEqual([]);
    // Nothing fires later for a closed toast, and unknown ids change nothing.
    clock.advance(60000);
    store.close(id);
    store.pause(id);
    store.resume(id);
    expect(store.state()).toEqual([]);
  });

  it('U-50a: the one call carries the optional copy text on the toast', () => {
    const { store } = storeWithClock();
    store.toast({ type: 'error', text: 'İş emri güncellenemedi', copy: 'stale' });
    expect(store.state()[0].copy).toBe('stale');
    store.toast({ type: 'success', text: 'Kaydedildi' });
    expect(store.state()[0].copy).toBeUndefined();
  });

  it("U-50a: an ok:false result toasts as error, the code's label as its text and the code as copy", () => {
    const outcome = {
      result: { ok: false as const, code: 'stale' },
      labelKey: 'error.stale' as const,
    };
    toastOutcome('tr', outcome);
    const item = toastStore.state()[0];
    expect(item.type).toBe('error');
    expect(item.text).toBe(t('tr', outcome.labelKey));
    expect(item.copy).toBe('stale');
    // A success carries no copy — there is no code to hand over.
    const ok = {
      result: { ok: true as const },
      labelKey: 'success.account.save' as const,
    };
    toastOutcome('tr', ok);
    expect(toastStore.state()[0]).toMatchObject({ type: 'success', copy: undefined });
  });

  it('U-50a: an unknown code shows the generic failure text with the raw code only behind the button', () => {
    // The stores map an unknown code to the generic key exactly this way (results.ts); the raw
    // code must ride as `copy` alone — never in the text the toast shows.
    const outcome = {
      result: { ok: false as const, code: 'totally_new_refusal' },
      labelKey: failureKey('totally_new_refusal'),
    };
    toastOutcome('tr', outcome);
    const item = toastStore.state()[0];
    expect(item.text).toBe(t('tr', GENERIC_FAILURE_KEY));
    expect(item.text).not.toContain('totally_new_refusal');
    expect(item.copy).toBe('totally_new_refusal');
  });
});
