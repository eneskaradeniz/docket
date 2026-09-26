// Line-level secret detection used by the pre-push gate. Findings name the pattern id, never the match.
export interface SecretPattern {
  readonly id: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [];

export const ALLOW_MARKER = 'docket:allow-secret';

export interface SecretFinding {
  readonly line: number; // 1-based line, pattern id -- never the match
  readonly pattern: string;
}

export function findSecrets(text: string): readonly SecretFinding[] {
  void text;
  throw new Error('not implemented');
}

export function redactSecrets(text: string): string {
  void text;
  throw new Error('not implemented');
}
