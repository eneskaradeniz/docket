// InviteHero (WO-0031d / ADR-0012 r2) — the empty surface as an invitation: ONE short line, ≤1
// action, nothing else. No buckets, no dashed boxes, no explaining paragraph — the first empty
// state (no workspace) and the second (no work orders yet) share it with their OWN line + CTA: the
// line must name what the button creates (WO-0032 operator finding — the zero-WO line sat over the
// create-workspace button on an empty DB). WO-0049: `cta` became optional and an `info` line joined
// it — the roadmap's absent surface carried the line + where the file would live (the ✦ action
// was WO-0050's). WO-0050: that one action arrived — the ✦ draft gate in its signal tone (mockup
// kare 03); `ctaVariant` keeps the other invitations on primary.
import { Button } from '../kit';

export function InviteHero({
  line,
  info,
  cta,
  onCta,
  ctaVariant = 'primary',
}: {
  line: string;
  info?: string;
  cta?: string;
  onCta?: () => void;
  ctaVariant?: 'primary' | 'signal';
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6">
      <span className="h-2 w-2 rounded-full bg-signal" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-ink">{line}</p>
      {info !== undefined ? <p className="font-mono text-[11px] text-inkdim">{info}</p> : null}
      {cta !== undefined && onCta !== undefined ? (
        <Button variant={ctaVariant} size="sm" onClick={onCta}>
          {cta}
        </Button>
      ) : null}
    </div>
  );
}
