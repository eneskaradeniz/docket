// DetailBody (WO-0031c / v4 → WO-0031f v6) — the console's content row, content-aware in BOTH axes:
//
//   view mode (the global SADE|DETAY) — SADE shows the flow's decision cards + the single calm
//   instrument (one phase line); DETAY shows the full flow (decision cards + the step spine with
//   the live terminal in the driven row) and the record.
//
//   width (useDetailLayout) — DETAY ≥1080 is a two-column grid whose right column IS Kayıt (the
//   rack: no tabs — "≥1080'de sekme hiç yoktu zaten"); below it exactly TWO tabs, Akış | Kayıt
//   (v6 Y-3), both forceMount so the xterm canvas — and its scrollback — survives switches behind
//   the kit's display-based hiding (the container ResizeObserver refits on return).
//
//   archive — a closed work order renders ONE column at every width: the flow (the closure card)
//   over the full record stack. No tabs, no rack (v6 §03 — the archive body is Kayıt itself).
//
// The controller composes `flow` (mode-aware: decision + instrument card and/or the spine) and
// `record` (the RecordStack); this component only decides WHERE they sit.
import type { ReactNode } from 'react';
import { useDetailLayout } from './useDetailLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../kit';
import { UI } from '../../data/labels';

export function DetailBody({
  viewMode,
  tab,
  onTabChange,
  flow,
  flowAside,
  record,
  recordAside,
  archive,
}: {
  viewMode: 'sade' | 'detail';
  /** The controlled tab (tur-2 A7: the substrip's adım N/T jump drives it). */
  tab: string;
  onTabChange: (v: string) => void;
  /** Akış — decision cards + (the instrument card and/or the step spine), composed by the controller. */
  flow: ReactNode;
  /** The Akış tab count (done/total steps); absent before a plan has steps (absent, never "0/0"). */
  flowAside?: string;
  /** Kayıt — the one record stack (kanıt chips · belgeler · döküm [+ kaynaklar]). */
  record: ReactNode;
  /** The Kayıt tab count (satisfied/total evidence — ever-present by model). */
  recordAside: string;
  /** A closed WO — one column, the record IS the body (v6 §03). */
  archive?: boolean;
}) {
  const layout = useDetailLayout();

  if (archive) {
    return (
      <div className="flex min-w-0 flex-col gap-3.5">
        {flow}
        {record}
      </div>
    );
  }

  if (viewMode === 'sade') {
    return <div className="flex flex-col gap-4">{flow}</div>;
  }

  if (layout === 'rack') {
    return (
      // The columns are unconditional: this tree only renders when useDetailLayout says ≥1080 (the JS
      // switch is the single source of the breakpoint — no Tailwind `lg:` racing a second threshold).
      <div className="grid min-h-0 items-start grid-cols-[minmax(0,1fr)_250px] gap-x-3.5 gap-y-4">
        <div className="flex min-w-0 flex-col gap-3.5">{flow}</div>
        <div className="rack min-w-0">{record}</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col gap-3.5">
      <Tabs value={tab} onValueChange={onTabChange} className="min-h-0">
        {/* v6 Y-3 / S1-C: two tabs, the signal underline, the active count info-toned — the six-tab
            world is gone; every old surface has its written home (the v6 §04 yuva tablosu). */}
        <TabsList className="flowtabs">
          <TabsTrigger value="flow" className="flowtab">
            {UI.secFlow}
            {flowAside ? <span className="flowtab-n">{flowAside}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="record" className="flowtab">
            {UI.secRecord}
            <span className="flowtab-n">{recordAside}</span>
          </TabsTrigger>
        </TabsList>
        {/* forceMount on both panels: the xterm canvas in the spine's driven row survives a Kayıt
            switch (scrollback intact); the kit's TabsContent hides the inactive panel. The ids anchor
            the N/T jump and the tab-selection scroll. panel-glide: the entering panel glides in once
            (H-3 — the r7 exception; display-based hiding restarts it without a remount). */}
        <TabsContent value="flow" forceMount className="panel-glide mt-3" id="sec-flow">
          {flow}
        </TabsContent>
        <TabsContent value="record" forceMount className="panel-glide mt-3" id="sec-record">
          {record}
        </TabsContent>
      </Tabs>
    </div>
  );
}
