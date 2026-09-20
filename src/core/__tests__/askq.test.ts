import { describe, expect, it } from 'vitest';
import {
  ASK_TOOL,
  type AskAnswer,
  askDecision,
  type AskQuestion,
  askOptionDisplayLabel,
  askOptionIsRecommended,
  parseAskRequest,
  RECOMMENDED_SUFFIX,
} from '../askq';

// WO-0077 — the structured ask (AskUserQuestion through the permission fence). Every load-bearing
// fact here is MEASURED, not assumed: docs/work-orders/WO-0076-askq-probe/report.md (raw/askq-a1
// single select, a2 multi join, a3 free text, a4 deny, a5 bare allow). The parse is strict — any
// malformed shape returns undefined, never a throw (the card falls back to the binary form).

// The probe's own a1 payload, verbatim (report.md Q2).
const a1Input = {
  questions: [
    {
      question: 'Which persistence layer should the new service use?',
      header: 'Storage',
      options: [
        { label: 'SQLite (Recommended)', description: 'Embedded, zero-ops, fits a single machine' },
        { label: 'Postgres', description: 'Full server database, ops burden' },
        { label: 'JSON files', description: 'Flat files on disk, no query layer' },
      ],
      multiSelect: false,
    },
  ],
};
const QUESTION_KEY = 'Which persistence layer should the new service use?';

const multiInput = {
  questions: [
    {
      question: 'Which export formats should be enabled at launch?',
      header: 'Storage',
      options: [
        { label: 'SQLite (Recommended)', description: 'Embedded' },
        { label: 'Postgres', description: 'Server' },
        { label: 'JSON files', description: 'Flat' },
      ],
      multiSelect: true,
    },
  ],
};

describe('parseAskRequest — the measured payloads', () => {
  it('parses the probe a1 payload (single-select, 3 options)', () => {
    expect(parseAskRequest(ASK_TOOL, a1Input)).toEqual({
      question: QUESTION_KEY,
      header: 'Storage',
      options: [
        { label: 'SQLite (Recommended)', description: 'Embedded, zero-ops, fits a single machine' },
        { label: 'Postgres', description: 'Full server database, ops burden' },
        { label: 'JSON files', description: 'Flat files on disk, no query layer' },
      ],
      multiSelect: false,
    } satisfies AskQuestion);
  });

  it('parses the probe a2 payload (multiSelect: true)', () => {
    const parsed = parseAskRequest(ASK_TOOL, multiInput);
    expect(parsed?.multiSelect).toBe(true);
  });

  it('renders the FIRST question of a multi-question payload (v1 scope, pinned)', () => {
    const parsed = parseAskRequest(ASK_TOOL, {
      questions: [a1Input.questions[0], { ...multiInput.questions[0] }],
    });
    expect(parsed?.question).toBe(QUESTION_KEY);
  });

  it('ignores unknown extra fields (the optional preview shape is not Docket\'s to read)', () => {
    const input = {
      questions: [{ ...a1Input.questions[0], options: a1Input.questions[0]!.options.map((o) => ({ ...o, preview: 'md' })) }],
    };
    expect(parseAskRequest(ASK_TOOL, input)?.options[0]).toEqual({
      label: 'SQLite (Recommended)',
      description: 'Embedded, zero-ops, fits a single machine',
    });
  });

  it('refuses another tool (the parse is keyed on the ask tool, not just the shape)', () => {
    expect(parseAskRequest('Write', a1Input)).toBeUndefined();
  });
});

describe('parseAskRequest — malformed shapes return undefined, never a throw', () => {
  const cases: Array<[string, unknown]> = [
    ['input not an object', null],
    ['input an array', [a1Input]],
    ['questions missing', {}],
    ['questions not an array', { questions: 'Storage' }],
    ['questions empty', { questions: [] }],
    ['question element not an object', { questions: ['Storage'] }],
    ['question key missing', { questions: [{ header: 'Storage', options: a1Input.questions[0]!.options, multiSelect: false }] }],
    ['question key empty (the fold could not key the answer)', { questions: [{ question: '', header: 'Storage', options: a1Input.questions[0]!.options, multiSelect: false }] }],
    ['question key not a string', { questions: [{ question: 7, header: 'Storage', options: a1Input.questions[0]!.options, multiSelect: false }] }],
    ['header not a string', { questions: [{ question: QUESTION_KEY, header: 12, options: a1Input.questions[0]!.options, multiSelect: false }] }],
    ['options missing', { questions: [{ question: QUESTION_KEY, header: 'Storage', multiSelect: false }] }],
    ['options not an array', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: 'SQLite', multiSelect: false }] }],
    ['only one option (<2)', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: [a1Input.questions[0]!.options[0]], multiSelect: false }] }],
    ['an option not an object', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: ['SQLite', 'Postgres'], multiSelect: false }] }],
    ['an option label missing', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: [{ description: 'x' }, a1Input.questions[0]!.options[1]], multiSelect: false }] }],
    ['an option label empty', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: [{ label: '', description: 'x' }, a1Input.questions[0]!.options[1]], multiSelect: false }] }],
    ['an option label not a string', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: [{ label: 1, description: 'x' }, a1Input.questions[0]!.options[1]], multiSelect: false }] }],
    ['an option description not a string', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: [{ label: 'SQLite', description: 3 }, a1Input.questions[0]!.options[1]], multiSelect: false }] }],
    ['multiSelect missing', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: a1Input.questions[0]!.options }] }],
    ['multiSelect not a boolean', { questions: [{ question: QUESTION_KEY, header: 'Storage', options: a1Input.questions[0]!.options, multiSelect: 'false' }] }],
  ];
  for (const [name, input] of cases) {
    it(`${name} → undefined`, () => {
      expect(parseAskRequest(ASK_TOOL, input as Record<string, unknown>)).toBeUndefined();
    });
  }

  it('a thrown shape (getter) is caught, not propagated', () => {
    const hostile: Record<string, unknown> = {};
    Object.defineProperty(hostile, 'questions', {
      get() {
        throw new Error('hostile input');
      },
    });
    expect(parseAskRequest(ASK_TOOL, hostile)).toBeUndefined();
  });
});

describe('the recommendation marker — a label-suffix convention, never a field', () => {
  it('RECOMMENDED_SUFFIX matches only a trailing "(Recommended)"', () => {
    expect(RECOMMENDED_SUFFIX.test('SQLite (Recommended)')).toBe(true);
    expect(RECOMMENDED_SUFFIX.test('SQLite (Recommended)  ')).toBe(true);
    expect(RECOMMENDED_SUFFIX.test('SQLite')).toBe(false);
    expect(RECOMMENDED_SUFFIX.test('(Recommended) SQLite')).toBe(false);
    expect(RECOMMENDED_SUFFIX.test('SQLite (recommended)')).toBe(false); // case-honest: the convention is capitalized
  });

  it('askOptionIsRecommended marks the suffixed option', () => {
    expect(askOptionIsRecommended('SQLite (Recommended)')).toBe(true);
    expect(askOptionIsRecommended('Postgres')).toBe(false);
  });

  it('askOptionDisplayLabel parses the suffix OFF for display', () => {
    expect(askOptionDisplayLabel('SQLite (Recommended)')).toBe('SQLite');
    expect(askOptionDisplayLabel('SQLite (Recommended)  ')).toBe('SQLite');
    expect(askOptionDisplayLabel('Postgres')).toBe('Postgres');
  });
});

describe('askDecision — the four measured arms (WO-0076 Q3)', () => {
  const answerOf = (a: AskAnswer): unknown => askDecision(a1Input, QUESTION_KEY, a);

  it('selection → allow with the fold: answers keyed by the exact question string, label verbatim (a1)', () => {
    expect(answerOf({ kind: 'selection', labels: ['SQLite (Recommended)'] })).toEqual({
      allow: true,
      updatedInput: {
        questions: a1Input.questions,
        answers: { [QUESTION_KEY]: 'SQLite (Recommended)' },
      },
    });
  });

  it('multi-select labels join ", " into ONE string (a2)', () => {
    const d = askDecision(multiInput, 'Which export formats should be enabled at launch?', {
      kind: 'selection',
      labels: ['SQLite (Recommended)', 'Postgres'],
    });
    expect(d).toEqual({
      allow: true,
      updatedInput: {
        questions: multiInput.questions,
        answers: { 'Which export formats should be enabled at launch?': 'SQLite (Recommended), Postgres' },
      },
    });
  });

  it('other → the same fold shape, value the free text (a3)', () => {
    const text = 'Plain markdown files with YAML front-matter — none of the listed options';
    expect(answerOf({ kind: 'other', text })).toEqual({
      allow: true,
      updatedInput: { questions: a1Input.questions, answers: { [QUESTION_KEY]: text } },
    });
  });

  it('dismissed → the BARE allow, no updatedInput key at all (a5)', () => {
    const d = askDecision(a1Input, QUESTION_KEY, { kind: 'dismissed' });
    expect(d).toEqual({ allow: true });
    expect(Object.keys(d)).toEqual(['allow']); // not { allow: true, updatedInput: undefined } — the bare arm
  });

  it('declined → deny with the message (a4)', () => {
    expect(answerOf({ kind: 'declined', message: 'the operator declined to answer this question' })).toEqual({
      allow: false,
      reason: 'the operator declined to answer this question',
    });
  });

  it('the fold spreads the ORIGINAL input verbatim (the CLI matches on it)', () => {
    const input = { questions: a1Input.questions, extra: { nested: true } };
    const d = askDecision(input, QUESTION_KEY, { kind: 'selection', labels: ['SQLite (Recommended)'] });
    expect(d.allow && d.updatedInput).toEqual({ questions: a1Input.questions, extra: { nested: true }, answers: { [QUESTION_KEY]: 'SQLite (Recommended)' } });
  });
});
