// src/ui/data/labels/index.ts — the vocabulary seam's public face (WO-0035). Re-exports the locale
// bundles, the derived Labels type, and the locale-invariant marks — and DELIBERATELY NOT any word
// member (UI, *_LABELS, the composers): components read words only through useLabels()
// (src/ui/data/locale.tsx), so a static word import fails to compile. That failure is the point —
// the compiler drives the migration and keeps it complete. ADR-0007: every fixed UI string lives in
// this module.
import type { Locale } from '../../../core/app-settings';
import tr from './tr';
import en from './en';
import type { Labels } from './tr';

export { tr, en };
export type { Labels };
export { STEP_MARK, VERDICT_MARK, GUTTER_TOOL, GUTTER_RESULT } from './marks';

export const LABEL_BUNDLES: Record<Locale, Labels> = { tr, en };
