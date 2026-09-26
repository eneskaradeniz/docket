import { describe, expect, it } from 'vitest';
import { ALLOW_MARKER, SECRET_PATTERNS, findSecrets, redactSecrets } from './secret-patterns';

// Credential-looking fixtures are assembled at runtime, never written as one literal.
const privateKey = ['-----BEGIN', 'PRIVATE', 'KEY-----'].join(' ');
const awsKey = 'AKIA' + 'X'.repeat(16);
const githubToken = 'gh' + 'p_' + 'a'.repeat(36);
const githubFineGrained = 'github_' + 'pat_' + 'A'.repeat(60);
const skKey = 'sk-' + 'k'.repeat(32);
const slackToken = 'xox' + 'b-' + 'Z'.repeat(10);
const googleApiKey = 'AIza' + 'y'.repeat(35);
const stripeLiveKey = 'sk_live_' + 'S'.repeat(24);
const assignedSecret = 'password = "' + 'p'.repeat(20) + '"';

/** One case per pattern id: a string the pattern must match, and a look-alike it must not. */
const PATTERN_CASES: readonly { readonly id: string; readonly match: string; readonly nonMatch: string }[] = [
  { id: 'private-key', match: privateKey, nonMatch: ['-----BEGIN', 'CERTIFICATE'].join(' ') },
  { id: 'aws-access-key', match: awsKey, nonMatch: 'AKIA' + 'X'.repeat(15) },
  { id: 'github-token', match: githubToken, nonMatch: 'gh' + 'p_' + 'a'.repeat(35) },
  { id: 'github-fine-grained', match: githubFineGrained, nonMatch: 'github_' + 'pat_' + 'A'.repeat(59) },
  { id: 'sk-key', match: skKey, nonMatch: 'sk-' + 'k'.repeat(31) },
  { id: 'slack-token', match: slackToken, nonMatch: 'xox' + 'b-' + 'Z'.repeat(9) },
  { id: 'google-api-key', match: googleApiKey, nonMatch: 'AIza' + 'y'.repeat(34) },
  { id: 'stripe-live', match: stripeLiveKey, nonMatch: 'sk_live_' + 'S'.repeat(23) },
  { id: 'assigned-secret', match: assignedSecret, nonMatch: 'password = "' + 'p'.repeat(15) + '"' },
];

describe('SECRET_PATTERNS', () => {
  it('I-22: contains exactly the documented ids, in table order, all global', () => {
    expect(SECRET_PATTERNS.map((p) => p.id)).toEqual(PATTERN_CASES.map((c) => c.id));
    for (const p of SECRET_PATTERNS) expect(p.regex.flags).toContain('g');
  });

  for (const c of PATTERN_CASES) {
    it(`I-22: ${c.id} matches a credential-shaped string`, () => {
      expect(findSecrets(c.match).map((f) => f.pattern)).toEqual([c.id]);
    });

    it(`I-22: ${c.id} does not match a look-alike`, () => {
      expect(findSecrets(c.nonMatch).filter((f) => f.pattern === c.id)).toEqual([]);
    });
  }
});

describe('findSecrets', () => {
  it('I-22: checks every line against every pattern and reports one finding per (line, pattern)', () => {
    const otherAwsKey = 'AKIA' + 'Y'.repeat(16);
    const text = [
      awsKey,
      `${awsKey} and ${awsKey}`, // same pattern twice on one line -> one finding
      `token = "${'t'.repeat(20)}" ${otherAwsKey}`, // two patterns on one line
    ].join('\n');
    expect(findSecrets(text)).toEqual([
      { line: 1, pattern: 'aws-access-key' },
      { line: 2, pattern: 'aws-access-key' },
      { line: 3, pattern: 'aws-access-key' },
      { line: 3, pattern: 'assigned-secret' },
    ]);
  });

  it('I-22: skips every pattern on a line containing ALLOW_MARKER', () => {
    const marked = `${awsKey} ${ALLOW_MARKER}`;
    const clean = githubToken;
    expect(findSecrets([marked, clean].join('\n'))).toEqual([{ line: 2, pattern: 'github-token' }]);
  });

  it('I-22: reports 1-based line numbers', () => {
    const text = ['', '', skKey].join('\n');
    expect(findSecrets(text)).toEqual([{ line: 3, pattern: 'sk-key' }]);
  });

  it('I-22: a finding carries only line and pattern, never the matched text', () => {
    const findings = findSecrets(`prefix ${awsKey} suffix\n${githubToken}`);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f).toEqual({ line: expect.any(Number), pattern: expect.any(String) });
      expect(Object.keys(f).sort()).toEqual(['line', 'pattern']);
    }
  });

  it('I-22: returns no findings for empty or clean text', () => {
    expect(findSecrets('')).toEqual([]);
    expect(findSecrets('just some prose\nwith no credentials at all\n')).toEqual([]);
  });
});

describe('redactSecrets', () => {
  it('I-22: replaces every match with [redacted] and keeps the surrounding text', () => {
    const text = `keep ${awsKey} middle ${githubToken}\ntail ${slackToken}`;
    expect(redactSecrets(text)).toBe('keep [redacted] middle [redacted]\ntail [redacted]');
  });

  it('I-22: replaces several occurrences on one line', () => {
    expect(redactSecrets(`${awsKey} and ${awsKey}`)).toBe('[redacted] and [redacted]');
  });

  it('I-22: redacts allow-marked lines too', () => {
    const line = `password = "${'p'.repeat(20)}" ${ALLOW_MARKER}`;
    expect(redactSecrets(line)).toBe(`[redacted] ${ALLOW_MARKER}`);
  });

  it('I-22: leaves text without secrets unchanged', () => {
    const clean = 'plain text\nnothing to hide\n';
    expect(redactSecrets(clean)).toBe(clean);
  });
});
