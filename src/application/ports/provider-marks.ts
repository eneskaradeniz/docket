// ports/provider-marks.ts — the providers' marks as one static record: def id → the provider's
// own mark, null when it has none. A port only because the api layer must not reach the defs
// itself; the source is composed beside AppDeps and passed to createApi (the discovery pattern).
/** One provider's mark: a single SVG path plus the viewBox it was drawn for, rendered with
 *  `currentColor` so it follows the theme. The marks identify the provider only and travel
 *  unmodified from the provider's own official file. */
export interface ProviderMark {
  readonly viewBox: string;
  readonly path: string;
}

export interface ProviderMarks {
  /** Every composed provider def's mark, keyed by def id; `null` marks a provider without one. */
  marks(): Record<string, ProviderMark | null>;
}
