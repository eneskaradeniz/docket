// chat read scope — rule A-205 (docs/v2/application.md): what a conversation may read, resolved from
// its scope and the references of ITS user messages, as a pure function.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Conversation,
  type ConversationRef,
  type ConversationScope,
  type EpochMs,
  type Message,
  type ProjectSlug,
  type RepoSlug,
  type Ulid,
} from '../../domain/index';

import { chatReadScope } from './chat-read-scope';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const PROJECT_A = slugOf<'project'>('alpha') as ProjectSlug;
const PROJECT_B = slugOf<'project'>('beta') as ProjectSlug;
const REPO_A = slugOf<'repo'>('alpha-app') as RepoSlug;
const WORK_ORDER_1 = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WORK_ORDER_2 = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const PAGE_1 = ulidOf<'page'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');

const message = (role: 'user' | 'assistant', refs: readonly ConversationRef[], n: number): Message => ({
  id: ulidOf<'message'>(`01ARZ3NDEKTSV4RRFFQ69G5FM${n}`),
  role,
  at: 1 as EpochMs,
  text: 'hi',
  refs,
  attachments: [],
  artifacts: [],
  sources: [],
});

const conversation = (scope: ConversationScope, messages: readonly Message[] = []): Conversation => ({
  id: ulidOf<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FC1'),
  scope,
  title: 't',
  createdAt: 1 as EpochMs,
  updatedAt: 1 as EpochMs,
  pinned: false,
  messages,
});

const EMPTY = { all: false, projects: new Set(), repos: new Set(), workOrders: new Set(), pages: new Set(), files: [] };

describe('chatReadScope', () => {
  it('A-205: a global conversation reads everything the operator owns', () => {
    expect(chatReadScope(conversation({ kind: 'global' }))).toEqual({ ...EMPTY, all: true });
  });

  it('A-205: a project conversation names that project; a work-order conversation names that work order', () => {
    expect(chatReadScope(conversation({ kind: 'project', project: PROJECT_A }))).toEqual({ ...EMPTY, projects: new Set([PROJECT_A]) });
    expect(chatReadScope(conversation({ kind: 'workOrder', workOrder: WORK_ORDER_1 }))).toEqual({
      ...EMPTY,
      workOrders: new Set([WORK_ORDER_1]),
    });
  });

  it('A-205: every reference of a user message widens the scope by exactly what it names', () => {
    const refs: readonly ConversationRef[] = [
      { kind: 'workOrder', id: WORK_ORDER_2 },
      { kind: 'page', id: PAGE_1 },
      { kind: 'project', id: PROJECT_B },
      { kind: 'repo', id: REPO_A },
      { kind: 'file', id: 'src/main.ts', repo: REPO_A },
    ];
    const scope = chatReadScope(conversation({ kind: 'workOrder', workOrder: WORK_ORDER_1 }, [message('user', refs, 1)]));
    expect(scope).toEqual({
      all: false,
      projects: new Set([PROJECT_B]),
      repos: new Set([REPO_A]),
      workOrders: new Set([WORK_ORDER_1, WORK_ORDER_2]),
      pages: new Set([PAGE_1]),
      files: [{ repo: REPO_A, path: 'src/main.ts' }],
    });
  });

  it('A-205: a file reference names that one file; it does not make its repo readable', () => {
    const scope = chatReadScope(
      conversation({ kind: 'project', project: PROJECT_A }, [message('user', [{ kind: 'file', id: 'README.md', repo: REPO_A }], 1)]),
    );
    expect(scope.repos.size).toBe(0);
    expect(scope.files).toEqual([{ repo: REPO_A, path: 'README.md' }]);
  });

  it('A-205: references of assistant messages never widen the scope', () => {
    const scope = chatReadScope(
      conversation({ kind: 'project', project: PROJECT_A }, [
        message('assistant', [{ kind: 'project', id: PROJECT_B }, { kind: 'workOrder', id: WORK_ORDER_2 }], 1),
      ]),
    );
    expect(scope).toEqual({ ...EMPTY, projects: new Set([PROJECT_A]) });
  });

  it('A-205: a project reference in a global conversation changes nothing that all already covers', () => {
    const scope = chatReadScope(conversation({ kind: 'global' }, [message('user', [{ kind: 'project', id: PROJECT_B }], 1)]));
    expect(scope.all).toBe(true);
  });
});
