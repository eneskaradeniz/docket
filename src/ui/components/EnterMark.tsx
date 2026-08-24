// EnterMark (WO-0039) — the ONE ⏎ badge, ADR-0012's single standing keyboard exception restated for
// the rail-free console: it marks the screen's CURRENT primary wherever it lives (the decision band's
// Onayla, the editor's Bitti, the pane header's ▶ Sürdür, the fail card's Yeniden dene, the empty
// state's Plan iste). One per screen; never on Kapat (deliberate friction on the irreversible), never
// while an ask is pending. The glyph is locale-invariant (marks.ts kin) — not bundle copy.
export function EnterMark() {
  return (
    <span
      aria-hidden="true"
      className="ml-1.5 rounded border border-current px-1 font-mono text-[9.5px] leading-[1.35] opacity-55"
    >
      ⏎
    </span>
  );
}
