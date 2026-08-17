// InviteHero (WO-0031d / ADR-0012 r2) — the empty surface as an invitation: ONE short line, ONE
// action, nothing else. No buckets, no dashed boxes, no explaining paragraph — the first empty
// state (no workspace) and the second (no work orders yet) share it with different CTAs.
import { UI } from '../data/labels';
import { Button } from '../kit';

export function InviteHero({ cta, onCta }: { cta: string; onCta: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
      <span className="h-2 w-2 rounded-full bg-signal" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-ink">{UI.inviteFirstWo}</p>
      <Button variant="primary" size="sm" onClick={onCta}>
        {cta}
      </Button>
    </div>
  );
}
