// DetailStrip (WO-0031c / v4 → WO-0038 DOSYA) — the console's HEADER BAND: the old strip and substrip
// merged into one 46px band whose LEFT LAMP SPINE carries the turn state (amber breathing = sıra
// sende, info = running — the .lamp grammar, vertical). ‹ back · WO badge + stage · the phase
// readout · right-aligned metrics (the price, bare; Süre — hidden at the narrowest sizes) · the
// quiet delete icon. The work-order title rides underneath with the two strip badges: the review
// cadence (clickable — Kapılarda ↔ Her adımda, logged) and the permission rule (display; the ask
// card changes it). The SADE|DETAY segment DIED with the dual view (WO-0038 — one view, no mode
// decisions); the step hairline under the band is the substrip segments' survivor. The turn label
// stays announced (aria-live, visually hidden — audit B5 lives on). WO-0037: the pencil/trash are
// GUARDED while a drive spends; the pencil opens a kit Dialog instead of replacing the title row.
import { useRef, useState } from 'react';
import { ChevronLeft, Pencil, Trash2 } from 'lucide-react';
import type { TurnState, WoPhase } from '../../../core/derive';
import type { WorkOrderDetailView } from '../../../core/types';
import type { PermissionRule, UpdateWorkOrderInput } from '../../../core/source';
import { Badge, Button, Dialog, Field, Input, Textarea, Tooltip, cn } from '../../kit';
import { toast } from '../../chrome/ToastHost';
import { useLabels } from '../../data/locale';
import type { LampTone } from '../session/pane-chrome';
import { lampClass } from '../session/pane-chrome';

// phase → lamp tone (carried over from Faz B's DetailHeader — the readout dot tells the truth).
const PHASE_KIND_TONE: Record<WoPhase['kind'], LampTone> = {
  just_written: 'idle',
  planning: 'run',
  plan_stopped: 'idle', // 2026-08-24: the proposal sits interrupted — nothing runs (the turn spine carries the stop)
  plan_ready: 'signal',
  implementing: 'run',
  reviewing: 'run',
  closing: 'signal',
  done: 'done',
};

/** The band spine speaks the turn (the substrip's lamp, moved to the band's left edge). */
const TURN_LAMP: Record<TurnState, LampTone> = {
  yours: 'signal',
  running: 'run',
  stopped: 'idle',
  retry: 'error',
  done: 'done',
};

export function DetailStrip({
  detail,
  objective,
  phase,
  turn,
  duration,
  driveLive,
  pendingSteer = 0,
  onBack,
  onDelete,
  permissionRule,
  onUpdateWorkOrder,
}: {
  detail: WorkOrderDetailView;
  /** The parsed order.md Objective — the description editor's starting text (WO-0031c). */
  objective: string;
  phase: WoPhase;
  /** The console's turn state — the band spine's lamp (WO-0038, the substrip's survivor). */
  turn: TurnState;
  duration?: string;
  /** A drive is spending right now (running or winding down) — order.md writers are absent (WO-0031d). */
  driveLive: boolean;
  /** Notes queued in the live drive (WO-0045) — the chip's pending count while they wait for a boundary. */
  pendingSteer?: number;
  onBack: () => void;
  onDelete: () => void;
  permissionRule: PermissionRule;
  onUpdateWorkOrder: (patch: UpdateWorkOrderInput) => Promise<void>;
}) {
  const { formatUsd, PERMISSION_RULE_SHORT, PERMISSION_RULE_TINY, phaseLabelText, STAGE_LABELS, UI, woIdLabel } = useLabels();
  const tone = PHASE_KIND_TONE[phase.kind];
  const turnLabel: Record<TurnState, string> = {
    yours: UI.turnYours,
    running: UI.turnRunning,
    stopped: UI.turnStopped,
    retry: UI.turnRetry,
    done: UI.turnDone,
  };
  const anyCost = detail.sessions.some((s) => s.cost);
  const breathe = tone === 'signal';
  // WO-0031f K1 — a closed work order is a record, not a document: the order.md writers are absent
  // (the pencil with a reason line, the review badge inert) for the same write-path reason as a live
  // drive. The permission badge was always display-only; Sil STAYS (an archive cleanup is legitimate).
  const closed = detail.stage === 'closed';
  // The juice hairline (v4 §7): fills with done/total steps — a quiet progress read under the strip.
  const stepsTotal = detail.steps.length;
  const stepsDone = detail.steps.filter((s) => s.status === 'done').length;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(detail.title);
  const [description, setDescription] = useState(objective);
  const [saving, setSaving] = useState(false);
  // WO-0036: the WsSettingsModal form contract — errors under their field; save failures toast
  // top-right (operator review round 2026-08-21; the footer carries no error copy).
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // The dialog does NOT unmount on close (DetailStrip stays mounted) — every draft resets here.
  const closeEdit = (): void => {
    setEditing(false);
    setTitle(detail.title);
    setDescription(objective);
    setTitleErr(null);
  };
  const save = async (): Promise<void> => {
    if (!title.trim()) {
      setTitleErr(UI.woErrTitle);
      titleRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      // Difference-based: a CLEARED description saves empty (WO-0036 — the old non-empty guard silently
      // swallowed the clear; core treats an empty Objective as a valid surgical edit).
      await onUpdateWorkOrder({
        ...(title.trim() !== detail.title ? { title: title.trim() } : {}),
        ...(description.trim() !== objective ? { description: description.trim() } : {}),
      });
      setEditing(false);
      setTitleErr(null);
    } catch {
      // the store refusal (closed-WO race, missing order.md) surfaces as a toast — B5, no footer copy
      toast.push({ kind: 'error', title: UI.saveFailed });
    } finally {
      setSaving(false);
    }
  };
  // The edit dialog's title Input takes the focus (Radix would otherwise land it on the close X).
  const onDialogOpenAutoFocus = (e: Event): void => e.preventDefault();

  return (
    <header className="relative flex flex-col gap-1.5 pb-2 pl-3.5">
      {/* The band spine — the ONE ambient lamp the substrip used to carry, now the band's own edge. */}
      <div
        className={cn('absolute bottom-2 left-0 top-0 w-[3px] rounded-br rounded-tr', lampClass(TURN_LAMP[turn], turn === 'yours'))}
        aria-hidden="true"
      />
      {/* The turn stays ANNOUNCED even though its line is gone (audit B5). */}
      <p aria-live="polite" className="sr-only">{turnLabel[turn]}</p>
      <div className="flex items-center gap-2">
        <Tooltip label={UI.backToBoard}>
          <button
            type="button"
            onClick={onBack}
            aria-label={UI.backToBoard}
            className="ibtn h-7 w-7 shrink-0"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
        <span className="shrink-0 font-mono text-[12px] text-inkdim">{woIdLabel(detail.id)}</span>
        <Badge>{STAGE_LABELS[detail.stage]}</Badge>
        <span className="flex min-w-0 items-center gap-1.5">
          <span
            className={cn('h-1.5 w-1.5 shrink-0 rounded-full', lampClass(tone, breathe))}
            aria-hidden="true"
          />
          <span className="truncate text-[12px] text-inkdim">{phaseLabelText(phase)}</span>
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {anyCost ? (
            // WO-0031f review (operator): the price speaks for itself — the "Maliyet" prefix died.
            <span className="hidden whitespace-nowrap font-mono text-[11px] text-inkdim min-[520px]:inline">
              {formatUsd(detail.cost.usd)}
            </span>
          ) : null}
          {duration ? (
            <span className="hidden whitespace-nowrap font-mono text-[11px] text-inkdim min-[820px]:inline">
              {UI.stripDuration} {duration}
            </span>
          ) : null}
          {/* WO-0037 (ADR-0001 2026-08-22 addendum): while a drive spends, the writers render IN
              PLACE, dimmed, handler-less, pointer events KEPT — the tooltip opens and names the
              unblocking move. The substrip's "Çalışıyor" already carries the cause on this surface,
              so no standing reason line. */}
          <Tooltip label={driveLive ? UI.stripDeleteGateTooltip : UI.deleteWo}>
            <Button
              variant="ghost"
              size="icon"
              aria-label={UI.deleteWo}
              className={driveLive ? 'opacity-45' : undefined}
              {...(driveLive ? {} : { onClick: onDelete })}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Operator ruling (2026-08-22): a long title truncates — hovering reveals the full text. */}
        <Tooltip label={detail.title}>
          <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-tight text-ink">{detail.title}</h1>
        </Tooltip>
        {/* The gated pencil joins the same guarded form (WO-0037): dim + handler-less while a drive
            spends, and on a CLOSED work order (WO-0031f's terminal lock — the old kit `locked` had
            pointer-events-none, so this tooltip could never open; the guarded form keeps them). The
            closed state is already named by the badge beside it — the tooltip stays the plain aria. */}
        <Tooltip label={driveLive ? UI.stripGateTooltip : UI.woEditAria}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={UI.woEditAria}
            className={cn('h-6 w-6 shrink-0', (driveLive || closed) && 'opacity-45')}
            {...(driveLive || closed ? {} : { onClick: () => setEditing(true) })}
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
          </Button>
        </Tooltip>
        {/* The review cadence badge is the change surface (v4 freedom 2); the rule badge only shows.
            WO-0031d: while a drive is live the badge states its fact and goes inert (same write path
            as the pencil — gated with it; the button is simply not rendered). WO-0031f K1: closed is
            the permanent form of that — the cadence is now a fact of history, not a setting.
            WO-0039: the chip TEACHES — a kit Tooltip per mode replaces the dead "İnceleme" title
            (it said nothing and hid the clickability); the word "Kapılarda" now defines itself. */}
        {driveLive || closed ? (
          <Tooltip label={detail.reviewMode === 'gates' ? UI.reviewModeGatesHint : UI.reviewModeEveryHint}>
            <span
              data-review-mode={detail.reviewMode}
              title={UI.reviewModeLabel}
              className="ichip shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider opacity-45"
            >
              {detail.reviewMode === 'gates' ? UI.reviewModeGatesShort : UI.reviewModeEveryShort}
            </span>
          </Tooltip>
        ) : (
          <Tooltip label={detail.reviewMode === 'gates' ? UI.reviewModeGatesHint : UI.reviewModeEveryHint}>
            <button
              type="button"
              data-review-mode={detail.reviewMode}
              title={UI.reviewModeLabel}
              onClick={() => void onUpdateWorkOrder({ reviewMode: detail.reviewMode === 'gates' ? 'every-step' : 'gates' })}
              className="ichip shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
            >
              {detail.reviewMode === 'gates' ? UI.reviewModeGatesShort : UI.reviewModeEveryShort}
            </button>
          </Tooltip>
        )}
        {/* WO-0045 — the Akış chip (the operator's own word). Operator ruling 2026-08-26: locked ONLY
            on a closed WO — while a drive runs the chip STAYS clickable, because the mode is read at
            the NEXT spawn (switching never touches the running drive; it takes effect at the next
            boundary). The pending-steer count rides the chip while notes queue. */}
        {closed ? (
          <Tooltip label={detail.flowMode === 'manual' ? UI.flowModeManualHint : UI.flowModeAutoHint}>
            <span
              data-flow-mode={detail.flowMode}
              title={UI.flowModeLabel}
              className="ichip shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider opacity-45"
            >
              {detail.flowMode === 'manual' ? UI.flowModeManualShort : UI.flowModeAutoShort}
              {pendingSteer > 0 ? <span className="ml-1 text-info">{UI.flowPendingBadge(pendingSteer)}</span> : null}
            </span>
          </Tooltip>
        ) : (
          <Tooltip label={detail.flowMode === 'manual' ? UI.flowModeManualHint : UI.flowModeAutoHint}>
            <button
              type="button"
              data-flow-mode={detail.flowMode}
              data-flow-pending={pendingSteer > 0 ? pendingSteer : undefined}
              title={UI.flowModeLabel}
              onClick={() => void onUpdateWorkOrder({ flowMode: detail.flowMode === 'manual' ? 'auto' : 'manual' })}
              className="ichip shrink-0 rounded px-1.5 py-px font-mono text-[10px] uppercase tracking-wider"
            >
              {detail.flowMode === 'manual' ? UI.flowModeManualShort : UI.flowModeAutoShort}
              {pendingSteer > 0 ? <span className="ml-1 text-info">{UI.flowPendingBadge(pendingSteer)}</span> : null}
            </button>
          </Tooltip>
        )}
        <span
          data-permission-rule={permissionRule}
          className="hidden shrink-0 rounded border border-info/40 px-1.5 py-px font-mono text-[10px] uppercase tracking-wider text-info min-[520px]:inline"
        >
          <span className="min-[820px]:inline">{PERMISSION_RULE_SHORT[permissionRule]}</span>
          <span className="hidden min-[520px]:inline min-[820px]:hidden">{PERMISSION_RULE_TINY[permissionRule]}</span>
        </span>
      </div>

      {editing ? (
        <Dialog
          open
          onOpenChange={(o) => { if (!o) closeEdit(); }}
          title={UI.woEditTitle}
          closeAria={UI.dialogCloseAria}
          onOpenAutoFocus={onDialogOpenAutoFocus}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={closeEdit}>{UI.cancel}</Button>
              {/* WO-0036: never locked for validity — the refusal teaches, under the field it failed on. */}
              <Button variant="primary" size="sm" busy={saving} locked={saving} onClick={() => void save()}>
                {UI.woEditSave}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            <Field label={UI.woTitleLabel} error={titleErr}>
              <Input
                id="wo-edit-title"
                ref={titleRef}
                autoFocus
                aria-required="true"
                value={title}
                onChange={(e) => { setTitle(e.target.value); setTitleErr(null); }}
                placeholder={UI.woTitlePlaceholder}
                className="font-sans text-[14px]"
              />
            </Field>
            <Field label={UI.woDescLabel}>
              <Textarea
                id="wo-edit-desc"
                rows={6}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={UI.woDescPlaceholder}
                className="font-sans text-[12.5px]"
              />
            </Field>
          </div>
        </Dialog>
      ) : null}

      {stepsTotal > 0 ? (
        <div className="hairline-progress" aria-hidden="true">
          <div style={{ width: `${Math.round((stepsDone / stepsTotal) * 100)}%` }} />
        </div>
      ) : null}
    </header>
  );
}
