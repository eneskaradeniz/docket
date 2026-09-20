import { describe, expect, it } from 'vitest';
import { degradedKind } from '../humanize';

// WO-0078 — the classifier's contract: the three adapter shapes Docket actually produces map to
// operator lines; everything else (any stderr line, exit codes, the empty string) is the honest
// unknown. The raw text is never matched for display here — classification only.
describe('degradedKind', () => {
  it('knows the forge adapter\'s unparseable-remote shape', () => {
    expect(degradedKind('unparseable remote (expected https://github.com/{owner}/{repo})')).toBe('unparseable-remote');
  });

  it('knows git\'s not-a-repository stderr', () => {
    expect(degradedKind('fatal: not a git repository (or any of the parent directories): .git')).toBe('not-git');
  });

  it('knows the missing-tool spawn failure', () => {
    expect(degradedKind('spawn git ENOENT')).toBe('tool-missing');
  });

  it('falls back to unknown for any other stderr — never guesses', () => {
    expect(degradedKind('git check failed (exit 128)')).toBe('unknown');
    expect(degradedKind('')).toBe('unknown');
    expect(degradedKind('fatal: bad object HEAD')).toBe('unknown');
  });
});
