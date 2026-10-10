// services/chat-turn-ledger.ts — the in-memory record of what one chat turn changed (docs/v2/
// application.md A-215). The write tools fill it as their effects happen; the turn runner (6e-4)
// drains it with `take` and writes the entries into the assistant message's artifacts and sources.
// It is never persisted and never audited: the durable trail is the pages, drafts, proposals and
// action records themselves.
import type { ActionId, DraftId, PageId, ProposalId, Result, RunId } from '../../domain/index';
import { err, ok } from '../../domain/index';

/** One effect of one turn. `source` names what a change was built from (a file path, a page,
 *  "operator request") so the reader of the message can tell data-derived work from the rest. */
export type TurnEntry =
  | { readonly kind: 'page'; readonly page: PageId; readonly version: number; readonly source?: string }
  | { readonly kind: 'draft'; readonly draft: DraftId; readonly action: ActionId; readonly source?: string }
  | { readonly kind: 'proposal'; readonly proposal: ProposalId; readonly action: ActionId; readonly source?: string }
  | { readonly kind: 'setting'; readonly action: ActionId; readonly source?: string };

export interface ChatTurnLedger {
  /** Appends one entry; `rate_limited` (nothing recorded) past the per-turn cap. */
  record(turn: RunId, entry: TurnEntry): Result<void, { readonly code: 'rate_limited' }>;
  /** The turn's entries in the order they happened, and the turn is cleared. */
  take(turn: RunId): readonly TurnEntry[];
  /** Drops the turn's entries without reading them. */
  clear(turn: RunId): void;
}

export const CHAT_TURN_LEDGER_LIMITS = { entriesPerTurn: 40, turnsHeld: 200, sourceMax: 200 } as const;

/** Control characters never belong in a source line, whatever the caller handed over. */
const cleanSource = (source: string): string => {
  let out = '';
  for (const char of source) {
    const code = char.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += char;
  }
  return out.length > CHAT_TURN_LEDGER_LIMITS.sourceMax ? out.slice(0, CHAT_TURN_LEDGER_LIMITS.sourceMax) : out;
};

export function createChatTurnLedger(): ChatTurnLedger {
  const turns = new Map<RunId, TurnEntry[]>();

  const sanitized = (entry: TurnEntry): TurnEntry => {
    if (entry.source === undefined) return entry;
    const clean = cleanSource(entry.source);
    if (clean === '') {
      const { source: _dropped, ...rest } = entry;
      return rest as TurnEntry;
    }
    return { ...entry, source: clean };
  };

  const record = (turn: RunId, entry: TurnEntry): Result<void, { readonly code: 'rate_limited' }> => {
    const held = turns.get(turn);
    if (held === undefined) {
      // A turn nobody wrote to yet: when the table is full the oldest turn falls out.
      if (turns.size >= CHAT_TURN_LEDGER_LIMITS.turnsHeld) {
        const oldest = turns.keys().next();
        if (!oldest.done) turns.delete(oldest.value);
      }
      turns.set(turn, [sanitized(entry)]);
      return ok(undefined);
    }
    if (held.length >= CHAT_TURN_LEDGER_LIMITS.entriesPerTurn) return err({ code: 'rate_limited' });
    held.push(sanitized(entry));
    return ok(undefined);
  };

  return {
    record,
    take: (turn): readonly TurnEntry[] => {
      const held = turns.get(turn);
      turns.delete(turn);
      return held ?? [];
    },
    clear: (turn): void => {
      turns.delete(turn);
    },
  };
}
