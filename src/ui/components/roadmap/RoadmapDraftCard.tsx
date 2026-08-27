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
import { Button, Input, Textarea, cn } from '../../kit';
import { EnterMark } from '../EnterMark';
import { seedLiveState, initialSessionState } from '../../../core/runner';
import { useDriveStore } from '../session/drive-store';

export function RoadmapDraftCard({
  draft,
  workspace,
  docsRoot,
  source,
  onApproved,
  onSaved,
}: {
  draft: RoadmapDraft;
  workspace: Workspace;
  /** The effective structure root — the summary's "where it will live" tail. */
  docsRoot: string;
  source: WorkOrderSource;
  /** Onayla landed: the screen refreshes to the ready face. */
  onApproved: () => void;
  /** Düzenle's Bitti wrote the row: the screen re-reads the draft. */
  onSaved: () => void;
}) {
  const { ROADMAP_DIAGNOSTIC_LABELS, UI, fazLabel } = useLabels();
  const store = useDriveStore();
  const [busy, setBusy] = useState(false);
  const [objectOpen, setObjectOpen] = useState(false);
  const [objectText, setObjectText] = useState('');
  const wsId: WorkspaceId = workspace.id;
  const driveKey = `${wsId}:draft`;

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
  // pane seeds from the draft session row — the stream appends to what already happened.
  const object = (): void => {
    if (!draft.providerSessionId) return;
    const seed = draft.session !== undefined ? seedLiveState(draft.session) : initialSessionState;
    store.start(
      driveKey,
      {
        role: 'architect',
        workspaceId: wsId,
        mode: 'plan',
        prompt: objectText.trim() || UI.roadmapDraftObjectPlaceholder,
        goalNote: '',
        docPaths: [],
        resume: draft.providerSessionId,
      },
      seed,
    );
    setObjectOpen(false);
    setObjectText('');
  };

  const openEditor = (): void => {
    setEditFazlar(parsed.fazlar.map((f) => ({ ...f, tasks: f.tasks.map((t) => ({ ...t })) })));
    setEditErr(undefined);
    setEditOpen(true);
  };

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
    <div
      data-roadmap-draft-card
      className="flex items-stretch overflow-hidden rounded-md border border-hairline bg-surface shadow-sm"
    >
      <div className="lamp lamp-signal" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <p className="readout text-signal">{UI.roadmapDraftCardHead}</p>
        </div>
        {editOpen ? (
          <div className="mt-2 flex flex-col gap-2" data-draft-edit>
            {editFazlar.map((f, i) => {
              const others = editFazlar.filter((_, j) => j !== i);
              return (
                <div key={f.id} className="flex flex-col gap-1.5 rounded-md border border-hairline bg-raised/30 px-2.5 py-2">
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
                          aria-label={t.id}
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
              <div className="mt-2.5 flex flex-col gap-1" data-draft-faz-list>
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
                  return ROADMAP_DIAGNOSTIC_LABELS[e.reason]('');
                })()}
              </p>
            ) : null}
            <p className="mt-2 text-[11.5px] text-inkdim">{UI.roadmapDraftWhy}</p>
          </>
        )}
        {objectOpen ? (
          <div className="mt-2.5 flex flex-col gap-2">
            <Textarea
              autoFocus
              rows={2}
              placeholder={UI.roadmapDraftObjectPlaceholder}
              value={objectText}
              onChange={(e) => setObjectText(e.target.value)}
              className="font-sans text-[13px]"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setObjectOpen(false); setObjectText(''); }}>{UI.cancel}</Button>
              <Button variant="primary" size="sm" data-draft-object onClick={object}>{UI.objectSend}</Button>
            </div>
          </div>
        ) : null}
        {!editOpen ? (
          <div className="mt-2.5 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setObjectOpen((v) => !v)}>{UI.object}</Button>
            {!invalid ? (
              <>
                <Button variant="ghost" size="sm" data-draft-edit onClick={openEditor}>{UI.editPlan}</Button>
                <Button variant="primary" size="sm" data-draft-approve onClick={approve}>
                  {UI.roadmapDraftApprove}
                  <EnterMark />
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
