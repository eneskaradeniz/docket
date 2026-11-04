// chat-model.test.ts — the chat's pure rules: the place a route gives the panel (U-122), the
// history's day groups (U-107), the @ trigger (U-109), the attachment verdicts (U-110), the notice
// mapping (U-106), the undo window (U-112), the grant countdown (U-113) and the thinking and
// tool-step rules of the running message (U-377 … U-383).
import { describe, expect, it } from 'vitest';

import type { ProjectTree } from '../../api/queries';
import { EN } from '../labels/en';
import { TR } from '../labels/tr';
import type { LabelKey } from '../labels/keys';
import {
  appendThinking,
  atQueryOf,
  chatPlaceOf,
  chatShowsDots,
  chatShowsFold,
  chatShowsSteps,
  chatShowsThinking,
  CHAT_STEP_ROWS_DRAWN,
  CHAT_THINKING_MAX_CHARS,
  fileVerdict,
  imageDataUrlOf,
  isPreviewImageFile,
  touchPreviewCache,
  groupConversations,
  minutesLeft,
  noticeOf,
  sameScope,
  stepNameLabelKey,
  stepRowsAfter,
  stripAtToken,
  undoOpen,
  visibleStepRows,
  type ChatChange,
  type ChatState,
  type ChatStepRow,
} from './chat-model';
import { action, summary } from './chat-kit';

const TREE: ProjectTree = [
  {
    project: 'antero',
    name: 'Antero',
    firstRepo: 'antero-api',
    repos: [
      { repo: 'antero-api', active: 0, running: 0, waiting: 0 },
      { repo: 'antero-mobile', active: 0, running: 0, waiting: 0 },
    ],
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle',
  } as unknown as ProjectTree[number],
];
const code = (n: number): string => `İE-${String(n).padStart(4, '0')}`;

describe('chat place from the route (U-122)', () => {
  it('U-122: the cockpit, the library and an account view give the global scope alone', () => {
    for (const route of [{ name: 'cockpit' as const }, { name: 'library' as const }, { name: 'account' as const, id: 'a-1' }]) {
      const place = chatPlaceOf({ route, tree: TREE, workOrder: null, code });
      expect(place.choices).toEqual([{ scope: { kind: 'global' }, label: '' }]);
      expect(place.screen).toBeNull();
    }
  });

  it('U-122: a roadmap gives global then its project, and the screen reference is the project', () => {
    const place = chatPlaceOf({ route: { name: 'roadmap', project: 'antero' }, tree: TREE, workOrder: null, code });
    expect(place.choices.map((c) => c.scope)).toEqual([{ kind: 'global' }, { kind: 'project', project: 'antero' }]);
    expect(place.choices[1]?.label).toBe('Antero');
    expect(place.screen?.input).toEqual({ kind: 'project', id: 'antero' });
  });

  it('U-122: a board gives the project that owns its repo; the screen reference is the repo', () => {
    const place = chatPlaceOf({ route: { name: 'board', repo: 'antero-mobile' }, tree: TREE, workOrder: null, code });
    expect(place.choices.map((c) => c.scope)).toEqual([{ kind: 'global' }, { kind: 'project', project: 'antero' }]);
    expect(place.screen?.input).toEqual({ kind: 'repo', id: 'antero-mobile' });
  });

  it('U-122: a work order gives global, its project and itself, labelled by code and title', () => {
    const place = chatPlaceOf({
      route: { name: 'workOrder', id: 'W1' },
      tree: TREE,
      workOrder: { id: 'W1', repo: 'antero-api', number: 12, title: 'Giriş ekranı' },
      code,
    });
    expect(place.choices.map((c) => c.scope)).toEqual([
      { kind: 'global' },
      { kind: 'project', project: 'antero' },
      { kind: 'workOrder', workOrder: 'W1' },
    ]);
    expect(place.choices[2]?.label).toBe('İE-0012 · Giriş ekranı');
    expect(place.screen?.input).toEqual({ kind: 'workOrder', id: 'W1' });
  });

  it('U-122: a work order whose detail has not loaded still offers its own scope, unlabelled', () => {
    const place = chatPlaceOf({ route: { name: 'workOrder', id: 'W1' }, tree: TREE, workOrder: null, code });
    expect(place.choices.map((c) => c.scope)).toEqual([{ kind: 'global' }, { kind: 'workOrder', workOrder: 'W1' }]);
    expect(place.choices[1]?.label).toBe('');
  });

  it('U-122: a page screen references the page', () => {
    const place = chatPlaceOf({ route: { name: 'page', id: 'P1' }, tree: TREE, workOrder: null, code });
    expect(place.screen?.input).toEqual({ kind: 'page', id: 'P1' });
  });

  it('U-102: scopes compare by their own fields', () => {
    expect(sameScope({ kind: 'global' }, { kind: 'global' })).toBe(true);
    expect(sameScope({ kind: 'project', project: 'a' }, { kind: 'project', project: 'a' })).toBe(true);
    expect(sameScope({ kind: 'project', project: 'a' }, { kind: 'project', project: 'b' })).toBe(false);
    expect(sameScope({ kind: 'global' }, { kind: 'workOrder', workOrder: 'W' })).toBe(false);
  });
});

describe('history groups (U-107)', () => {
  const at = (days: number, hour = 12): number => {
    const date = new Date(2026, 9, 11, hour, 0, 0, 0);
    date.setDate(date.getDate() - days);
    return date.getTime();
  };
  const now = at(0, 15);

  it('U-107: pinned first, then Bugün, Dün, Bu hafta and older, newest first inside a group', () => {
    const list = [
      summary('old', { updatedAt: at(20) }),
      summary('week', { updatedAt: at(3) }),
      summary('yday', { updatedAt: at(1, 23) }),
      summary('today-a', { updatedAt: at(0, 9) }),
      summary('today-b', { updatedAt: at(0, 14) }),
      summary('pin', { pinned: true, updatedAt: at(40) }),
    ];
    const groups = groupConversations(list, now);
    expect(groups.map((g) => g.group)).toEqual(['pinned', 'today', 'yesterday', 'week', 'older']);
    expect(groups.find((g) => g.group === 'today')?.items.map((i) => i.id)).toEqual(['today-b', 'today-a']);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(['pin']);
  });

  it('U-107: an empty group is absent', () => {
    expect(groupConversations([summary('x', { updatedAt: at(0, 10) })], now).map((g) => g.group)).toEqual(['today']);
    expect(groupConversations([], now)).toEqual([]);
  });

  it('U-107: midnight splits Bugün from Dün and the seventh day leaves the week', () => {
    const midnight = new Date(2026, 9, 11, 0, 0, 0, 0).getTime();
    const groups = groupConversations([summary('a', { updatedAt: midnight }), summary('b', { updatedAt: midnight - 1 })], now);
    expect(groups.map((g) => [g.group, g.items.map((i) => i.id)])).toEqual([
      ['today', ['a']],
      ['yesterday', ['b']],
    ]);
    expect(groupConversations([summary('c', { updatedAt: at(7) })], now).map((g) => g.group)).toEqual(['older']);
    expect(groupConversations([summary('d', { updatedAt: at(6) })], now).map((g) => g.group)).toEqual(['week']);
  });
});

describe('the @ trigger (U-109)', () => {
  it('U-109: the token is a trailing @ at the start or after whitespace', () => {
    expect(atQueryOf('@')).toBe('');
    expect(atQueryOf('@gir')).toBe('gir');
    expect(atQueryOf('bak @İE-00')).toBe('İE-00');
    expect(atQueryOf('mail@host')).toBeNull();
    expect(atQueryOf('@gir şimdi')).toBeNull();
    expect(atQueryOf('')).toBeNull();
  });

  it('U-109: committing strips the token and the whitespace before it', () => {
    expect(stripAtToken('bak @İE-00')).toBe('bak');
    expect(stripAtToken('@gir')).toBe('');
    expect(stripAtToken('a b')).toBe('a b');
  });
});

describe('image previews (U-331)', () => {
  it('U-331: only png, jpg, jpeg and webp are preview images; pdf and text stay chips', () => {
    expect(isPreviewImageFile('a.png', 'image')).toBe(true);
    expect(isPreviewImageFile('a.jpg', 'image')).toBe(true);
    expect(isPreviewImageFile('a.jpeg', 'image')).toBe(true);
    expect(isPreviewImageFile('a.webp', 'image')).toBe(true);
    expect(isPreviewImageFile('a.pdf', 'pdf')).toBe(false);
    expect(isPreviewImageFile('a.md', 'text')).toBe(false);
    expect(isPreviewImageFile('a.png', 'text')).toBe(false);
  });

  it('U-331: the preview cache keeps at most 20 decoded ids', () => {
    let order: readonly string[] = [];
    for (let n = 0; n < 25; n += 1) order = touchPreviewCache(order, `I${n}`, 20);
    expect(order).toHaveLength(20);
    expect(order[0]).toBe('I5');
    expect(order[19]).toBe('I24');
  });

  it('U-331: a data URL is built only for the three image mime types', () => {
    expect(imageDataUrlOf('x.png', 'ab')).toBe('data:image/png;base64,ab');
    expect(imageDataUrlOf('x.jpg', 'ab')).toBe('data:image/jpeg;base64,ab');
    expect(imageDataUrlOf('x.gif', 'ab')).toBeNull();
  });
});

describe('attachment verdicts (U-110)', () => {
  it('U-110: a video is refused by extension, whatever its case', () => {
    for (const name of ['demo.mp4', 'a.MOV', 'b.webm', 'c.avi', 'd.mkv']) expect(fileVerdict(name, 0)).toEqual({ kind: 'video' });
  });

  it('U-110: an unlisted type is refused', () => {
    expect(fileVerdict('virus.exe', 0)).toEqual({ kind: 'type' });
    expect(fileVerdict('noextension', 0)).toEqual({ kind: 'type' });
  });

  it('U-110: the sixth file is refused; five are the limit', () => {
    expect(fileVerdict('a.md', 4)).toEqual({ kind: 'ok', ext: 'md', image: false });
    expect(fileVerdict('a.md', 5)).toEqual({ kind: 'limit' });
  });

  it('U-110: png, jpg, jpeg and webp are images; the listed text and pdf types are accepted', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'webp']) expect(fileVerdict(`x.${ext}`, 0)).toEqual({ kind: 'ok', ext, image: true });
    for (const ext of ['md', 'txt', 'log', 'csv', 'json', 'pdf']) expect(fileVerdict(`x.${ext}`, 0)).toEqual({ kind: 'ok', ext, image: false });
  });
});

describe('notices (U-106)', () => {
  it('U-106: quota, spend and consent block the input; the rest are text-only', () => {
    expect(noticeOf('quota')).toEqual({ kind: 'quota', blocks: true, action: 'accounts' });
    expect(noticeOf('spend')).toEqual({ kind: 'spend', blocks: true, action: 'consent' });
    expect(noticeOf('consent')).toEqual({ kind: 'consent', blocks: true, action: 'consent' });
    for (const kind of ['auth', 'limit', 'network', 'crash', 'tools_unavailable'] as const) {
      expect(noticeOf(kind)).toEqual({ kind, blocks: false, action: null });
    }
  });

  it('U-106: a code the UI does not know reads as a crash note, never a blank', () => {
    expect(noticeOf('something_new')).toEqual({ kind: 'crash', blocks: false, action: null });
  });
});

describe('thinking and tool steps (U-377 … U-383)', () => {
  const stateOf = (patch: Partial<ChatState> = {}): ChatState => ({
    open: true,
    full: false,
    docked: false,
    wide: false,
    view: 'chat',
    conversation: 'C1',
    detail: null,
    place: { choices: [{ scope: { kind: 'global' }, label: '' }], screen: null },
    scope: { kind: 'global' },
    pinned: false,
    draft: '',
    refs: [],
    tray: [],
    uploading: 0,
    pending: null,
    sending: false,
    turn: 'T1',
    streamed: '',
    notice: null,
    note: null,
    menu: null,
    at: { q: '', items: [], index: 0, loading: false },
    scopePop: false,
    permOpen: false,
    permDraft: [],
    history: { items: [], search: '', loaded: false, failed: false },
    usage: null,
    proposals: {},
    alert: false,
    now: 0,
    focusTick: 0,
    previews: {},
    previewOrder: [],
    trayPreviews: {},
    imageEnlarge: null,
    imageEnlargeReturn: null,
    thinking: '',
    steps: [],
    stepsOpen: false,
    ...patch,
  });

  const stepEvent = (id: string, phase: 'called' | 'done' | 'failed', patch: Partial<Extract<ChatChange, { readonly type: 'chat.step' }>> = {}): Extract<ChatChange, { readonly type: 'chat.step' }> => ({
    type: 'chat.step',
    conversation: 'C1',
    turn: 'T1',
    id,
    phase,
    tool: 'docket_get',
    ...patch,
  });

  it('U-377: the area under the running message prefers thinking, then steps, then the dots — one-way per turn', () => {
    // Nothing yet: the dots of U-104 stand.
    expect(chatShowsDots(stateOf())).toBe(true);
    expect(chatShowsThinking(stateOf())).toBe(false);
    expect(chatShowsSteps(stateOf())).toBe(false);
    // One step: the rows stand, the dots never return.
    const stepped = stateOf({ steps: [{ id: 's1', phase: 'called', tool: 'docket_get' }] });
    expect(chatShowsDots(stepped)).toBe(false);
    expect(chatShowsSteps(stepped)).toBe(true);
    expect(chatShowsThinking(stepped)).toBe(false);
    // A delta alone retires the dots too (U-104).
    expect(chatShowsDots(stateOf({ streamed: 'Mer' }))).toBe(false);
    // Thinking wins and is one-way: with any thinking the steps stop drawing for the turn.
    const thinking = stateOf({ thinking: 'Planı okuyorum.', steps: [{ id: 's1', phase: 'called', tool: 'docket_get' }], streamed: 'Bakt' });
    expect(chatShowsThinking(thinking)).toBe(true);
    expect(chatShowsSteps(thinking)).toBe(false);
    expect(chatShowsDots(thinking)).toBe(false);
    // After the turn ends the rows fold under the stored message — never live rows, never dots.
    const folded = stateOf({ turn: null, steps: [{ id: 's1', phase: 'done', tool: 'docket_get' }] });
    expect(chatShowsSteps(folded)).toBe(false);
    expect(chatShowsFold(folded)).toBe(true);
    expect(chatShowsDots(folded)).toBe(false);
    // A turn that had no steps leaves no disclosure.
    expect(chatShowsFold(stateOf({ turn: null }))).toBe(false);
  });

  it('U-378: fragments append in order into one bounded string; a blank fragment never counts', () => {
    expect(appendThinking('', 'Planı ')).toBe('Planı ');
    expect(appendThinking('Planı ', 'okuyorum.')).toBe('Planı okuyorum.');
    // Blank — empty or whitespace — changes nothing, not even the string.
    expect(appendThinking('Planı ', '  ')).toBe('Planı ');
    expect(appendThinking('', '\n')).toBe('');
    // Past the cap the oldest characters drop from the front; the newest stay whole.
    const long = 'a'.repeat(CHAT_THINKING_MAX_CHARS);
    expect(appendThinking(long, 'son')).toBe(`${'a'.repeat(CHAT_THINKING_MAX_CHARS - 3)}son`);
    expect(appendThinking(long, 'son').length).toBe(CHAT_THINKING_MAX_CHARS);
  });

  it('U-379: rows keep call order, move by id, ignore a result with no row, and cap the drawn rows', () => {
    let rows: readonly ChatStepRow[] = [];
    rows = stepRowsAfter(rows, stepEvent('a', 'called', { tool: 'docket_search', target: 'docs/a.md' }));
    rows = stepRowsAfter(rows, stepEvent('b', 'called', { tool: 'docket_get', server: 'docket-pages' }));
    // A result with an id no call announced changes nothing.
    expect(stepRowsAfter(rows, stepEvent('yok', 'done'))).toEqual(rows);
    expect(stepRowsAfter(rows, stepEvent('yok', 'failed'))).toEqual(rows);
    // Interleaved results move their own row by id, in place; arrival order stands and each row
    // keeps the identity its call announced.
    rows = stepRowsAfter(rows, stepEvent('b', 'done'));
    rows = stepRowsAfter(rows, stepEvent('a', 'failed'));
    expect(rows).toEqual([
      { id: 'a', phase: 'failed', tool: 'docket_search', target: 'docs/a.md' },
      { id: 'b', phase: 'done', tool: 'docket_get', server: 'docket-pages' },
    ]);
    // The feed draws the newest rows and counts the older ones for the more-line.
    const many: readonly ChatStepRow[] = Array.from({ length: 60 }, (_, n) => ({ id: `s${n}`, phase: 'called' as const, tool: 'docket_get' }));
    const drawn = visibleStepRows(many);
    expect(drawn.rows).toHaveLength(CHAT_STEP_ROWS_DRAWN);
    expect(drawn.hidden).toBe(10);
    expect(drawn.rows[0]?.id).toBe('s10');
    expect(drawn.rows.at(-1)?.id).toBe('s59');
    expect(visibleStepRows(many.slice(0, 50))).toEqual({ rows: many.slice(0, 50), hidden: 0 });
  });

  it('U-382: a row carries only the fields the event names — never a tool arguments or result field', () => {
    const rows = stepRowsAfter([], stepEvent('a', 'called', { target: 'docs/plan.md' }));
    expect(rows).toEqual([{ id: 'a', phase: 'called', tool: 'docket_get', target: 'docs/plan.md' }]);
    // A carried name draws as itself; the placeholder key draws as its label, never the raw key.
    expect(stepNameLabelKey('docket_get')).toBeNull();
    expect(stepNameLabelKey('chat.step.name_placeholder')).toBe('chat.step.name_placeholder');
  });

  it('U-383: the chat-steps pack holds every sentence, at eight words or fewer, in both locales', () => {
    const pack: readonly LabelKey[] = [
      'chat.thinking.heading',
      'chat.step.called',
      'chat.step.done',
      'chat.step.failed',
      'chat.step.fold',
      'chat.step.more',
      'chat.step.fold.aria',
      'chat.step.name_placeholder',
    ];
    const wordsOf = (sentence: string): number => sentence.trim().split(/\s+/).filter((word) => word !== '').length;
    for (const key of pack) {
      expect(TR[key], `tr:${key}`).toBeTypeOf('string');
      expect(EN[key], `en:${key}`).toBeTypeOf('string');
      expect(wordsOf(TR[key]), `tr:${key} ≤ 8 words`).toBeLessThanOrEqual(8);
      expect(wordsOf(EN[key]), `en:${key} ≤ 8 words`).toBeLessThanOrEqual(8);
    }
  });
});

describe('undo window and countdown (U-112, U-113)', () => {
  it('U-112: undo shows only for an applied, undoable action before its expiry', () => {
    expect(undoOpen(action('a', { undoable: true, undoExpiresAt: 2_000 }), 1_999)).toBe(true);
    expect(undoOpen(action('a', { undoable: true, undoExpiresAt: 2_000 }), 2_000)).toBe(false);
    expect(undoOpen(action('a', { undoable: false, undoExpiresAt: 2_000 }), 1_000)).toBe(false);
    expect(undoOpen(action('a', { status: 'undone', undoable: true, undoExpiresAt: 2_000 }), 1_000)).toBe(false);
  });

  it('U-113: minutes left count down from the grant expiry, rounded up, never below zero', () => {
    expect(minutesLeft(3_600_000, 0)).toBe(60);
    expect(minutesLeft(3_600_000, 1)).toBe(60);
    expect(minutesLeft(3_600_000, 60_000)).toBe(59);
    expect(minutesLeft(3_600_000, 3_599_999)).toBe(1);
    expect(minutesLeft(3_600_000, 3_600_000)).toBe(0);
    expect(minutesLeft(1_000, 9_000)).toBe(0);
  });
});
