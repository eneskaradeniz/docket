// wizard.test.ts — U-7: the first-run wizard store walks source → account → binding → done,
// gates `next` on each step's validation (source reachable / chosen provider discovered and
// logged in / at least one bound role), preserves entered state across `back`, and dismisses on
// finishing — reappearing on open only while no workspace exists. The api, the source probe and
// the workspace observation are injected fakes; both observations sit below today's api surface
// and land with the screens wiring (the work-order detail store's injected-definitions stance).
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { createWizardStore } from './wizard';

const userActor: Actor = { kind: 'user', id: 'user-1' };

/** The projection the store reads off the `providers.discovered` reply (api/queries fixtures). */
const discovered = (
  defId: string,
  binPath: string | null,
  loggedIn: boolean | null,
): { defId: string; binPath: string | null; loggedIn: boolean | null } => ({ defId, binPath, loggedIn });

const alphaReady = discovered('alpha', '/usr/local/bin/alpha', true);

interface RecordedCommand {
  readonly actor: Actor;
  readonly command: Command;
}

type WizardCommandType = 'account.save' | 'binding.save';

interface FakeWizardApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: RecordedCommand[];
  setDiscoveryReply(reply: unknown): void;
  setCommandResult(type: WizardCommandType, result: CommandResult): void;
}

/** Query calls and issued commands are recorded; the discovery reply and per-command results are
 *  swappable mid-test. */
const fakeWizardApi = (discoveryReply: unknown = []): FakeWizardApi => {
  const queries: Query[] = [];
  const commands: RecordedCommand[] = [];
  const results: Record<WizardCommandType, CommandResult> = {
    'account.save': { ok: true, id: 'acc-1' },
    'binding.save': { ok: true },
  };
  let reply: unknown = discoveryReply;
  return {
    queries,
    commands,
    setDiscoveryReply: (next) => {
      reply = next;
    },
    setCommandResult: (type, result) => {
      results[type] = result;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
    command: (actor, command) => {
      commands.push({ actor, command });
      return Promise.resolve(results[command.type as WizardCommandType]);
    },
  };
};

interface FakeProbes {
  readonly probed: readonly string[];
  readonly workspaceChecks: number[];
  readonly sourceReachable: (source: string) => Promise<boolean>;
  readonly workspaceExists: () => Promise<boolean>;
  setSourceOk(ok: boolean): void;
  setWorkspaceExists(exists: boolean): void;
}

/** Both below-api observations are scripted and counted so tests can assert they were consulted. */
const fakeProbes = (sourceOk: boolean, workspaceExists: boolean): FakeProbes => {
  const probed: string[] = [];
  const workspaceChecks: number[] = [];
  let reachable = sourceOk;
  let exists = workspaceExists;
  return {
    probed,
    workspaceChecks,
    setSourceOk: (ok) => {
      reachable = ok;
    },
    setWorkspaceExists: (next) => {
      exists = next;
    },
    sourceReachable: (source: string) => {
      probed.push(source);
      return Promise.resolve(reachable);
    },
    workspaceExists: () => {
      workspaceChecks.push(workspaceChecks.length);
      return Promise.resolve(exists);
    },
  };
};

interface Setup {
  readonly api: FakeWizardApi;
  readonly probes: FakeProbes;
  readonly store: ReturnType<typeof createWizardStore>;
}

const setup = (discoveryReply: unknown = [alphaReady]): Setup => {
  const api = fakeWizardApi(discoveryReply);
  const probes = fakeProbes(true, false);
  const store = createWizardStore({
    api,
    actor: userActor,
    sourceReachable: probes.sourceReachable,
    workspaceExists: probes.workspaceExists,
  });
  return { api, probes, store };
};

/** Walks to the account step with a reachable source; discovery is kicked by the transition. */
const toAccount = async (bundle: Setup): Promise<void> => {
  await bundle.store.open();
  bundle.store.enterSource('/repos/atolye');
  await bundle.store.next();
};

/** Walks to the binding step with a saved account (acc-1) and a chosen, ready provider. */
const toBinding = async (bundle: Setup): Promise<void> => {
  await toAccount(bundle);
  bundle.store.chooseProvider('alpha');
  bundle.store.enterAccount({ label: 'Ana hesap', authMode: 'subscription', plan: 'pro' });
  await bundle.store.next();
};

describe('wizard store', () => {
  it('U-7: open with no workspace runs the wizard; the machine walks source → account → binding → done as each step validates', async () => {
    const bundle = setup();
    expect(bundle.store.state()).toMatchObject({ visible: false, step: 'source' });

    await bundle.store.open();
    expect(bundle.probes.workspaceChecks.length).toBe(1);
    expect(bundle.store.state()).toMatchObject({ visible: true, step: 'source' });

    bundle.store.enterSource('/repos/atolye');
    await bundle.store.checkSource();
    expect(bundle.store.nextEnabled()).toBe(true);

    await bundle.store.next();
    // Entering the account step kicks a discovery pass, so the step can validate the choice.
    expect(bundle.store.state()).toMatchObject({ step: 'account' });
    expect(bundle.api.queries).toEqual([{ type: 'providers.discovered' }]);
    expect(bundle.store.state().discovered).toEqual([alphaReady]);
    expect(bundle.store.nextEnabled()).toBe(false); // nothing chosen yet

    bundle.store.chooseProvider('alpha');
    bundle.store.enterAccount({ label: 'Ana hesap', authMode: 'subscription', plan: 'pro' });
    expect(bundle.store.nextEnabled()).toBe(true);
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'binding', accountId: 'acc-1' });

    const bound = await bundle.store.bind('coder');
    expect(bound).toEqual({
      command: 'binding.save',
      result: { ok: true },
      labelKey: 'success.binding.save',
    });
    expect(bundle.store.nextEnabled()).toBe(true);

    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'done', visible: false });

    expect(bundle.api.commands).toEqual([
      {
        actor: userActor,
        command: { type: 'account.save', provider: 'alpha', label: 'Ana hesap', authMode: 'subscription', plan: 'pro' },
      },
      { actor: userActor, command: { type: 'binding.save', role: 'coder', accounts: [{ accountId: 'acc-1' }] } },
    ]);
  });

  it('U-7: next on the source step is gated by the reachability probe', async () => {
    const bundle = setup();
    await bundle.store.open();

    // An unreachable source keeps the machine on the source step.
    bundle.probes.setSourceOk(false);
    bundle.store.enterSource('/repos/kayip');
    await bundle.store.checkSource();
    expect(bundle.store.nextEnabled()).toBe(false);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('source');

    // Reachable — the gate opens.
    bundle.probes.setSourceOk(true);
    await bundle.store.checkSource();
    expect(bundle.store.nextEnabled()).toBe(true);

    // Editing the text after the probe leaves the verdict stale; next re-probes and, now reachable,
    // still advances (the click is the authority, the cached verdict only a hint).
    bundle.store.enterSource('/repos/baska');
    expect(bundle.store.nextEnabled()).toBe(false);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');
    // Every gate decision probed the text it judged: the failed next, the check, and the passing
    // next each consulted the source.
    expect(bundle.probes.probed).toEqual(['/repos/kayip', '/repos/kayip', '/repos/kayip', '/repos/baska']);

    // A blank source never probes and never advances.
    const fresh = setup();
    await fresh.store.open();
    fresh.store.enterSource('   ');
    await fresh.store.next();
    expect(fresh.store.state().step).toBe('source');
    expect(fresh.probes.probed).toEqual([]);
  });

  it('U-7: next on the account step requires the chosen provider discovered and logged in', async () => {
    const bundle = setup([]);
    await toAccount(bundle);

    // No provider chosen — nothing is issued.
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');
    expect(bundle.api.commands.length).toBe(0);

    // Chosen but not installed on this machine.
    bundle.store.chooseProvider('beta');
    bundle.api.setDiscoveryReply([discovered('beta', null, null), alphaReady]);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');
    expect(bundle.api.commands.length).toBe(0);

    // Installed but not logged in.
    bundle.api.setDiscoveryReply([discovered('beta', '/usr/local/bin/beta', false)]);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');

    // Logged-in state unknown (null) proves nothing either.
    bundle.api.setDiscoveryReply([discovered('beta', '/usr/local/bin/beta', null)]);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');

    // Chosen provider missing from the pass entirely.
    bundle.api.setDiscoveryReply([alphaReady]);
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');
    expect(bundle.api.commands.length).toBe(0);

    // A failed discovery pass fails the gate closed: nothing is proven discovered.
    bundle.api.setDiscoveryReply({ ok: false, code: 'not_found' });
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');
    expect(bundle.api.commands.length).toBe(0);

    // Discovered and logged in — the account is saved and the machine advances.
    bundle.store.chooseProvider('alpha');
    bundle.api.setDiscoveryReply([alphaReady]);
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'binding', accountId: 'acc-1' });
    expect(bundle.api.commands.length).toBe(1);
  });

  it('U-7: a failed account.save keeps the wizard on the account step and maps the code through U-8', async () => {
    const bundle = setup();
    bundle.api.setCommandResult('account.save', { ok: false, code: 'invalid_id' });
    await toAccount(bundle);

    bundle.store.chooseProvider('alpha');
    bundle.store.enterAccount({ label: 'Ana hesap', authMode: 'bilinmeyen' });
    await bundle.store.next();

    expect(bundle.store.state().step).toBe('account');
    expect(bundle.store.state().accountId).toBeNull();
    expect(bundle.store.state().lastOutcome).toEqual({
      command: 'account.save',
      result: { ok: false, code: 'invalid_id' },
      labelKey: 'error.invalid_id',
    });
  });

  it('U-7: next on the binding step requires at least one bound role', async () => {
    const bundle = setup();
    await toBinding(bundle);

    // No binding saved yet — the machine stays on the binding step.
    expect(bundle.store.nextEnabled()).toBe(false);
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'binding', visible: true });

    await bundle.store.bind('coder');
    expect(bundle.store.nextEnabled()).toBe(true);
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'done', visible: false });
  });

  it('U-7: a failed binding.save surfaces the code through U-8 and the role stays unbound', async () => {
    const bundle = setup();
    bundle.api.setCommandResult('binding.save', { ok: false, code: 'invalid_id' });
    await toBinding(bundle);

    const outcome = await bundle.store.bind('');

    expect(outcome).toEqual({
      command: 'binding.save',
      result: { ok: false, code: 'invalid_id' },
      labelKey: 'error.invalid_id',
    });
    expect(bundle.store.state().boundRoles).toEqual([]);
    expect(bundle.store.nextEnabled()).toBe(false);
    // The empty role reached the api verbatim: the boundary owns slug parsing, the store does not.
    // (commands[0] is the account.save of the walk to the binding step.)
    expect(bundle.api.commands[1]).toEqual({
      actor: userActor,
      command: { type: 'binding.save', role: '', accounts: [{ accountId: 'acc-1' }] },
    });
  });

  it('U-7: bind without a saved account refuses locally and issues no command', async () => {
    const bundle = setup();
    // A success without an id leaves the wizard with no account to bind.
    bundle.api.setCommandResult('account.save', { ok: true });
    await toAccount(bundle);

    bundle.store.chooseProvider('alpha');
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'binding', accountId: null });

    const outcome = await bundle.store.bind('coder');
    expect(outcome).toEqual({
      command: 'binding.save',
      result: { ok: false, code: 'not_found' },
      labelKey: 'error.not_found',
    });
    expect(bundle.api.commands.length).toBe(1); // only the account.save
    expect(bundle.store.state().boundRoles).toEqual([]);
  });

  it('U-7: back preserves entered state across the whole chain', async () => {
    const bundle = setup();
    await toBinding(bundle);
    await bundle.store.bind('coder');

    // Binding → account: the choice, the draft and the saved account all survive.
    bundle.store.back();
    expect(bundle.store.state()).toMatchObject({
      step: 'account',
      provider: 'alpha',
      accountId: 'acc-1',
    });
    expect(bundle.store.state().draft).toEqual({ label: 'Ana hesap', authMode: 'subscription', plan: 'pro' });

    // Account → source: the entered source survives; behind the first step back is a no-op.
    bundle.store.back();
    expect(bundle.store.state()).toMatchObject({ step: 'source', source: '/repos/atolye' });
    bundle.store.back();
    expect(bundle.store.state().step).toBe('source');

    // Walking forward again re-validates every gate and re-saves the same account (now with its
    // id), instead of stacking a duplicate account per crossing.
    await bundle.store.next();
    expect(bundle.store.state().step).toBe('account');
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'binding', accountId: 'acc-1' });
    expect(bundle.store.state().boundRoles).toEqual(['coder']);
    expect(bundle.api.commands[2]).toEqual({
      actor: userActor,
      command: { type: 'account.save', id: 'acc-1', provider: 'alpha', label: 'Ana hesap', authMode: 'subscription', plan: 'pro' },
    });
  });

  it('U-7: finishing dismisses the wizard; it does not reappear while a workspace exists (re-check on open)', async () => {
    const bundle = setup();
    await toBinding(bundle);
    await bundle.store.bind('coder');
    await bundle.store.next();
    expect(bundle.store.state()).toMatchObject({ step: 'done', visible: false });

    // The re-check on open consults the observation again — a workspace means no re-run.
    bundle.probes.setWorkspaceExists(true);
    await bundle.store.open();
    expect(bundle.probes.workspaceChecks.length).toBe(2);
    expect(bundle.store.state()).toMatchObject({ step: 'done', visible: false });

    // A dismissed wizard has no intents: next and back change nothing.
    await bundle.store.next();
    bundle.store.back();
    expect(bundle.store.state()).toMatchObject({ step: 'done', visible: false });
    expect(bundle.api.commands.length).toBe(2);
  });

  it('U-7: re-open without a workspace runs the wizard again from the source step', async () => {
    const bundle = setup();
    await toBinding(bundle);
    await bundle.store.bind('coder');
    await bundle.store.next();
    expect(bundle.store.state().visible).toBe(false);

    await bundle.store.open();
    expect(bundle.store.state()).toMatchObject({ visible: true, step: 'source' });
    // The machine restarts; entered values remain valid inputs and saved bindings remain saved.
    expect(bundle.store.state().source).toBe('/repos/atolye');
    expect(bundle.store.state().boundRoles).toEqual(['coder']);
  });
});
