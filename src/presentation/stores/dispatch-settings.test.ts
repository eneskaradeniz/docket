// dispatch-settings.test.ts — U-70 … U-74: the Eşzamanlılık section's store. Mode switch, the
// validation that mirrors the backend's limits rule, the machine suggestion, the live status
// card with its polling rule, and save / reset / the confirmation. Read and write are fakes.
import { describe, expect, it } from 'vitest';

import type { CommandResult } from '../../api/commands';
import {
  DEFAULT_DISPATCH_FORM,
  DISPATCH_POLL_MS,
  createDispatchSettingsStore,
  dispatchErrors,
  statusCard,
  type DispatchWrite,
} from './dispatch-settings';

interface Reply {
  global: number;
  perRepo: number;
  perAccount: Record<string, number>;
  mode: 'fixed' | 'auto';
  suggested?: number;
  machine?: { cores: number; totalMemGb: number };
  status?: { mode: 'fixed' | 'auto'; cap: number; effective: number; band: 'free' | 'reduced' | 'busy'; load1?: number };
}

const base = (extra: Partial<Reply> = {}): Reply => ({
  global: 4,
  perRepo: 3,
  perAccount: {},
  mode: 'auto',
  suggested: 6,
  machine: { cores: 10, totalMemGb: 16 },
  status: { mode: 'auto', cap: 4, effective: 4, band: 'free', load1: 0.3 },
  ...extra,
});

const harness = (first: Reply, writeResult: CommandResult = { ok: true }) => {
  let reply: unknown = first;
  const writes: DispatchWrite[] = [];
  const store = createDispatchSettingsStore({
    read: () => Promise.resolve(reply),
    write: (input) => {
      writes.push(input);
      if (writeResult.ok) {
        reply = { ...(reply as Reply), global: input.global, perRepo: input.perRepo, perAccount: input.perAccount, mode: input.mode };
      }
      return Promise.resolve(writeResult);
    },
  });
  return { store, writes, serve: (next: unknown) => (reply = next) };
};

describe('U-70: mode', () => {
  it('U-70: the form mirrors the reply, and the mode switch changes only the mode until Kaydet', async () => {
    const { store, writes } = harness(base({ mode: 'fixed' }));
    await store.load();
    expect(store.state().form).toStrictEqual({ mode: 'fixed', global: 4, perRepo: 3, perAccount: {} });
    store.setMode('auto');
    expect(store.state().form).toStrictEqual({ mode: 'auto', global: 4, perRepo: 3, perAccount: {} });
    expect(store.state().saved?.mode).toBe('fixed');
    expect(writes).toHaveLength(0);
  });

  it('U-70: a reply without a readable mode is Otomatik, the backend default', async () => {
    const { store, serve } = harness(base());
    serve({ global: 4, perRepo: 3, perAccount: {} });
    await store.load();
    expect(store.state().form.mode).toBe('auto');
  });

  it('U-70: a failed read leaves the form as it was and reports the code', async () => {
    const { store, serve } = harness(base());
    await store.load();
    serve({ ok: false, code: 'definitions_invalid' });
    await store.load();
    expect(store.state().problem).toBe('definitions_invalid');
    expect(store.state().form.global).toBe(4);
  });
});

describe('U-71: validation parity with the backend', () => {
  const form = (global: number, perRepo: number, perAccount: Record<string, number> = {}) => ({ mode: 'auto' as const, global, perRepo, perAccount });

  it('U-71: the cap is a whole number from 1 to 16', () => {
    expect(dispatchErrors(form(0, 1), null).first).toBe('dispatch.error.global');
    expect(dispatchErrors(form(17, 3), null).first).toBe('dispatch.error.global');
    expect(dispatchErrors(form(2.5, 1), null).first).toBe('dispatch.error.global');
    expect(dispatchErrors(form(1, 1), null).first).toBeNull();
    expect(dispatchErrors(form(16, 3), null).first).toBeNull();
  });

  it('U-71: per-repo and every per-account limit run from 1 up to the cap', () => {
    expect(dispatchErrors(form(2, 5), null).first).toBe('dispatch.error.perRepo');
    expect(dispatchErrors(form(2, 2), null).first).toBeNull();
    expect(dispatchErrors(form(4, 3, { a: 5 }), null).accounts).toStrictEqual({ a: 'dispatch.error.account' });
    expect(dispatchErrors(form(4, 3, { a: 4 }), null).first).toBeNull();
    expect(dispatchErrors(form(4, 0), null).first).toBe('dispatch.error.min');
    expect(dispatchErrors(form(4, 3, { a: 0 }), null).first).toBe('dispatch.error.min');
  });

  it('U-71: the first message follows the order cap, per-repo, accounts; a stale account is not judged', () => {
    expect(dispatchErrors(form(2, 5, { a: 9 }), null).first).toBe('dispatch.error.perRepo');
    expect(dispatchErrors(form(20, 5, { a: 9 }), null).first).toBe('dispatch.error.global');
    expect(dispatchErrors(form(4, 3, { gone: 9 }), ['a']).first).toBeNull();
  });

  it('U-71: an invalid form sends nothing on Kaydet', async () => {
    const { store, writes } = harness(base({ global: 2, perRepo: 5 }));
    await store.load();
    await store.save(null);
    expect(writes).toHaveLength(0);
  });

  it('U-71: the steppers stay inside 1..16 and the per-repo and account steppers inside 1..cap', async () => {
    const { store } = harness(base());
    await store.load();
    store.setGlobal(99);
    expect(store.state().form.global).toBe(16);
    store.setGlobal(-3);
    expect(store.state().form.global).toBe(1);
    store.setGlobal(4);
    store.setPerRepo(40);
    expect(store.state().form.perRepo).toBe(4);
    store.setAccountLimit('a', 40);
    expect(store.state().form.perAccount).toStrictEqual({ a: 4 });
  });
});

describe('U-72: the machine suggestion', () => {
  it('U-72: machine and suggestion come from the reply; both absent means no row', async () => {
    const { store, serve } = harness(base());
    await store.load();
    expect(store.state().suggestion).toStrictEqual({ suggested: 6, cores: 10, totalMemGb: 16 });
    serve({ ...base(), suggested: undefined, machine: undefined });
    await store.load();
    expect(store.state().suggestion).toBeNull();
  });

  it('U-72: Öneriyi uygula sets the cap and pulls per-repo down to it, unsaved', async () => {
    const { store, writes } = harness(base({ suggested: 2 }));
    await store.load();
    store.applySuggestion();
    expect(store.state().form.global).toBe(2);
    expect(store.state().form.perRepo).toBe(2);
    expect(writes).toHaveLength(0);
  });

  it('U-72: with the cap already on the suggestion, applying it changes nothing', async () => {
    const { store } = harness(base({ suggested: 4 }));
    await store.load();
    expect(store.state().suggestion?.suggested).toBe(store.state().form.global);
    store.applySuggestion();
    expect(store.state().form.global).toBe(4);
    expect(store.state().dirty).toBe(false);
  });
});

describe('U-73: live status and polling', () => {
  it('U-73: the card reads effective and cap, the band and the load', async () => {
    const { store } = harness(base({ status: { mode: 'auto', cap: 4, effective: 2, band: 'reduced', load1: 0.8 } }));
    await store.load();
    expect(statusCard(store.state())).toStrictEqual({ effective: 2, cap: 4, band: 'reduced', load1: 0.8 });
  });

  it('U-73: there is no card in Sabit, without a status, with unsaved edits, or on a status of the other mode', async () => {
    const fixed = harness(base({ mode: 'fixed' }));
    await fixed.store.load();
    expect(statusCard(fixed.store.state())).toBeNull();

    const none = harness(base({ status: undefined }));
    await none.store.load();
    expect(statusCard(none.store.state())).toBeNull();

    const stale = harness(base({ status: { mode: 'fixed', cap: 4, effective: 4, band: 'free' } }));
    await stale.store.load();
    expect(statusCard(stale.store.state())).toBeNull();

    const dirty = harness(base());
    await dirty.store.load();
    expect(statusCard(dirty.store.state())).not.toBeNull();
    dirty.store.setGlobal(5);
    expect(statusCard(dirty.store.state())).toBeNull();
  });

  it('U-73: a status without a load reading carries no load', async () => {
    const { store } = harness(base({ status: { mode: 'auto', cap: 4, effective: 4, band: 'free' } }));
    await store.load();
    expect(statusCard(store.state())?.load1).toBeUndefined();
  });

  it('U-73: the poll re-reads every five seconds but never while the form has unsaved edits', async () => {
    expect(DISPATCH_POLL_MS).toBe(5000);
    const { store, serve } = harness(base());
    await store.load();
    serve(base({ status: { mode: 'auto', cap: 4, effective: 2, band: 'reduced', load1: 0.9 } }));
    await store.refresh();
    expect(statusCard(store.state())?.band).toBe('reduced');

    store.setPerRepo(1);
    serve(base({ status: { mode: 'auto', cap: 4, effective: 1, band: 'busy', load1: 1.4 } }));
    await store.refresh();
    expect(store.state().form.perRepo).toBe(1);
    expect(store.state().status?.band).toBe('reduced');
  });

  it('U-73: a failed poll keeps the card and the form as they were', async () => {
    const { store, serve } = harness(base());
    await store.load();
    serve({ ok: false, code: 'definitions_invalid' });
    await store.refresh();
    expect(store.state().form.global).toBe(4);
    expect(statusCard(store.state())).not.toBeNull();
  });
});

describe('U-74: save, reset and the confirmation', () => {
  it('U-74: Kaydet is disabled until something changed; the payload carries the mode and the limits', async () => {
    const { store, writes } = harness(base());
    await store.load();
    expect(store.state().dirty).toBe(false);
    store.setGlobal(6);
    store.setPerRepo(2);
    store.setAccountLimit('a1', 1);
    expect(store.state().dirty).toBe(true);
    await store.save(['a1', 'a2']);
    expect(writes).toStrictEqual([{ global: 6, perRepo: 2, perAccount: { a1: 1 }, mode: 'auto' }]);
  });

  it('U-74: a stale account entry is dropped from the payload, never sent to be refused', async () => {
    const { store, writes } = harness(base({ perAccount: { gone: 2, a1: 1 } }));
    await store.load();
    store.setGlobal(5);
    await store.save(['a1']);
    expect(writes[0]?.perAccount).toStrictEqual({ a1: 1 });
  });

  it('U-74: the confirmation shows after a successful save and goes with the next edit', async () => {
    const { store } = harness(base());
    await store.load();
    expect(store.state().justSaved).toBe(false);
    store.setGlobal(6);
    await store.save(null);
    expect(store.state().justSaved).toBe(true);
    expect(store.state().dirty).toBe(false);
    expect(store.state().saved?.global).toBe(6);
    store.setGlobal(7);
    expect(store.state().justSaved).toBe(false);
  });

  it('U-74: a refused save says so, claims no confirmation and keeps the edits', async () => {
    const { store } = harness(base(), { ok: false, code: 'unknown_account' });
    await store.load();
    store.setGlobal(6);
    await store.save(null);
    expect(store.state().justSaved).toBe(false);
    expect(store.state().failure).toBe('unknown_account');
    expect(store.state().form.global).toBe(6);
    expect(store.state().dirty).toBe(true);
    store.setGlobal(7);
    expect(store.state().failure).toBeNull();
  });

  it('U-74: Varsayılana dön puts Otomatik, 4, 3 and no account limit in the form, unsaved', async () => {
    const { store, writes } = harness(base({ mode: 'fixed', global: 8, perRepo: 5, perAccount: { a1: 2 } }));
    await store.load();
    expect(store.state().isDefault).toBe(false);
    store.reset();
    expect(store.state().form).toStrictEqual(DEFAULT_DISPATCH_FORM);
    expect(DEFAULT_DISPATCH_FORM).toStrictEqual({ mode: 'auto', global: 4, perRepo: 3, perAccount: {} });
    expect(store.state().isDefault).toBe(true);
    expect(store.state().dirty).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it('U-74: an account row switched to Sınırlı starts at 2 (or the cap), back to Sınırsız drops it', async () => {
    const { store } = harness(base({ global: 4 }));
    await store.load();
    store.setAccountLimited('a1', true);
    expect(store.state().form.perAccount).toStrictEqual({ a1: 2 });
    store.setAccountLimited('a1', false);
    expect(store.state().form.perAccount).toStrictEqual({});
    store.setGlobal(1);
    store.setAccountLimited('a1', true);
    expect(store.state().form.perAccount).toStrictEqual({ a1: 1 });
  });
});
