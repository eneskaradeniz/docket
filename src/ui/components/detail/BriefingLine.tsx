import type { BriefingCheck } from '../../../core/source';
import { useLabels } from '../../data/locale';
import { Tooltip } from '../../kit';

// WO-0090 — the pre-drive briefing line: order.md's `path:line` pointers that resolve at NO
// checked repo sha (each root at its HEAD — the sha a fresh drive starts from) speak BEFORE the
// drive, in the decision stack. SURFACE, never a block — a briefing may legitimately name a file
// the work will create, so nothing is refused; the line only states the miss. Grammar is
// DegradedLine's (WO-0078): the visible line speaks operator words + the FIRST pointer + the
// repo@sha it was checked at (acceptance: the check names its sha); the full pointer list and the
// FULL shas ride the tooltip. Signal tone — a stale briefing is a judgment call, not a machine
// stop (red). The absent faces render NOTHING here: zero pointers, all-resolving, no checkable
// repo — never a standing zero (WO-0053's rule); the caller gates live drives and closed WOs out.
export function BriefingLine({ check }: { check: BriefingCheck }) {
  const { UI } = useLabels();
  const first = check.unresolved[0]!;
  const rest = check.unresolved.length - 1;
  const shortAt = check.repos.map((r) => `${r.repo}@${r.sha.slice(0, 7)}`).join(' · ');
  const fullAt = check.repos.map((r) => `${r.repo}@${r.sha}`).join(' · ');
  const tip = `${UI.briefingStaleAt(fullAt)} — ${check.unresolved.join(' · ')}`;
  return (
    <Tooltip label={tip}>
      <p data-briefing-stale className="truncate font-mono text-[10.5px] text-signal">
        {UI.briefingStaleLead} — {first}
        {rest > 0 ? ` ${UI.briefingStaleMore(rest)}` : ''} · {shortAt}
      </p>
    </Tooltip>
  );
}
