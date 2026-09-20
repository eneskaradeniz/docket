// RoadmapDraftCard (WO-0050, mockup kare 05) — the TASLAK DECISION CARD, the plan approval card's
// sibling. Parse edilmiş önizleme (ham markdown değil — kart dili): draftSummaryOf'un sayıları +
// faz başına satırlar (fazLabel ile — ham id asla, ADR-0007 eki). Geçersiz taslakta önizleme
// absent + adlandırılmış tanı satırı + ONAYLA ABSENT (parse-koruma onay sınırında yaşar, ADR-0001)
// — İtiraz kalır (bir çitsiz taslak yapısal olarak düzenlenemez). Onayla = approveRoadmapDraft
// (parse-koruma + yaz + bayt-özdeş yeniden okuma + satır silme, tek çağrı); commit operatörün.
// İtiraz = tek satır not + resume: mimar AYNI oturuma notunla döner.
//
// Düzenle (operator ruling 2026-08-27: the STRUCTURED stage) — the card's rows turn into the
// editor: faz başlıkları, blockedBy çipleri, görev başlıkları + depo çipleri, ekle/sil.
// applyFazlarEdits çit dışı her baytı korur; Bitti = updateRoadmapDraft (parse-korumalı satır
// yazımı — operator eylemi yükseltmeden reddedilir).
import { useState, type ReactNode } from 'react';
import { draftSummaryOf } from '../../../core/roadmap-draft';
import { applyFazlarEdits, nextFazId, nextTaskId, parseRoadmapMd, type FazSpec } from '../../../core/roadmap-md';
import type { RoadmapDraft, WorkOrderSource } from '../../../core/source';
import type { Workspace, WorkspaceId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { toast } from '../../chrome/ToastHost';
import { Button, Dialog, Input, Textarea, cn } from '../../kit';
import { EnterMark } from '../EnterMark';
import { seedLiveState, initialSessionState } from '../../../core/runner';
import { useDriveStore } from '../session/drive-store';
import { PaneLogChip, usePaneLog } from '../session/pane-chrome';
import { ChatTranscript } from '../session/ChatTranscript';

export function RoadmapDraftCard({
  draft,
  workspace,
  docsRoot,
  source,
  superseded,
  resumeLocked,
  onApproved,
  onSaved,
}: {
  draft: RoadmapDraft;
  workspace: Workspace;
  /** The effective structure root — the summary's "where it will live" tail. */
  docsRoot: string;
  source: WorkOrderSource;
  /** The drive's LAST proposal could not be read while the pending row is valid — the supersede
   *  guard kept the prior draft (the honest line; the screen computes it from the live fold). */
  superseded?: boolean;
  /** A limit stamp still in the future (the screen's draftLimitWaiting) — the unreadable state's
   *  Sürdür waits with it, the kit's attribute-free lock (WO-0053 round-2 register). */
  resumeLocked?: boolean;
  /** Onayla landed: the screen refreshes to the ready face. */
  onApproved: () => void;
  /** Düzenle's Bitti wrote the row: the screen re-reads the draft. */
  onSaved: () => void;
}) {
  const { ROADMAP_DIAGNOSTIC_LABELS, UI, fazLabel, formatUsd } = useLabels();
  const store = useDriveStore();
  const [busy, setBusy] = useState(false);
  const [objectOpen, setObjectOpen] = useState(false);
  const [objectText, setObjectText] = useState('');
  const wsId: WorkspaceId = workspace.id;
  const driveKey = `${wsId}:draft`;

  // TD-057 (WO-0051): the drive is over, the pane is gone — the card's Dökümü aç/kapat is the
  // ONE window into the ✦ session (default closed; the same pane-chrome grammar + scroll
  // contract — opening brings the card's head to reading position). Only when a session row
  // exists; a draft with no session has nothing to open.
  const { logOpen, toggleLog, headRef } = usePaneLog();
  const session = draft.session;

  // --- the Düzenle stage ---
  const [editOpen, setEditOpen] = useState(false);
  const [editFazlar, setEditFazlar] = useState<FazSpec[]>([]);
  const [editErr, setEditErr] = useState<string | undefined>(undefined);

  const summary = draftSummaryOf(draft.md);
  const parsed = parseRoadmapMd(draft.md);
  const invalid = 'parseError' in summary;

  const approve = (): void => {
    if (busy) return; // in-flight guard (ADR-0001 posture — the click is a no-op, never a locked control)
    setBusy(true);
    void source.approveRoadmapDraft(wsId).then(() => {
      setBusy(false);
      onApproved();
    }).catch(() => {
      // A save failure toasts top-right (ADR-0012) — the guard's refusal or the write; nothing moved.
      setBusy(false);
      toast.push({ kind: 'error', title: UI.roadmapDraftApproveFailed(UI.saveFailed) });
    });
  };

  // İtiraz et: the objection rides a RESUME of the same provider session (the row's handle). The
  // pane seeds from the draft session row — the stream appends to what already happened. The
  // start's refusal (the one-drive-at-a-time rule) KEEPS the composer + the note — a refusal the
  // operator cannot see is a lost note (the ✦ dialog's rule, plan R2).
  const [objectBusy, setObjectBusy] = useState(false);
  const object = (): void => {
    if (!draft.providerSessionId || !objectText.trim()) return;
    const seed = draft.session !== undefined ? seedLiveState(draft.session) : initialSessionState;
    const ok = store.start(
      driveKey,
      {
        role: 'architect',
        workspaceId: wsId,
        mode: 'plan',
        prompt: objectText.trim(),
        goalNote: '',
        docPaths: [],
        resume: draft.providerSessionId,
      },
      seed,
    );
    if (!ok) {
      setObjectBusy(true);
      return;
    }
    setObjectOpen(false);
    setObjectText('');
  };

  const openEditor = (): void => {
    setEditFazlar(parsed.fazlar.map((f) => ({ ...f, tasks: f.tasks.map((t) => ({ ...t })) })));
    setEditErr(undefined);
    setEditOpen(true);
  };

  // Dogfood 2026-08-29 (the 04:16 antreo 429 death's aftermath): an UNREADABLE draft has no
  // proposal to object to — İtiraz et was the wrong word AND the wrong demand (a required note
  // for a pure retry). The invalid state's actions are SÜRÜDÜR (a no-note resume of the same
  // provider session — prompt: '' + resume, the pipeline fills the standing draft prompt) and
  // SIL (discard the pending row outright; the next ✦ starts from scratch). Locked while a
  // limit stamp holds (resumeLocked); when the row carries no session there is nothing to
  // resume — the reason line names the fresh-✦ path.
  const [resumeBusy, setResumeBusy] = useState(false);
  const resumeDraft = (): void => {
    if (busy || resumeLocked || !draft.providerSessionId) return;
    const seed = draft.session !== undefined ? seedLiveState(draft.session) : initialSessionState;
    const ok = store.start(
      driveKey,
      {
        role: 'architect',
        workspaceId: wsId,
        mode: 'plan',
        prompt: '',
        goalNote: '',
        docPaths: [],
        resume: draft.providerSessionId,
      },
      seed,
    );
    if (!ok) {
      setResumeBusy(true); // the one-drive refusal keeps the button + names itself (the object rule)
      return;
    }
    setResumeBusy(false);
  };
  const discardDraft = (): void => {
    if (busy) return;
    setBusy(true);
    void source.discardRoadmapDraft(wsId).then(() => {
      setBusy(false);
      onSaved(); // the re-read finds no row — the card leaves, the screen is fresh-✦ territory
    }).catch(() => {
      setBusy(false);
      toast.push({ kind: 'error', title: UI.roadmapDraftDiscardFailed(UI.saveFailed) });
    });
  };
  // the operator's round 2: Sil CONFIRMS — the discard is a scratch-start decision, the dialog
  // names exactly what dies (the pending row) and what stays (the file, the session history)
  const [discardOpen, setDiscardOpen] = useState(false);

  const patchFaz = (idx: number, patch: Partial<FazSpec>): void => {
    setEditFazlar((prior) => prior.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };
  const addFaz = (): void => {
    setEditFazlar((prior) => [...prior, { id: nextFazId(prior), title: '', blockedBy: [], tasks: [] }]);
  };
  const removeFaz = (idx: number): void => {
    setEditFazlar((prior) => prior.filter((_, i) => i !== idx));
  };
  const addTask = (idx: number): void => {
    setEditFazlar((prior) =>
      prior.map((f, i) => (i === idx ? { ...f, tasks: [...f.tasks, { id: nextTaskId(f.id, prior), title: '' }] } : f)),
    );
  };
  const patchTask = (fazIdx: number, taskIdx: number, patch: Partial<FazSpec['tasks'][number]>): void => {
    setEditFazlar((prior) =>
      prior.map((f, i) => (i === fazIdx ? { ...f, tasks: f.tasks.map((t, j) => (j === taskIdx ? { ...t, ...patch } : t)) } : f)),
    );
  };
  const removeTask = (fazIdx: number, taskIdx: number): void => {
    setEditFazlar((prior) => prior.map((f, i) => (i === fazIdx ? { ...f, tasks: f.tasks.filter((_, j) => j !== taskIdx) } : f)));
  };

  // Bitti: an empty faz title holds the write (the hint line names it — validity never locks the
  // button, WO-0036). applyFazlarEdits canonicalizes ONLY the fence body; every byte outside it —
  // the architect's prose, front-matter — survives verbatim. A write refusal toasts (the row did
  // not move — the canonical body round-trips the parser, so the guard firing here is the write
  // itself, not the serialization).
  const finishEditing = (): void => {
    if (editFazlar.some((f) => !f.title.trim())) {
      setEditErr(UI.roadmapDraftEditEmptyTitle);
      return;
    }
    setEditErr(undefined);
    setBusy(true);
    void source
      .updateRoadmapDraft(wsId, applyFazlarEdits(draft.md, editFazlar))
      .then(() => {
        setBusy(false);
        setEditOpen(false);
        onSaved();
      })
      .catch(() => {
        setBusy(false);
        toast.push({ kind: 'error', title: UI.roadmapDraftEditRefused(UI.saveFailed) });
      });
  };

  const repoChip = (selected: boolean, onClick: () => void, label: string): ReactNode => (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn('ichip inline-flex items-center gap-1 rounded-md px-2 py-0.5', selected ? 'ichip-on' : '')}
    >
      <span aria-hidden="true" className={`font-mono text-[10.5px] ${selected ? 'text-info' : ''}`}>{selected ? '✓' : '○'}</span>
      <span className="font-mono text-[10.5px]">{label}</span>
    </button>
  );

  return (
    <>
    <div
      data-roadmap-draft-card
      className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm"
    >
      <div className="lamp lamp-signal" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <div ref={headRef} className="flex items-baseline justify-between gap-3">
          <p className="readout text-signal">{invalid ? UI.roadmapDraftCardHeadUnreadable : UI.roadmapDraftCardHead}</p>
          {session !== undefined ? (
            <span className="ml-auto self-center">
              <PaneLogChip open={logOpen} onToggle={toggleLog} />
            </span>
          ) : null}
        </div>
        {editOpen ? (
          <div className="mt-2 flex flex-col gap-2" data-draft-edit>
            {editFazlar.map((f, i) => {
              const others = editFazlar.filter((_, j) => j !== i);
              return (
                <div key={f.id} className="flex flex-col gap-2 rounded-md border border-hairline bg-raised/30 px-2.5 py-2">
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-inkdim">{fazLabel(f.id)}</span>
                    <Input
                      aria-label={UI.roadmapDraftEditFazTitle}
                      value={f.title}
                      onChange={(e) => patchFaz(i, { title: e.target.value })}
                      className="h-7 flex-1 font-sans text-[13px]"
                    />
                    <Button variant="ghost" size="sm" aria-label={UI.roadmapDraftFazRemoveAria(f.title || f.id)} onClick={() => removeFaz(i)}>
                      {UI.deleteWo}
                    </Button>
                  </div>
                  {others.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {others.map((o) => {
                        const on = f.blockedBy.includes(o.id);
                        return repoChip(on, () => {
                          patchFaz(i, { blockedBy: on ? f.blockedBy.filter((b) => b !== o.id) : [...f.blockedBy, o.id] });
                        }, `${fazLabel(o.id)} · ${o.title}`);
                      })}
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
                    {f.tasks.map((t, j) => (
                      <div key={t.id} className="flex flex-wrap items-center gap-1.5">
                        <Input
                          aria-label={t.title || UI.roadmapDraftTaskPlaceholder}
                          placeholder={UI.roadmapDraftTaskPlaceholder}
                          value={t.title}
                          onChange={(e) => patchTask(i, j, { title: e.target.value })}
                          className="h-7 min-w-[140px] flex-1 font-sans text-[12.5px]"
                        />
                        <div className="flex items-center gap-1">
                          {workspace.repos.map((r) => {
                            const key = r as string;
                            const on = t.repo === key;
                            return repoChip(on, () => patchTask(i, j, { repo: on ? undefined : key }), key);
                          })}
                          <Button variant="ghost" size="sm" aria-label={UI.roadmapDraftTaskRemoveAria(t.title || t.id)} onClick={() => removeTask(i, j)}>
                            {UI.deleteWo}
                          </Button>
                        </div>
                      </div>
                    ))}
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => addTask(i)}>
                      {UI.roadmapTaskAdd}
                    </Button>
                  </div>
                </div>
              );
            })}
            <Button variant="ghost" size="sm" className="self-start" onClick={addFaz}>
              {UI.roadmapFazAdd}
            </Button>
            {editErr ? <p role="alert" className="text-[12px] text-error">{editErr}</p> : null}
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEditOpen(false)}>{UI.cancel}</Button>
              <Button variant="primary" size="sm" data-draft-edit-done busy={busy} onClick={finishEditing}>
                {UI.editPlanDone}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-[13px] text-inkdim">
              {invalid
                ? UI.roadmapDraftInvalidLine
                : UI.roadmapDraftCardSummary(summary.fazCount, summary.taskCount, summary.chainCount, docsRoot)}
            </p>
            {!invalid && parsed.fazlar.length > 0 ? (
              <div className="mt-2 flex flex-col gap-1" data-draft-faz-list>
                {parsed.fazlar.map((f) => {
                  const repos = [...new Set(f.tasks.map((t) => t.repo).filter((r): r is string => r !== undefined))].join(' ');
                  return (
                    <div key={f.id} className="flex items-baseline gap-2 rounded-md border border-hairline bg-raised/30 px-2.5 py-1.5">
                      <span className="shrink-0 font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] text-inkdim">{fazLabel(f.id)}</span>
                      <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.title}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-inkdim">
                        {f.blockedBy.length > 0
                          ? UI.roadmapBlokeFallback(f.blockedBy.map(fazLabel).join(', '))
                          : UI.roadmapDraftFazMeta(f.tasks.length, repos)}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : null}
            {invalid && parsed.parseError ? (
              <p className="mt-1 font-mono text-[11px] text-inkdim" data-draft-invalid>
                {(() => {
                  const e = parsed.parseError!;
                  if (e.reason === 'bad_element') return ROADMAP_DIAGNOSTIC_LABELS.bad_element(`[${e.index}] ${e.problem}`);
                  if (e.reason === 'bad_json') return ROADMAP_DIAGNOSTIC_LABELS.bad_json(e.message);
                  return ROADMAP_DIAGNOSTIC_LABELS[e.reason]('');
                })()}
              </p>
            ) : null}
            {superseded && !invalid ? (
              <p className="mt-1.5 text-[11.5px] text-inkdim" data-draft-superseded>{UI.roadmapDraftSuperseded}</p>
            ) : null}
            <p className="mt-2 text-[11.5px] text-inkdim">{UI.roadmapDraftWhy}</p>
          </>
        )}
        {objectOpen ? (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea
              autoFocus
              rows={2}
              placeholder={UI.roadmapDraftObjectPlaceholder}
              value={objectText}
              onChange={(e) => setObjectText(e.target.value)}
              className="font-sans text-[13px]"
            />
            {objectBusy ? (
              <p role="alert" className="self-end text-[11.5px] text-error">{UI.roadmapDraftBusy}</p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setObjectOpen(false); setObjectText(''); setObjectBusy(false); }}>{UI.cancel}</Button>
              {/* The kit lock while empty — the WorkOrderDetail objection precedent: an empty note
                  never sends (the placeholder is display copy, not a note — review f2). */}
              <Button variant="primary" size="sm" data-draft-object locked={!objectText.trim()} onClick={object}>{UI.objectSend}</Button>
            </div>
          </div>
        ) : null}
        {!editOpen ? (
          // the operator's seats (dogfood 2026-08-29): LEFT-aligned, not right — the action row
          // reads with the card, not against it
          <div className="mt-2 flex items-center justify-start gap-2">
            {!invalid ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => { setObjectOpen((v) => !v); setObjectBusy(false); }}>{UI.object}</Button>
                <Button variant="ghost" size="sm" data-draft-edit onClick={openEditor}>{UI.editPlan}</Button>
                <Button variant="primary" size="sm" data-draft-approve onClick={approve}>
                  {UI.roadmapDraftApprove}
                  <EnterMark />
                </Button>
              </>
            ) : (
              <>
                {draft.providerSessionId ? (
                  <>
                    <Button
                      variant="primary"
                      size="sm"
                      data-draft-resume
                      busy={resumeBusy}
                      locked={resumeLocked}
                      onClick={resumeDraft}
                    >
                      {UI.driveResume}
                    </Button>
                    <Button variant="ghost" size="sm" data-draft-discard onClick={() => setDiscardOpen(true)}>{UI.deleteWo}</Button>
                  </>
                ) : (
                  <p className="text-[11px] text-inkdim" data-draft-no-resume>{UI.roadmapDraftNoSessionLine}</p>
                )}
                {resumeBusy ? <p role="alert" className="text-[11px] text-error">{UI.roadmapDraftBusy}</p> : null}
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
    {/* The chip's back (TD-057): the draft session's döküm — a SIBLING surface, not a child of
        the overflow-hidden card (the transcript scrolls its own block). The identity line speaks
        the pane's voice: kim + clock + the composition's counts (sourceSummary — the counts'
        one honest echo; absent on pre-WO-0051 rows, the part omits) + $ + duration. After Onayla
        the card is gone and roadmap.md + git is the record (ADR-0010) — the window dies with it. */}
    {session !== undefined && logOpen ? (
      <div data-draft-log className="mt-2 overflow-hidden rounded-md border border-hairline bg-surface shadow-sm">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-hairline px-3.5 py-2 font-mono text-[10.5px] text-inkdim">
          <span aria-hidden="true">●</span>
          <span className="text-ink">{UI.roadmapDraftIdentity}</span>
          {session.startedAt ? <span>{UI.auditClock(session.startedAt)}</span> : null}
          {draft.sourceSummary ? (
            <span>{UI.roadmapDraftSourceCompose(draft.sourceSummary.store, draft.sourceSummary.external, draft.sourceSummary.freeExplore)}</span>
          ) : null}
          {session.cost?.usd !== undefined ? <span>{formatUsd(session.cost.usd)}</span> : null}
          {session.startedAt && session.endedAt ? (
            <span>{UI.formatDuration(new Date(session.endedAt).getTime() - new Date(session.startedAt).getTime())}</span>
          ) : null}
        </p>
        {session.transcript.length > 0 ? (
          <ChatTranscript entries={session.transcript} role="architect" variant="archived" resetKey={session.providerSessionId ?? ''} />
        ) : (
          <p className="px-3.5 py-2 text-[12px] text-inkdim">{UI.auditNoTranscript}</p>
        )}
      </div>
    ) : null}
    <Dialog
      open={discardOpen}
      onOpenChange={setDiscardOpen}
      title={UI.roadmapDraftDiscardTitle}
      closeAria={UI.cancel}
      narrow
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(false)}>{UI.cancel}</Button>
          <Button variant="danger" size="sm" data-draft-discard-confirm busy={busy} onClick={() => { setDiscardOpen(false); discardDraft(); }}>
            {UI.deleteWo}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-ink">{UI.roadmapDraftDiscardBody}</p>
    </Dialog>
    </>
  );
}
