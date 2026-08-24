// PlanSection (WO-0038 DOSYA → editor tour, operator-approved 2026-08-22 → WO-0039) — the plan
// proposal as compact 32px rows, ONE anatomy from proposal to done. The EDIT mode (designed with
// the ui-ux-designer pass):
//   • the commit model is honest — drafts STAGE in the caller's editSteps and survive Bitti
//     (Vazgeç is the only discard); the caller gates Onayla on the stage, not on the editor chrome
//   • the role chip opens a PICKER (Radix DropdownMenu — recognition beats the hidden cycle ring):
//     lamp + name + one-line duty, radio semantics, full keyboard path
//   • ▲ ▼ ✕ carry tooltips (the aria words — one source); the EDGE controls render GUARDED
//     (dim, handler-less — the operator's "disable gibi görünsün" ruling; a `disabled` attribute
//     is CI-banned, the guarded form is the house idiom)
//   • an empty aim wears the error border (WO-0036's field rule); "+ Adım ekle" focuses the fresh
//     input; edit and view rows sit at the SAME fixed height (h-8 — the section never bumps).
// WO-0039 — the rail died. Düzenle sits in the heading (it edits THIS section); the DECISIONS
// (İtiraz et + Onayla / Vazgeç + Bitti / the lone Plan iste) live in the controller's ONE decision
// row ABOVE the section (2026-08-23 operator revision — Onayla occupies Plan iste's pixels). The
// view rows carry no per-row status word (the old "hazır"×N said nothing); the right meta is the
// SCOPED row's repo slug (StepList's rule, 'all' stays quiet).
import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, GripVertical, X } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { SessionRole, StepSpec } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';
import { Button } from '../../kit';
import { Input } from '../../kit';
import { Tooltip } from '../../kit';
import { EnterMark } from '../EnterMark';
import { RoleChip } from './RoleChip';

/** The row's role edge — the .rlamp grammar (architect signal / implementer info / verifier proceed). */
const ROLE_EDGE: Record<SessionRole, string> = {
  architect: 'border-l-signal',
  implementer: 'border-l-info',
  verifier: 'border-l-proceed',
};

/** The editor stage's row type — a StepSpec plus a STABLE drag identity. The uid is assigned when
 *  the stage is seeded / a row is added and survives reorders; `idx` renumbers on every drop
 *  (display position only). applyStepEdits serializes role/aim/scope explicitly, so the uid never
 *  reaches the plan fence. */
export type EditableStep = StepSpec & { uid?: string };
const sortableIdOf = (s: EditableStep): string | number => s.uid ?? s.idx;

/** The picker's pipeline order (Mimar → Uygulayıcı → Doğrulayıcı). */
const ROLE_ORDER: SessionRole[] = ['architect', 'implementer', 'verifier'];

/** The edge control's inert form: visible, dim, no handler, no tooltip (nothing to explain). */
function GuardedIbtn({ children }: { children: React.ReactNode }) {
  return (
    <span className="ibtn h-6 w-6 opacity-45" aria-hidden="true">
      {children}
    </span>
  );
}

/** The role picker — chip + caret trigger, a radio menu of the three pipeline roles. */
function RolePicker({ role, onSelect }: { role: SessionRole; onSelect: (r: SessionRole) => void }) {
  const { ROLE_DUTY_LABELS, ROLE_LABELS, UI } = useLabels();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="rolemenu-trigger irow flex shrink-0 items-center gap-1 rounded px-1 py-0.5"
          aria-label={UI.editRoleAria(role)}
        >
          <RoleChip role={role} />
          <ChevronDown className="rolemenu-caret h-2.5 w-2.5 text-inkdim/70" aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-56 rounded-md border border-hairline bg-raised p-1 shadow-lg"
          aria-label={UI.editRoleMenuAria}
        >
          <DropdownMenu.RadioGroup value={role} onValueChange={(v) => onSelect(v as SessionRole)}>
            {ROLE_ORDER.map((r) => (
              <DropdownMenu.RadioItem
                key={r}
                value={r}
                className="grid grid-cols-[3px_1fr_14px] items-center gap-2 rounded px-2 py-1.5 text-left outline-none data-[highlighted]:bg-ink/5"
              >
                <span className={cn('rlamp', `rlamp-${r}`)} aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block text-[12px] font-semibold text-ink">{ROLE_LABELS[r]}</span>
                  <span className="block font-mono text-[10px] leading-[1.4] text-inkdim">{ROLE_DUTY_LABELS[r]}</span>
                </span>
                <span className="flex h-3 w-3 items-center justify-center text-ink">
                  <DropdownMenu.ItemIndicator>
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** One EDITOR row — a dnd-kit sortable (operator ruling, 2026-08-23: the ▲▼ pair died for
 *  drag-and-drop). The GRIP is the only drag surface (the aim input keeps its pointer events;
 *  a 4px activation distance kills accidental lifts), and the KeyboardSensor keeps reordering
 *  reachable without the arrows — Space lifts on the grip, arrows place, Space drops. The ✕
 *  stays (guarded when it is the last row); the drop renumbers via the caller's onReorder. */
function EditorStepRow({
  s,
  canRemove,
  autoFocusNew,
  reducedMotion,
  onAimChange,
  onRoleSelect,
  onRemove,
}: {
  s: EditableStep;
  canRemove: boolean;
  autoFocusNew: boolean;
  reducedMotion: boolean;
  onAimChange: (idx: number, aim: string) => void;
  onRoleSelect: (idx: number, role: SessionRole) => void;
  onRemove: (idx: number) => void;
}) {
  const { UI } = useLabels();
  // Stable identity: the sortable id is the row's uid (never its position). Keying dragables by
  // POSITION makes the drop renumber the keys — React unmounts/remounts the row instead of moving
  // it, and every transform resets at once: the "animation resets" the operator saw (2026-08-23).
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: sortableIdOf(s) });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition: reducedMotion ? undefined : transition }}
      className={cn(
        'flex h-8 min-w-0 items-center gap-2 rounded-md border border-l-2 border-hairline bg-surface px-2.5',
        ROLE_EDGE[s.role],
        isDragging && 'z-10 opacity-85 shadow-md',
      )}
    >
      <span className="shrink-0 font-mono text-[11px] text-inkdim">{s.idx}</span>
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={UI.editDragHandleAria}
        className="ibtn grip h-6 w-6 shrink-0"
      >
        <GripVertical className="h-3 w-3" aria-hidden="true" />
      </button>
      <RolePicker role={s.role} onSelect={(r) => onRoleSelect(s.idx, r)} />
      <Input
        value={s.aim}
        onChange={(e) => onAimChange(s.idx, e.target.value)}
        placeholder={UI.editNewStepAim}
        aria-label={UI.stepRef(s.idx)}
        {...(autoFocusNew ? { autoFocus: true } : {})}
        className={cn(
          'h-6 min-w-0 flex-1 rounded-md border bg-bg px-2.5 font-sans text-[12.5px]',
          s.aim.trim() ? 'border-hairline' : 'border-error',
        )}
      />
      <div className="flex shrink-0 gap-0.5">
        {canRemove ? (
          <Tooltip label={UI.editRemoveAria}>
            <button type="button" className="ibtn ibtn-danger h-6 w-6" aria-label={UI.editRemoveAria} onClick={() => onRemove(s.idx)}>
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : (
          <GuardedIbtn>
            <X className="h-3 w-3" aria-hidden="true" />
          </GuardedIbtn>
        )}
      </div>
    </li>
  );
}

export function PlanSection({
  editing,
  steps,
  onAimChange,
  onRoleSelect,
  onReorder,
  onRemove,
  onAdd,
  onEdit,
  editLocked,
  editorActions,
}: {
  editing: boolean;
  steps: EditableStep[];
  onAimChange: (idx: number, aim: string) => void;
  onRoleSelect: (idx: number, role: SessionRole) => void;
  /** Drag-and-drop reorder by ARRAY POSITION (from → to, 0-based; 2026-08-23). */
  onReorder: (from: number, to: number) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
  /** Opens the editor — the heading's Düzenle. Absent (undefined) ⇒ no button: a fence-less plan
   *  has nothing to edit. While the editor is open the slot becomes the editor's pair. */
  onEdit?: () => void;
  editLocked?: boolean;
  /** The editor's chrome, rendered in the heading slot while editing (2026-08-23 seventh pass:
   *  Bitti + Vazgeç live where Düzenle lives — the decision pair stays visible above, locked;
   *  İlk öneriye dön joined the same day: restore the AGENT's original steps, confirm-gated). */
  editorActions?: { onDone: () => void; onCancel: () => void; onRestore?: () => void };
}) {
  const { UI } = useLabels();
  // dnd-kit sensors (2026-08-23): the POINTER lifts only after 4px of travel (a click inside the
  // aim input never starts a drag — the listeners live on the grip alone anyway); the KEYBOARD
  // sensor replaces the dead ▲▼ buttons (Space lifts, arrows place, Space drops).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const [reducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const onDragEnd = (event: DragEndEvent): void => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // The ids are the rows' stable uids (fallback: the 1-based idx) — resolve them to positions.
    const from = steps.findIndex((s) => sortableIdOf(s) === active.id);
    const to = steps.findIndex((s) => sortableIdOf(s) === over.id);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(from, to);
  };
  return (
    <section data-plan-cards={steps.length}>
      {/* Operator ruling (2026-08-22): the readout alone — the count is the rows themselves.
          WO-0039: Düzenle rides the heading (it edits THIS section; the rail is dead). */}
      <div className="mb-2 flex min-w-0 items-center justify-between gap-2.5">
        <span className="readout shrink-0 text-signal">{UI.planReadyHeader}</span>
        {/* 2026-08-23 sixth pass: GHOST — the bordered form read loud beside the readout; the
            quiet dim word whispers, hover raises it (the heading stays the star).
            Seventh pass: while editing, the SAME slot carries Bitti + Vazgeç (the decision pair
            stays visible above, locked) — the eye keeps one heading action position. */}
        {!editing && onEdit ? (
          <Button variant="ghost" size="sm" locked={editLocked} onClick={onEdit}>
            {UI.editPlan}
          </Button>
        ) : null}
        {editing && editorActions ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={editorActions.onDone}>
              {UI.editPlanDone}
              <EnterMark />
            </Button>
            {/* 2026-08-23: natural widths here (the 92px equal-box rule is the DECISION pair's);
                Önerine dön renders GUARDED (dim, inert) when there is no original to restore —
                a bright nothing-button reads as broken ("tepki vermiyor"). */}
            {editorActions.onRestore ? (
              <Button variant="ghost" size="sm" onClick={editorActions.onRestore}>
                {UI.editPlanRestore}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" locked>
                {UI.editPlanRestore}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={editorActions.onCancel}>
              {UI.cancel}
            </Button>
          </div>
        ) : null}
      </div>
      {(() => {
        const list = (
          <ul className="flex min-w-0 flex-col gap-1.5">
            {steps.map((s, i) =>
              editing ? (
                <EditorStepRow
                  key={sortableIdOf(s)}
                  s={s}
                  canRemove={steps.length > 1}
                  autoFocusNew={i === steps.length - 1 && s.aim === ''}
                  reducedMotion={reducedMotion}
                  onAimChange={onAimChange}
                  onRoleSelect={onRoleSelect}
                  onRemove={onRemove}
                />
              ) : (
                <li
                  key={s.uid ?? s.idx}
                  className={cn(
                    'flex h-8 min-w-0 items-center gap-2 rounded-md border border-l-2 border-hairline bg-surface px-2.5',
                    ROLE_EDGE[s.role],
                  )}
                >
                  <span className="shrink-0 font-mono text-[11px] text-inkdim">{s.idx}</span>
                  <RoleChip role={s.role} />
                  <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{s.aim}</span>
                  {s.scope.kind !== 'all' ? (
                    <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-inkdim">{` · ${s.scope.ref}`}</span>
                  ) : null}
                </li>
              ),
            )}
            {editing ? (
              <li>
                <button
                  type="button"
                  className="irow flex h-8 w-full items-center rounded-md border border-dashed border-hairline px-2.5 text-left font-mono text-[11px] text-inkdim"
                  onClick={onAdd}
                >
                  {UI.editAddStep}
                </button>
              </li>
            ) : null}
          </ul>
        );
        // The sortable context exists only in EDIT mode; the announcements/instructions are the
        // bundle's (ADR-0007 — dnd-kit's English defaults never render). The ids are the rows'
        // stable uids — resolve to the 1-based row NUMBER for the announcement (Number(uid) is NaN;
        // the reviewer round caught "NaN. adım" being announced), same resolution as onDragEnd.
        const rowNo = (id: string | number): number => {
          const at = steps.findIndex((s) => sortableIdOf(s) === id);
          return at < 0 ? 0 : at + 1;
        };
        return editing ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
            accessibility={{
              screenReaderInstructions: { draggable: UI.dragSrInstructions },
              announcements: {
                onDragStart: ({ active }) => UI.dragAnnounceStart(rowNo(active.id)),
                onDragOver: ({ over }) => (over ? UI.dragAnnounceOver(rowNo(over.id)) : ''),
                onDragEnd: ({ active }) => UI.dragAnnounceEnd(rowNo(active.id)),
                onDragCancel: ({ active }) => UI.dragAnnounceCancel(rowNo(active.id)),
              },
            }}
          >
            <SortableContext items={steps.map((s) => sortableIdOf(s))} strategy={verticalListSortingStrategy}>
              {list}
            </SortableContext>
          </DndContext>
        ) : (
          list
        );
      })()}
    </section>
  );
}
