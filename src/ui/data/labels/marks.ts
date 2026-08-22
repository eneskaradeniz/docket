// src/ui/data/labels/marks.ts — locale-INVARIANT glyphs (WO-0035). A mark is not a word: ✓ ► ○ ⊘ ↻
// carry no language, so they live outside the per-locale bundles — duplicating them per bundle would
// invite drift for nothing. The words for the same surfaces (STEP_STATUS_LABELS) live in tr.ts/en.ts.
import type { StepStatus } from '../../../core/types';

// Plan adımları (WO-0017). Durum etiketi + işaretçi (mock'taki ✓/►/○/⊘).
export const STEP_MARK: Record<StepStatus, string> = {
  done: '✓',
  active: '►',
  pending: '○',
  blocked: '⊘',
};

// Mimar karar işareti — done adımın yanında (WO-0020).
export const VERDICT_MARK: Record<'proceed' | 'revise', string> = {
  proceed: '✓',
  revise: '↻',
};

// WO-0037 Ray — the transcript gutter's type glyphs (▸ a tool call, · its result). They mark the
// ENTRY TYPE in the left gutter, the way ✓/► mark step status; the words for the same rows
// (toolLabel) live in the bundles.
export const GUTTER_TOOL = '▸';
export const GUTTER_RESULT = '·';
