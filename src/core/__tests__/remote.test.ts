// src/core/__tests__/remote.test.ts — the remote console contract's PURE derivations (WO-0102).
//
// deriveRemoteConsole assembles the account-wide Konsol view-model from the facts the composition
// root already holds (plan §2.3); pairingVerdict's tests live in device-store.test.ts with the
// port. Every assertion here is a contract pin — docket-mobile wave 1 builds on these shapes.
import { describe, expect, it } from 'vitest';
import {
  REMOTE_API_VERSION,
  REMOTE_DENY_REASON,
  deriveRemoteConsole,
  parsePairingQr,
  remoteAskDecision,
  serializePairingQr,
  type RemoteAskAnswer,
  type RemoteConsoleFacts,
} from '../remote';
import { askDecisionAll } from '../askq';
import type { AskAnswer, AskQuestion } from '../askq';
import type { PermissionAsk, WorkOrderId, WorkspaceId } from '../types';

const wsA = 'ws-a' as WorkspaceId;
const wsB = 'ws-b' as WorkspaceId;
const wo1 = 'WO-0001' as WorkOrderId;
const wo2 = 'WO-0002' as WorkOrderId;

const binaryAsk: PermissionAsk = {
  requestId: 'req-1',
  tool: 'Bash',
  input: { command: 'npm test', description: 'run the suite' },
  title: 'Bash',
  reason: 'write',
};
const structuredInput = {
  questions: [
    {
      question: 'Hangi yol izlensin?',
      header: 'Yol',
      options: [
        { label: 'A şeridi', description: 'ilk adım' },
        { label: 'B şeridi', description: 'ikinci adım' },
      ],
      multiSelect: false,
    },
  ],
};
const structuredAsk: PermissionAsk = {
  requestId: 'req-2',
  tool: 'AskUserQuestion',
  input: structuredInput,
};

const baseFacts = (): RemoteConsoleFacts => ({
  now: '2026-09-24T12:00:00.000Z',
  drives: [
    {
      owner: `wo:${wo1}`,
      kind: 'wo',
      workspaceId: wsA,
      woId: wo1,
      title: 'Birinci iş',
      role: 'implementer',
      asks: [],
    },
    {
      owner: `wo:${wo2}`,
      kind: 'wo',
      workspaceId: wsB,
      woId: wo2,
      title: 'İkinci iş',
      role: 'architect',
      asks: [binaryAsk, structuredAsk],
    },
    {
      owner: `ws:${wsB}`,
      kind: 'draft',
      workspaceId: wsB,
      role: 'architect',
      asks: [],
    },
  ],
  quota: [
    {
      profile: 'pro',
      windows: [{ window: 'five_hour', utilization: 42, resetAt: '2026-09-24T15:00:00.000Z' }],
      status: 'ok',
    },
  ],
  budgets: [
    { workspaceId: wsA, threshold: { capUsd: 10, warnPercent: 80 }, monthUsd: 9, hasUnknown: false },
    { workspaceId: wsB, threshold: { capUsd: 10, warnPercent: 80 }, monthUsd: 2, hasUnknown: false },
  ],
  workspaces: [
    { id: wsA, label: 'Atölye A' },
    { id: wsB, label: 'Atölye B' },
  ],
});

describe('deriveRemoteConsole (WO-0102)', () => {
  it('fans every workspace\'s drives into one account-wide list, wo cards by woId then drafts', () => {
    const view = deriveRemoteConsole(baseFacts());
    expect(view.drives.map((d) => d.owner)).toEqual([`wo:${wo1}`, `wo:${wo2}`, `ws:${wsB}`]);
    const [a, b, draft] = view.drives;
    expect(a).toMatchObject({ kind: 'wo', workspaceId: wsA, woId: wo1, title: 'Birinci iş', role: 'implementer' });
    expect(b).toMatchObject({ kind: 'wo', workspaceId: wsB, woId: wo2, role: 'architect' });
    expect(draft).toMatchObject({ kind: 'draft', workspaceId: wsB, role: 'architect' });
    expect(draft.woId).toBeUndefined();
    expect(view.version).toBe(REMOTE_API_VERSION);
  });

  it('orders wo cards by woId ascending regardless of input order', () => {
    const facts = baseFacts();
    facts.drives = [...facts.drives].reverse();
    const view = deriveRemoteConsole(facts);
    expect(view.drives.map((d) => d.owner)).toEqual([`wo:${wo1}`, `wo:${wo2}`, `ws:${wsB}`]);
  });

  it('marks a drive holding asks as asking, and attributes each ask card to its owner', () => {
    const view = deriveRemoteConsole(baseFacts());
    expect(view.drives.map((d) => d.status)).toEqual(['running', 'asking', 'running']);
    expect(view.asks.map((a) => `${a.owner}#${a.requestId}`).sort()).toEqual([
      `wo:${wo2}#req-1`,
      `wo:${wo2}#req-2`,
    ]);
    for (const ask of view.asks) {
      expect(ask.tool).toBeDefined();
      expect(ask.input).toBeDefined();
    }
  });

  it('carries BOTH ask shapes: the structured parse view, and undefined for binary', () => {
    const view = deriveRemoteConsole(baseFacts());
    const binary = view.asks.find((a) => a.requestId === 'req-1')!;
    const structured = view.asks.find((a) => a.requestId === 'req-2')!;
    expect(binary.questions).toBeUndefined();
    expect(structured.questions).toBeDefined();
    expect(structured.questions!.map((q) => q.question)).toEqual(['Hangi yol izlensin?']);
    expect(structured.questions![0]!.header).toBe('Yol');
    expect(structured.questions![0]!.options.map((o) => o.label)).toEqual(['A şeridi', 'B şeridi']);
  });

  it('derives health rows presence-only: quota for reported profiles, spend for capped workspaces', () => {
    const view = deriveRemoteConsole(baseFacts());
    expect(view.health).toHaveLength(3);
    const quota = view.health.filter((h) => h.kind === 'quota');
    const spend = view.health.filter((h) => h.kind === 'spend');
    expect(quota).toEqual([
      {
        kind: 'quota',
        profile: 'pro',
        windows: [{ window: 'five_hour', utilization: 42, resetAt: '2026-09-24T15:00:00.000Z' }],
        status: 'ok',
      },
    ]);
    // wsA at $9 of a $10 cap (warn line $8) warns; wsB at $2 is ok — core's WorkspaceBudgetView.
    expect(spend.map((s) => (s.kind === 'spend' ? [s.workspaceId, s.view.status, s.view.monthUsd] : null))).toEqual([
      [wsA, 'warn', 9],
      [wsB, 'ok', 2],
    ]);
  });

  it('renders no spend rows without caps and no quota rows without reports (honest absence)', () => {
    const facts = baseFacts();
    facts.quota = [];
    facts.budgets = [];
    const view = deriveRemoteConsole(facts);
    expect(view.health).toEqual([]);
  });

  it('carries the workspace label join verbatim and stays quiet only with no drives and no asks', () => {
    const view = deriveRemoteConsole(baseFacts());
    expect(view.workspaces).toEqual([
      { id: wsA, label: 'Atölye A' },
      { id: wsB, label: 'Atölye B' },
    ]);
    expect(view.quiet).toBe(false);
    const empty = deriveRemoteConsole({ ...baseFacts(), drives: [] });
    expect(empty.quiet).toBe(true);
    expect(empty.drives).toEqual([]);
    expect(empty.asks).toEqual([]);
  });

  it('does not mutate its facts and is deterministic', () => {
    const facts = baseFacts();
    const snapshot = JSON.stringify(facts);
    const one = deriveRemoteConsole(facts);
    const two = deriveRemoteConsole(facts);
    expect(one).toEqual(two);
    expect(JSON.stringify(facts)).toBe(snapshot);
  });

  it('drops a wo drive whose title lookup is still in flight (undefined title, honest)', () => {
    const facts = baseFacts();
    facts.drives[0]!.title = undefined;
    const view = deriveRemoteConsole(facts);
    expect(view.drives[0]!.title).toBeUndefined();
  });
});

describe('remoteAskDecision (WO-0102)', () => {
  const q = (question: string): AskQuestion => ({
    question,
    header: question.slice(0, 4),
    options: [
      { label: 'A', description: 'a' },
      { label: 'B', description: 'b' },
    ],
    multiSelect: false,
  });
  const ans = (kind: 'selection' | 'other' | 'dismissed', v?: string): AskAnswer =>
    kind === 'selection' ? { kind: 'selection', labels: [v ?? 'A'] } : kind === 'other' ? { kind: 'other', text: v ?? 'kendi yolum' } : { kind: 'dismissed' };

  it('binary allow is the bare allow; binary deny carries the GUI-parity reason', () => {
    expect(remoteAskDecision(structuredInput, { kind: 'binary', allow: true })).toEqual({ allow: true });
    expect(remoteAskDecision(structuredInput, { kind: 'binary', allow: false })).toEqual({
      allow: false,
      reason: REMOTE_DENY_REASON,
    });
  });

  it('structured answers fold exactly as askDecisionAll does (parity, every arm)', () => {
    const answered: Array<{ question: string; answer: AskAnswer }> = [
      { question: 'Hangi yol izlensin?', answer: ans('selection', 'A şeridi') },
      { question: 'İkinci soru?', answer: ans('other', 'özel cevap') },
    ];
    const wire: RemoteAskAnswer = { kind: 'structured', answered };
    const viaRemote = remoteAskDecision(structuredInput, wire);
    const viaFold = askDecisionAll(
      structuredInput,
      answered.map(({ question, answer }) => ({ question: q(question), answer })),
    );
    expect(viaRemote).toEqual(viaFold);
    expect(viaRemote).toMatchObject({ allow: true, updatedInput: { answers: { 'Hangi yol izlensin?': 'A şeridi', 'İkinci soru?': 'özel cevap' } } });

    // any declined arm denies the whole call; all-dismissed is the bare allow
    const declined: RemoteAskAnswer = {
      kind: 'structured',
      answered: [{ question: 'Hangi yol izlensin?', answer: { kind: 'declined', message: 'olmaz' } }],
    };
    expect(remoteAskDecision(structuredInput, declined)).toEqual({ allow: false, reason: 'olmaz' });
    const dismissed: RemoteAskAnswer = {
      kind: 'structured',
      answered: [{ question: 'Hangi yol izlensin?', answer: ans('dismissed') }],
    };
    expect(remoteAskDecision(structuredInput, dismissed)).toEqual({ allow: true });
  });
});

describe('pairing QR grammar (WO-0102)', () => {
  it('round-trips the payload', () => {
    const text = serializePairingQr({ version: 1, endpoint: { host: '192.168.1.4', port: 47654 }, code: '123456' });
    expect(text).toBe('docket-pair://192.168.1.4:47654?v=1&code=123456');
    expect(parsePairingQr(text)).toEqual({ version: 1, endpoint: { host: '192.168.1.4', port: 47654 }, code: '123456' });
  });

  it('refuses every malformed shape (undefined, never a throw)', () => {
    expect(parsePairingQr('http://192.168.1.4:47654?code=123456')).toBeUndefined();
    expect(parsePairingQr('docket-pair://192.168.1.4')).toBeUndefined();
    expect(parsePairingQr('docket-pair://:47654?v=1&code=123456')).toBeUndefined();
    expect(parsePairingQr('docket-pair://192.168.1.4:notaport?v=1&code=123456')).toBeUndefined();
    expect(parsePairingQr('docket-pair://192.168.1.4:47654?v=2&code=123456')).toBeUndefined();
    expect(parsePairingQr('docket-pair://192.168.1.4:47654?code=123456')).toBeUndefined();
    expect(parsePairingQr('docket-pair://192.168.1.4:47654?v=1&code=12345')).toBeUndefined();
    expect(parsePairingQr('docket-pair://192.168.1.4:47654?v=1&code=12345a')).toBeUndefined();
    expect(parsePairingQr('')).toBeUndefined();
  });
});
