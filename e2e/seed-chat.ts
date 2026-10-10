// seed-chat.ts — the Docket AI chat world (J-15): it runs on top of the page-view world
// (e2e/seed-page-view.ts: one project, one single-repo throw-away repository, one open work order and
// the hostile page with two versions) and adds what the chat journey reads — an older global
// conversation for the history, and one project conversation whose assistant message carries every
// card kind: the page, a table, a draft and a proposal with its pending action. Run with
// `npx tsx e2e/seed-chat.ts <home> <pageId>`; it prints a `SEED={json}` line with the ids.
//
// Hermetic like the other worlds: no account, no secret, no agent run and no model — the cards are
// written through the app's own use-cases, and the assistant actor that proposes the action never
// applies anything (the applier below throws if it is ever called; the operator's Onayla in the
// journey is what applies it, through the app's own applier). The seed clock follows the wall clock
// (the app's own clock is the wall clock, so undo windows and grants measured by the journey are
// live), and the older conversation is written a day and a half in the past so the history shows
// two groups.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import assert from 'node:assert';

import type { Actor, PageId, ProjectSlug, RepoSlug, RoleSlug } from '../src/domain/index';
import { appendAssistantMessage, createDraft, startConversationUseCase } from '../src/application/use-cases/conversations';
import { proposeAction } from '../src/application/use-cases/actions';
import { createProposal } from '../src/application/use-cases/proposals';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

const OPERATOR: Actor = { kind: 'user', id: 'user-1' };

const [home, pageId] = process.argv.slice(2);
assert(home !== undefined && pageId !== undefined, 'usage: seed-chat.ts <home> <pageId>');

const dataDir = join(home, 'docket-data');
mkdirSync(dataDir, { recursive: true });

const PROJECT = 'sayfa-atolyesi' as ProjectSlug;
const REPO = 'sayfa-api' as RepoSlug;
const TARGET = 'flows/tek-asama.yaml';
const HOUR = 3_600_000;

// The seed's clock is a variable: the older conversation is written first, in the past.
let nowMs = Date.now();
const node = createNodeDeps({
  dataDir,
  cipher: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (blob: Uint8Array) => Buffer.from(blob).toString('utf8'),
  },
  transports: { forAccount: async () => undefined },
  notifier: { notify: () => undefined },
  commandEnv: {},
  clock: { now: () => nowMs },
  random: (length: number) => crypto.getRandomValues(new Uint8Array(length)),
});
if (!node.ok) throw new Error(`chat seed could not open deps: ${JSON.stringify(node.error)}`);
const deps = node.value.deps;

// --- the older conversation (history: Dün / Bu hafta, found by the ASCII search "butce") ----------------
nowMs = Date.now() - 30 * HOUR;
const OLDER_TITLE = 'Bütçe sınırı ne kadar?';
const older = await startConversationUseCase(deps, { scope: { kind: 'global' }, firstMessage: { text: OLDER_TITLE }, by: OPERATOR });
assert(older.ok, `the older conversation did not start: ${older.ok ? '' : older.error.code}`);
const olderReplied = await appendAssistantMessage(deps, { conversation: older.value.id, message: { text: 'Aylık sınır tanımlı değil.' } });
assert(olderReplied.ok, 'the older reply did not append');

// --- the project conversation with every card ---------------------------------------------------------------
nowMs = Date.now();
const FIRST_TITLE = 'Giriş ekranı taslağını ve hesap durumunu göster';
const started = await startConversationUseCase(deps, {
  scope: { kind: 'project', project: PROJECT },
  firstMessage: { text: FIRST_TITLE },
  by: OPERATOR,
});
assert(started.ok, `the conversation did not start: ${started.ok ? '' : started.error.code}`);
const conversation = started.value.id;

const DRAFT_TITLE = 'Parola sıfırlama e-postaları';
const draft = await createDraft(deps, { conversation, project: PROJECT, repo: REPO, title: DRAFT_TITLE });
assert(draft.ok, `the draft did not save: ${draft.ok ? '' : draft.error.code}`);

// The proposal changes only the flow's display name, so the new content is still a valid flow.
const scope = { kind: 'repo', repo: REPO } as const;
const current = await deps.definitions.readFile(scope, TARGET);
assert(current !== undefined, `the seed repository has no ${TARGET}`);
assert(current.content.includes('Tek aşamalı akış'), 'the seed flow no longer carries the name the proposal changes');
const AGENT: Actor = { kind: 'agent', runId: deps.ids.next<'run'>(), role: 'gelistirici' as RoleSlug };
const PROPOSAL_SUMMARY = 'Akışın görünen adını güncelle';
const proposal = await createProposal(deps, {
  scope,
  target: TARGET,
  after: current.content.replace('Tek aşamalı akış', 'Tek aşamalı akış (gözden geçirildi)'),
  summary: PROPOSAL_SUMMARY,
  author: AGENT,
});
assert(proposal.ok, `the proposal did not save: ${proposal.ok ? '' : proposal.error}`);

// No grant exists, so the action waits for the operator: the applier below is never reached.
const proposed = await proposeAction(
  deps,
  { conversation, action: { kind: 'definition_edit', scope, target: TARGET, proposal: proposal.value }, by: AGENT },
  async () => {
    throw new Error('the seed never applies an action');
  },
);
assert(proposed.ok && proposed.value.decision.kind === 'needs_approval', 'the action did not wait for approval');

const replied = await appendAssistantMessage(deps, {
  conversation,
  message: {
    text: 'Taslak onay bekliyor. Hesapların durumu aşağıda; akış için bir değişiklik de hazırladım.',
    artifacts: [
      { kind: 'page', page: pageId as PageId, version: 2 },
      { kind: 'table', columns: ['Hesap', '5 sa', 'Hafta'], rows: [['Hesap A', '62%', '41%'], ['Hesap B', '', '9%']] },
      { kind: 'draft', draft: draft.value.id },
      { kind: 'proposal', proposal: proposal.value },
    ],
    sources: [TARGET],
  },
});
assert(replied.ok, `the assistant message did not append: ${replied.ok ? '' : replied.error.code}`);

node.value.close();
console.log(
  `SEED=${JSON.stringify({ conversation, firstTitle: FIRST_TITLE, olderTitle: OLDER_TITLE, draftTitle: DRAFT_TITLE, proposalSummary: PROPOSAL_SUMMARY, target: TARGET })}`,
);
