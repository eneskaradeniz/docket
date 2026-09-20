// src/core/humanize.ts — WO-0078: adapter diagnostics never speak on the surface (operator
// ruling, atelier review 2026-09-20). A degraded reason stays VERBATIM in the record layer — the
// observation rows and events keep their data (Records & PRs) — while the UI classifies the
// common shapes into a label key and carries the raw text as the tooltip's hint. Classification
// only: this module never rewrites or echoes the reason itself.
export type DegradedKind = 'unparseable-remote' | 'not-git' | 'tool-missing' | 'unknown';

export function degradedKind(reason: string): DegradedKind {
  if (/unparseable remote/i.test(reason)) return 'unparseable-remote';
  if (/not a git repository/i.test(reason)) return 'not-git';
  if (/ENOENT/i.test(reason)) return 'tool-missing';
  return 'unknown';
}
