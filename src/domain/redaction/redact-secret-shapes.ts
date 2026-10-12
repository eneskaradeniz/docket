// Token-shaped text that operator notes and work-order descriptions must not carry into a
// prompt or a stored reason. The shapes are fixed; a fresh RegExp per pass because a global
// pattern keeps lastIndex, and a shared one would make the next call depend on the last.

const SECRET_SHAPES: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{60,}\b/g,
  /\bsk-[A-Za-z0-9_-]{32,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\b[rs]k_live_[0-9A-Za-z]{24,}\b/g,
  /(?:api[_-]?key|secret|token|password)["']?\s*[:=]\s*["'][^"'\s]{16,}["']/gi,
];

/** Replaces each secret shape with `[redacted]`. Other text stays. The input is not modified. */
export function redactSecretShapes(text: string): string {
  let out = text;
  for (const pattern of SECRET_SHAPES) {
    out = out.replace(new RegExp(pattern.source, pattern.flags), '[redacted]');
  }
  return out;
}
