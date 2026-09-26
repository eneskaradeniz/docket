// Line-level secret detection used by the pre-push gate. Findings name the pattern id, never the match.
export interface SecretPattern {
  readonly id: string;
  readonly regex: RegExp;
}

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  { id: 'private-key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'aws-access-key', regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g },
  { id: 'github-fine-grained', regex: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g },
  { id: 'sk-key', regex: /\bsk-[A-Za-z0-9_-]{32,}/g },
  { id: 'slack-token', regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g },
  { id: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'stripe-live', regex: /\b[rs]k_live_[0-9A-Za-z]{24,}\b/g },
  {
    id: 'assigned-secret',
    regex: /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/gi,
  },
];

export const ALLOW_MARKER = 'docket:allow-secret';

export interface SecretFinding {
  readonly line: number; // 1-based line, pattern id -- never the match
  readonly pattern: string;
}

// A fresh RegExp per use: global regexes carry lastIndex, and the patterns object is shared state.
function fresh(pattern: SecretPattern): RegExp {
  return new RegExp(pattern.regex.source, pattern.regex.flags);
}

export function findSecrets(text: string): readonly SecretFinding[] {
  const findings: SecretFinding[] = [];
  let lineNumber = 0;
  for (const line of text.split('\n')) {
    lineNumber++;
    if (line.includes(ALLOW_MARKER)) continue;
    for (const pattern of SECRET_PATTERNS) {
      if (fresh(pattern).test(line)) findings.push({ line: lineNumber, pattern: pattern.id });
    }
  }
  return findings;
}

export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    // No pattern can span lines, so whole-text replacement equals per-line replacement,
    // and '[redacted]' matches none of the remaining patterns.
    out = out.replace(fresh(pattern), '[redacted]');
  }
  return out;
}
