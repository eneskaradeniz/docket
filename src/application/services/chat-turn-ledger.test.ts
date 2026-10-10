// chat turn ledger — rule A-215 (docs/v2/application.md): the in-memory record of what one chat
// turn changed, drained by the future runner (6e-4) into the assistant message's artifacts.
import { describe, expect, it } from 'vitest';

import { parseUlid, type ActionId, type DraftId, type PageId, type ProposalId, type RunId, type Ulid } from '../../domain/index';

import { CHAT_TURN_LEDGER_LIMITS, createChatTurnLedger, type TurnEntry } from './chat-turn-ledger';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const idOf = <B extends string>(n: number): Ulid<B> => ulidOf<B>(`01ARZ3NDEKTSV4RRFFQ69${String(n).padStart(5, '0')}`);
const TURN = idOf<'run'>(1) as RunId;
const OTHER = idOf<'run'>(2) as RunId;

const page = (n: number, version: number, source?: string): TurnEntry => ({
  kind: 'page',
  page: idOf<'page'>(n) as PageId,
  version,
  ...(source === undefined ? {} : { source }),
});
const draft = (n: number, action: number): TurnEntry => ({ kind: 'draft', draft: idOf<'draft'>(n) as DraftId, action: idOf<'action'>(action) as ActionId });
const proposal = (n: number, action: number, source?: string): TurnEntry => ({
  kind: 'proposal',
  proposal: idOf<'proposal'>(n) as ProposalId,
  action: idOf<'action'>(action) as ActionId,
  ...(source === undefined ? {} : { source }),
});
const setting = (action: number): TurnEntry => ({ kind: 'setting', action: idOf<'action'>(action) as ActionId });

describe('A-215: the chat turn ledger', () => {
  it('A-215: record appends, take returns the entries in order and clears, clear empties without reading', () => {
    const ledger = createChatTurnLedger();
    expect(ledger.record(TURN, page(11, 1))).toEqual({ ok: true });
    expect(ledger.record(TURN, page(11, 2))).toEqual({ ok: true });
    expect(ledger.record(TURN, draft(21, 31))).toEqual({ ok: true });
    expect(ledger.record(OTHER, setting(32))).toEqual({ ok: true });

    expect(ledger.take(TURN)).toEqual([page(11, 1), page(11, 2), draft(21, 31)]);
    expect(ledger.take(TURN)).toEqual([]); // take clears
    expect(ledger.take(OTHER)).toEqual([setting(32)]); // another turn is untouched

    expect(ledger.record(OTHER, proposal(41, 33, 'operator request'))).toEqual({ ok: true });
    ledger.clear(OTHER);
    expect(ledger.take(OTHER)).toEqual([]);
    ledger.clear(idOf<'run'>(99) as RunId); // clearing an unknown turn is not an error
  });

  it('A-215: a source is kept only when given, stripped of control characters and cut to 200', () => {
    const ledger = createChatTurnLedger();
    const noisy = `a\u0000b\u0007c\u007fd${'e'.repeat(300)}`;
    expect(ledger.record(TURN, proposal(41, 33, noisy))).toEqual({ ok: true });
    const [entry] = ledger.take(TURN);
    expect(entry).toMatchObject({ kind: 'proposal' });
    if (entry?.kind !== 'proposal') throw new Error('fixture entry kind');
    expect(entry.source).toBe(`abcde${'e'.repeat(195)}`.slice(0, 200));
    expect(entry.source).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(entry.source).toHaveLength(CHAT_TURN_LEDGER_LIMITS.sourceMax);
    expect(ledger.record(TURN, draft(21, 31))).toEqual({ ok: true });
    expect(ledger.take(TURN)[0]).not.toHaveProperty('source'); // absent, never an empty string
  });

  it('A-215: at most 40 entries per turn — the 41st write answers rate_limited and records nothing', () => {
    const ledger = createChatTurnLedger();
    expect(CHAT_TURN_LEDGER_LIMITS.entriesPerTurn).toBe(40);
    for (let i = 0; i < 40; i += 1) expect(ledger.record(TURN, page(11, i + 1)).ok, `entry ${i}`).toBe(true);
    expect(ledger.record(TURN, setting(31))).toEqual({ ok: false, error: { code: 'rate_limited' } });
    expect(ledger.take(TURN)).toHaveLength(40);
    expect(ledger.record(TURN, setting(31)).ok).toBe(true); // a drained turn starts over
  });

  it('A-215: at most 200 turns are held — the oldest is dropped — and nothing is persisted', () => {
    const ledger = createChatTurnLedger();
    expect(CHAT_TURN_LEDGER_LIMITS.turnsHeld).toBe(200);
    const first = idOf<'run'>(100) as RunId;
    for (let i = 0; i < 200; i += 1) {
      expect(ledger.record(idOf<'run'>(100 + i) as RunId, page(11, 1)).ok, `turn ${i}`).toBe(true);
    }
    expect(ledger.record(idOf<'run'>(300) as RunId, setting(1)).ok).toBe(true); // the 201st turn
    expect(ledger.take(first)).toEqual([]); // the oldest fell out
    expect(ledger.take(idOf<'run'>(150) as RunId)).toEqual([page(11, 1)]); // a later one survives
    const fresh = createChatTurnLedger(); // a new ledger — the next app start — holds nothing
    expect(fresh.take(idOf<'run'>(300) as RunId)).toEqual([]);
  });
});
