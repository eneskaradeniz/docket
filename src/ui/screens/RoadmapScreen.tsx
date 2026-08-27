// RoadmapScreen (WO-0049, mockup kare 01/02/03/06/07; WO-0050 kare 03/04/05) — the sibling
// surface: AppShell's `Pano | Yol Haritası` switch lands here. The board's column (840px, one
// vertical read). The three faces of RoadmapView: absent → the invitation + the file line + the
// ✦ gate (WO-0050 — the empty surface's ONE action); invalid → the named reasons (never silent
// empty — the WO-0048 gate; no ✦: fix the file by hand); ready → the head meta (ALL observed
// spend — the WO layer's figure, the draft's own cost is its pane — operator ruling 2026-08-27),
// the strip, the collapsed past (≥2 done fazlar), the cards, and the footer pair (`+ Faz ekle`
// left, ✦ right — kare 01).
//
// WO-0050 — the surface's LIVE half, above every face (band-adjacent, ADR-0013's 2026-08-27
// addendum): RoadmapPane (the WO-less draft session, pane-chrome grammar) → the ask cards → the
// derived question card → the TASLAK decision card. The pane unmounts with the surface; the
// drive lives in the app-level store and the head meta says `taslak sürüyor` while it runs.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { initialSessionState, seedLiveState } from '../../core/runner';
import { draftSummaryOf } from '../../core/roadmap-draft';
import type { WorkOrderId, Workspace } from '../../core/types';
import type { RoadmapView } from '../../core/roadmap';
import type { RoadmapDraft, WorkOrderSource } from '../../core/source';
import { useLabels } from '../data/locale';
import { Button, Textarea } from '../kit';
import { InviteHero } from '../components/InviteHero';
import { FazStrip } from '../components/roadmap/FazStrip';
import { FazCard } from '../components/roadmap/FazCard';
import { DoneFold } from '../components/roadmap/DoneFold';
import { FazAddDialog } from '../components/roadmap/FazAddDialog';
import { TaskAddDialog } from '../components/roadmap/TaskAddDialog';
import { RoadmapPane } from '../components/roadmap/RoadmapPane';
import { RoadmapDraftDialog } from '../components/roadmap/RoadmapDraftDialog';
import { RoadmapDraftCard } from '../components/roadmap/RoadmapDraftCard';
import type { WoSpawnPrefill } from '../components/roadmap/TaskRow';
import { useDrive, useDriveStore } from '../components/session/drive-store';
import { StopAndAskCard } from '../components/session/StopAndAskCard';
import { BudgetRefusalCard } from '../components/detail/BudgetRefusalCard';

export function RoadmapScreen({
  view,
  workspace,
  docsRoot,
  source,
  draft,
  onSpawn,
  onOpenWo,
  onRefresh,
  onRaiseBudget,
  budgetHasUnknown = false,
}: {
  view: RoadmapView | undefined; // undefined = the read is in flight
  workspace: Workspace;
  /** The effective structure root — names the file on the invitation surface. */
  docsRoot: string;
  source: WorkOrderSource;
  /** The workspace's pending ✦ proposal (WO-0050) — null = no draft. */
  draft: RoadmapDraft | null;
  onSpawn: (prefill: WoSpawnPrefill) => void;
  onOpenWo: (id: WorkOrderId) => void;
  onRefresh: () => void;
  /** The budget refusal card's raise (WO-0047 wiring — a permanent settings write). */
  onRaiseBudget: (capUsd: number) => Promise<void>;
  /** The workspace's month read carries no cost claim (the known-spend qualifier, WO-0047). */
  budgetHasUnknown?: boolean;
}) {
  const { ROADMAP_DIAGNOSTIC_LABELS, UI } = useLabels();
  const driveStore = useDriveStore();
  // The add-dialog pair is local: the screen unmounts on surface/detail switches, so a dialog can
  // never outlive its faz (a mid-save surface switch unmounts the dialog; saveRoadmap's guard still
  // refuses before any byte if the race lands).
  const [fazAddOpen, setFazAddOpen] = useState(false);
  const [taskAddFor, setTaskAddFor] = useState<string | undefined>(undefined);
  const [draftOpen, setDraftOpen] = useState(false);
  const [replyText, setReplyText] = useState('');
  // The strip's jump targets — the card refs, one per faz; scrollIntoView honors reduced-motion.
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const setCardEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el === null) cardEls.current.delete(id);
    else cardEls.current.set(id, el);
  }, []);
  const jumpTo = useCallback((fazId: string) => {
    cardEls.current.get(fazId)?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  // --- the live half (WO-0050): the draft drive's fold, bound to THIS surface ---
  const draftKey = `${workspace.id}:draft`;
  // The persisted draft session row is the fold's seed (an İtiraz after a restart appends to the
  // row's transcript instead of opening blank — the SessionPane F14 precedent). The seed RESULT
  // is memoized — a fresh object per getSnapshot call loops React (#185, the StepPane precedent).
  const seedState = useMemo(
    () => (draft?.session !== undefined ? seedLiveState(draft.session) : initialSessionState),
    [draft],
  );
  const seedFn = useCallback(() => seedState, [seedState]);
  const draftState = useDrive(driveStore, draftKey, seedFn);
  const draftRunning = driveStore.get(draftKey)?.running ?? false;
  // The ONE ticker (the live costline's elapsed) — the WorkOrderDetail precedent, pane-local.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!draftRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [draftRunning]);

  // D13 — permission asks on THIS surface: the plan-context voice (an architect ask reads as
  // intent, not alarm); no diffPeek (WO-keyed) and no onAlwaysAuto (no order.md to persist into).
  const allow = (requestId: string): void => void driveStore.decide(requestId, { allow: true });
  const deny = (requestId: string): void => void driveStore.decide(requestId, { allow: false, reason: 'Denied by operator' });
  const askCards =
    draftState.status === 'stopped_asking' && draftState.pendingAsks.length > 0 ? (
      <div className="flex flex-col gap-2" data-draft-asks>
        {draftState.pendingAsks.map((ask) => (
          <StopAndAskCard
            key={ask.requestId}
            tool={ask.tool}
            input={ask.input}
            reason={ask.reason}
            planContext
            onAllow={() => allow(ask.requestId)}
            onDeny={() => deny(ask.requestId)}
          />
        ))}
      </div>
    ) : null;

  // D13 — the derived question card (the SessionPane derivation, lifted to this surface): a plan
  // turn that ended without a proposal but with assistant text is the architect asking. The
  // start's refusal keeps the answer text (the one-drive rule made visible — review f1).
  const [replyBusy, setReplyBusy] = useState(false);
  const lastAssistant = [...draftState.entries].reverse().find((e) => e.speaker === 'assistant');
  const showQuestion = draftState.status === 'done' && !draftState.pendingPlan && !!lastAssistant;
  const reply = (answer: string): void => {
    if (!draftState.sessionId) return;
    const ok = driveStore.start(
      draftKey,
      {
        role: 'architect',
        workspaceId: workspace.id,
        mode: 'plan',
        prompt: answer,
        goalNote: '',
        docPaths: [],
        resume: draftState.sessionId,
      },
      draftState,
    );
    if (!ok) {
      setReplyBusy(true);
      return;
    }
    setReplyBusy(false);
    setReplyText('');
  };

  // WO-0047's two-choice card, draft-armed (D4): the refusal folds its facts on the draft's error;
  // raise persists the cap (App's write) then re-issues the SAME draft input; keep dismisses
  // per-mount (the standing refusal line on the pane carries the reason).
  const [budgetKept, setBudgetKept] = useState(false);
  const [raiseBusy, setRaiseBusy] = useState(false);
  useEffect(() => {
    if (draftState.lastRefusal) setBudgetKept(false);
  }, [draftState.lastRefusal]);
  const raiseBudget = async (capUsd: number): Promise<void> => {
    setRaiseBusy(true);
    try {
      await onRaiseBudget(capUsd);
      driveStore.restart(draftKey);
    } finally {
      setRaiseBusy(false);
    }
  };
  const refusalCard =
    draftState.lastRefusal && !draftRunning && !budgetKept ? (
      <BudgetRefusalCard
        observedUsd={draftState.lastRefusal.observedUsd}
        capUsd={draftState.lastRefusal.capUsd}
        hasUnknown={budgetHasUnknown}
        busy={raiseBusy}
        onRaise={(cap) => void raiseBudget(cap)}
        onKeep={() => setBudgetKept(true)}
      />
    ) : null;

  // The live half mounts when THIS renderer has a fold for the draft (a running or ended drive
  // this session); a restart with no fold shows only the CARD (D12 — the drive died with the app).
  // The pane stands down while the refusal card owns the moment (the WorkOrderDetail instrument
  // selector's rule: budget-refusal open → no instrument).
  const paneExists = driveStore.get(draftKey) !== undefined && draftState.lastRefusal === undefined;
  // The CARD renders from the ROW alone (a restart's pending proposal has no fold — D12), so it
  // gates liveHalf by itself; the pane/ask/question/refusal members gate it on their own.
  const liveHalf = paneExists || askCards !== null || showQuestion || refusalCard !== null || draft !== null ? (
    <div className="flex flex-col gap-2">
      {paneExists ? <RoadmapPane workspaceId={workspace.id} seed={seedFn()} now={now} /> : null}
      {askCards}
      {refusalCard}
      {showQuestion && lastAssistant ? (
        <div className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-raised/40">
          <div className="lamp lamp-signal" />
          <div className="flex-1 px-3.5 py-3">
            <p className="readout text-signal">{UI.roadmapDraftAskToast}</p>
            <p className="mb-2 text-[14px] text-ink">{lastAssistant.text}</p>
            <div className="flex flex-col gap-2">
              <Textarea
                value={replyText}
                onChange={(e) => { setReplyText(e.target.value); setReplyBusy(false); }}
                rows={2}
                placeholder={UI.replyPlaceholder}
                className="font-sans text-[13px]"
              />
              {replyBusy ? <p role="alert" className="self-end text-[11.5px] text-error">{UI.roadmapDraftBusy}</p> : null}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => reply('Bilmiyorum, kendin karar ver.')}>{UI.skipReply}</Button>
                <Button variant="primary" size="sm" onClick={() => reply(replyText.trim() || 'Devam et.')}>{UI.reply}</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {draft !== null ? (
        <RoadmapDraftCard
          draft={draft}
          workspace={workspace}
          docsRoot={docsRoot}
          source={source}
          superseded={
            draftState.pendingPlan !== undefined && 'parseError' in draftSummaryOf(draftState.pendingPlan)
          }
          onApproved={onRefresh}
          onSaved={onRefresh}
        />
      ) : null}
    </div>
  ) : null;

  let body;
  if (view === undefined) {
    body = <p className="loadline px-1 py-8">{UI.roadmapReading}</p>;
  } else if (view.kind === 'absent') {
    body = (
      <>
        {liveHalf}
        <InviteHero
          line={UI.roadmapInviteLine}
          info={UI.roadmapInviteFile(docsRoot)}
          cta={UI.roadmapDraftAction}
          onCta={() => setDraftOpen(true)}
          ctaVariant="signal"
        />
      </>
    );
  } else if (view.kind === 'invalid') {
    body = (
      <>
        {liveHalf}
        <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6">
          <p className="text-[15px] font-semibold text-ink">{UI.roadmapInvalidLine}</p>
          <ul className="flex flex-col items-start gap-1">
            {view.reasons.map((d, i) => (
              <li key={i} className="font-mono text-[11.5px] text-inkdim">— {ROADMAP_DIAGNOSTIC_LABELS[d.code](d.detail)}</li>
            ))}
          </ul>
        </div>
      </>
    );
  } else {
    const done = view.fazlar.filter((f) => f.status === 'tamam');
    const live = view.fazlar.filter((f) => f.status !== 'tamam');
    const card = (f: (typeof view.fazlar)[number]) => (
      <FazCard
        key={f.id}
        faz={f}
        allFazlar={view.fazlar}
        siradakiTaskId={view.siradaki !== undefined && view.siradaki.fazId === f.id ? view.siradaki.taskId : undefined}
        cardRef={(el) => setCardEl(f.id, el)}
        onSpawn={onSpawn}
        onOpenWo={onOpenWo}
        onAddTask={(fazId) => setTaskAddFor(fazId)}
      />
    );
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="readout text-ink">{view.head.title}</h1>
          <span className="font-mono text-[11px] text-inkdim" data-roadmap-head-meta>
            {draftRunning
              ? UI.roadmapDraftRunning
              : view.head.costUnknown
                ? UI.roadmapHeadMetaKnown(view.head.doneFazCount, view.head.totalFazCount, view.head.openWoCount, view.head.totalCostUsd)
                : UI.roadmapHeadMeta(view.head.doneFazCount, view.head.totalFazCount, view.head.openWoCount, view.head.totalCostUsd)}
          </span>
        </div>
        {liveHalf}
        <FazStrip fazlar={view.fazlar} onJump={jumpTo} />
        {done.length >= 2 ? (
          <DoneFold done={done}>{done.map(card)}</DoneFold>
        ) : null}
        {(done.length < 2 ? done : []).map(card)}
        {live.map(card)}
        <div className="mt-1 flex items-center justify-between">
          <Button variant="ghost" size="sm" data-faz-add onClick={() => setFazAddOpen(true)}>
            {UI.roadmapFazAdd}
          </Button>
          <Button variant="signal" size="sm" data-draft-open onClick={() => setDraftOpen(true)}>
            {UI.roadmapDraftAction}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main data-roadmap-screen className="mx-auto w-full max-w-[840px] px-5 py-5">
      {body}
      {draftOpen ? <RoadmapDraftDialog workspaceId={workspace.id} onClose={() => setDraftOpen(false)} /> : null}
      {fazAddOpen && view !== undefined && view.kind === 'ready' ? (
        <FazAddDialog
          workspace={workspace}
          source={source}
          fazlar={view.fazlar}
          onClose={() => setFazAddOpen(false)}
          onSaved={onRefresh}
        />
      ) : null}
      {taskAddFor !== undefined && view !== undefined && view.kind === 'ready' ? (
        (() => {
          const faz = view.fazlar.find((f) => f.id === taskAddFor);
          return faz !== undefined ? (
            <TaskAddDialog
              workspace={workspace}
              source={source}
              faz={faz}
              onClose={() => setTaskAddFor(undefined)}
              onSaved={onRefresh}
            />
          ) : null;
        })()
      ) : null}
    </main>
  );
}
