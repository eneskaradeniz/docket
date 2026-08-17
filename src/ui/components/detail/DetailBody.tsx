// DetailBody (WO-0031c / v4) — the console's content row, content-aware in BOTH axes:
//
//   view mode (the global SADE|DETAY) — SADE shows the decision cards + the single instrument
//   (one calm phase line); DETAY shows the full instrument (terminal) plus every section.
//
//   width (useDetailLayout) — DETAY ≥1080 is a two-column grid with the 250px rack; below it the
//   sections become TABS with the instrument as the first peer (Radix forceMount keeps the xterm
//   instance — and its scrollback — alive behind the hidden panels; the container ResizeObserver
//   refits on return).
//
// Decision surfaces (ask cards, close/verdict/plan-approval cards, the report reader) render ABOVE
// the instrument/tabs in every mode — the amber moment outranks everything (v4: "ask cards pinned
// first").
import type { ReactNode } from 'react';
import type { DetailSection } from './DetailSections';
import { SectionStack } from './DetailSections';
import { useDetailLayout } from './useDetailLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../kit';
import { UI } from '../../data/labels';

export function DetailBody({
  viewMode,
  tab,
  onTabChange,
  decision,
  instrument,
  sections,
}: {
  viewMode: 'sade' | 'detail';
  /** The controlled tab (tur-2 A7: the substrip's adım N/T jump drives it). */
  tab: string;
  onTabChange: (v: string) => void;
  decision: ReactNode;
  instrument: ReactNode;
  sections: DetailSection[];
}) {
  const layout = useDetailLayout();

  if (viewMode === 'sade') {
    return (
      <div className="flex flex-col gap-4">
        {decision}
        {instrument}
      </div>
    );
  }

  if (layout === 'rack') {
    return (
      // The columns are unconditional: this tree only renders when useDetailLayout says ≥1080 (the JS
      // switch is the single source of the breakpoint — no Tailwind `lg:` racing a second threshold).
      <div className="grid min-h-0 items-start grid-cols-[minmax(0,1fr)_250px] gap-x-3.5 gap-y-4">
        <div className="flex min-w-0 flex-col gap-3.5">
          {decision}
          {instrument}
        </div>
        <SectionStack sections={sections} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3.5">
      {decision}
      <Tabs value={tab} onValueChange={onTabChange} className="min-h-0">
        <TabsList>
          <TabsTrigger value="instrument">{UI.secTerminal}</TabsTrigger>
          {sections.map((s) => (
            <TabsTrigger key={s.id} value={s.id}>
              {s.title}
              {s.aside ? <span className="ml-1 font-mono text-[10px] text-inkdim/70">{s.aside}</span> : null}
            </TabsTrigger>
          ))}
        </TabsList>
        {/* forceMount on every panel: the xterm canvas survives tab switches (scrollback intact);
            the kit's TabsContent hides inactive panels (tur-2 A2). The ids anchor the N/T jump and
            the tur-3 selection scroll. */}
        <TabsContent value="instrument" forceMount className="mt-3" id="sec-instrument">
          {instrument}
        </TabsContent>
        {sections.map((s) => (
          <TabsContent key={s.id} value={s.id} forceMount className="mt-3" id={`sec-${s.id}`}>
            {s.node}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
