// provider-mark-sets.ts — the built-in providers by their mark standing: the ids that carry a
// mark and the ids that are markless by record (P-25a — the vendor ships no mark file, and a mark
// is never redrawn, so `mark: null` is their honest state). The layout audit reads these lists to
// tell a markless provider's badge from an id the defs do not know at all, and the marks test
// pins them against BUILTIN_PROVIDER_DEFS. Dependency-free on purpose: the audit runs under
// plain node, which cannot follow the extensionless TS imports the defs themselves use.
// With the launch set (P-47) every built-in carries a mark, so the markless list is empty — it
// stays an explicit list, and a provider added later without a mark file has to be named here.
export const MARKED_PROVIDER_IDS: readonly string[] = [
  'claude-code',
  'codex',
  'agy',
  'copilot',
  'cursor',
  'opencode',
];

export const MARKLESS_PROVIDER_IDS: readonly string[] = [];
