// setup-contexts.test.ts — the setup registry (A-357 … A-359): the context a registration builds,
// the ask bookkeeping the operator surface reads, the answers' grant and denial records, and the
// draft an operator message persists.
import { describe, expect, it } from 'vitest';

import type { Actor, ConversationId } from '../../domain/index';
import { parseUlid } from '../../domain/index';

import { createFakeClock, createFakeIdGen, createFakeProposalRepo, createFakeDeps } from '../ports/fakes/index';
import type { SetupDraft, SetupDraftStore } from '../use-cases/setup';

import { createSetupTools } from './setup-tools';
import { createSetupContexts, type SetupConversations } from './setup-contexts';
import type { SetupPathReader } from './setup-tools';

const REPO = '/Users/op/work/acme';
const DATA = '/Users/op/.docket';
const OUTSIDE = '/Users/op/notes/plan.md';

const runParsed = parseUlid<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FA1');
if (!runParsed.ok) throw new Error('fixture run');
const AGENT: Actor = { kind: 'agent', runId: runParsed.value, role: 'assistant' as never };

const conversationOf = (n: number): ConversationId => {
  const parsed = parseUlid<'conversation'>(`01ARZ3NDEKTSV4RRFFQ69G5F${String(n).padStart(2, '0')}`);
  if (!parsed.ok) throw new Error('fixture conversation');
  return parsed.value;
};

const memoryReader = (files: Readonly<Record<string, string>> = {}): SetupPathReader => ({
  resolve: (path) => path,
  read: async (path) => (files[path] === undefined ? { kind: 'missing' } : { kind: 'file', content: files[path]! }),
});

interface DraftRecorder extends SetupDraftStore {
  readonly saved: readonly SetupDraft[];
}

const recordingDrafts = (existing: readonly SetupDraft[] = []): DraftRecorder => {
  const saved = [...existing];
  const byId = new Map(existing.map((draft) => [draft.id, draft]));
  return {
    saved,
    save: async (draft) => {
      saved.push(draft);
      byId.set(draft.id, draft);
    },
    load: async (id) => byId.get(id),
    newest: async () => [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt)[0],
  };
};

const registryOf = (drafts: SetupDraftStore): SetupConversations =>
  createSetupContexts({ clock: createFakeClock(1_000), ids: createFakeIdGen() }, { dataDir: DATA, drafts, reader: memoryReader() });

describe('the setup context registry', () => {
  it('A-357: register builds the read scope [repoPath, dataDir], fresh grants and a draft id, keyed by conversation', () => {
    const registry = registryOf(recordingDrafts());
    const conversation = conversationOf(1);
    const context = registry.register({ conversation, repoPath: REPO });
    expect(context.scope).toEqual({ paths: [REPO, DATA], sessionOnly: true });
    expect(context.readCtx).toEqual({ repoFolder: REPO, docketHome: DATA });
    expect(context.grants.list()).toEqual([]);
    expect(context.draftId).not.toBe('');
    expect(registry.contextOf(conversation)).toBe(context);
    expect(registry.contextOf(conversationOf(2))).toBeUndefined();
  });

  it('A-358: an ask records once with the reason line, pushes one event, and allow clears it into a session grant', async () => {
    const drafts = recordingDrafts();
    const registry = createSetupContexts(
      { clock: createFakeClock(1_000), ids: createFakeIdGen() },
      { dataDir: DATA, drafts, reader: memoryReader({ [OUTSIDE]: 'the migration plan' }) },
    );
    const conversation = conversationOf(1);
    const context = registry.register({ conversation, repoPath: REPO });
    const events: string[] = [];
    registry.subscribeAsk((asked) => events.push(asked));
    const tools = createSetupTools({ ...createFakeDeps(), proposals: createFakeProposalRepo(), clock: createFakeClock(1) }, context);

    const asked = await tools.call('docket_read_path', { path: OUTSIDE, reason: 'read the migration plan' }, AGENT);
    expect(asked.ok).toBe(true);
    expect(events).toEqual([conversation]);
    expect(registry.askOf(conversation)).toEqual({ path: OUTSIDE, reason: 'read the migration plan' });

    // A second ask of the same path replaces nothing while one pends (U-275: one prompt at a time).
    await tools.call('docket_read_path', { path: OUTSIDE, reason: 'again' }, AGENT);
    expect(events).toEqual([conversation, conversation]);

    expect(registry.answer(conversation, OUTSIDE, true)).toBe(true);
    expect(registry.askOf(conversation)).toBeUndefined();
    expect(context.grants.list()).toEqual([OUTSIDE]);
    // The agent's retry now passes decideRead through the recorded grant.
    const retry = await tools.call('docket_read_path', { path: OUTSIDE, reason: 'retry' }, AGENT);
    expect(retry.ok).toBe(true);
  });

  it('A-358: a denied path is remembered for the conversation and a retry is a typed refusal, never a second ask', async () => {
    const registry = registryOf(recordingDrafts());
    const conversation = conversationOf(1);
    const context = registry.register({ conversation, repoPath: REPO });
    const events: string[] = [];
    registry.subscribeAsk((asked) => events.push(asked));
    const tools = createSetupTools({ ...createFakeDeps(), proposals: createFakeProposalRepo(), clock: createFakeClock(1) }, context);

    await tools.call('docket_read_path', { path: OUTSIDE, reason: 'read the plan' }, AGENT);
    expect(events).toHaveLength(1);
    expect(registry.answer(conversation, OUTSIDE, false)).toBe(true);
    expect(registry.askOf(conversation)).toBeUndefined();

    const retry = await tools.call('docket_read_path', { path: OUTSIDE, reason: 'retry' }, AGENT);
    expect(retry).toMatchObject({ ok: false, code: 'forbidden' });
    expect(events).toHaveLength(1);
    // An unknown conversation answers false — the boundary maps it to not_found.
    expect(registry.answer(conversationOf(9), OUTSIDE, true)).toBe(false);
  });

  it('A-358: a secret-shaped read records no ask and counts the thread notice instead (U-277, A-336)', async () => {
    const registry = registryOf(recordingDrafts());
    const conversation = conversationOf(1);
    const context = registry.register({ conversation, repoPath: REPO });
    const events: string[] = [];
    registry.subscribeAsk((asked) => events.push(asked));
    const tools = createSetupTools({ ...createFakeDeps(), proposals: createFakeProposalRepo(), clock: createFakeClock(1) }, context);

    const refused = await tools.call('docket_read_path', { path: `${REPO}/.env`, reason: 'config' }, AGENT);
    expect(refused).toMatchObject({ ok: false, code: 'forbidden' });
    expect(events).toEqual([]);
    expect(registry.askOf(conversation)).toBeUndefined();
    expect(context.secrets).toBe(1);
  });

  it('A-359: an operator message persists the draft — the conversation id and repo path only, never content', async () => {
    const drafts = recordingDrafts();
    const registry = registryOf(drafts);
    const conversation = conversationOf(1);
    registry.register({ conversation, repoPath: REPO });

    registry.noteOperatorMessage(conversation);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drafts.saved).toHaveLength(1);
    expect(drafts.saved[0]).toMatchObject({ repoPath: REPO, mode: 'ai', answers: { conversation } });
    expect(JSON.stringify(drafts.saved[0])).not.toMatch(/sk-|BEGIN|content/);

    // The newest draft is what the resume card reads; a re-registered conversation keeps its id.
    const newest = await registry.newestDraft();
    expect(newest?.repoPath).toBe(REPO);
    const kept = registry.register({ conversation, repoPath: REPO, draftId: drafts.saved[0]?.id });
    expect(kept.draftId).toBe(drafts.saved[0]?.id);
  });
});
