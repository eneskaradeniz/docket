// PlanSection (WO-0038 DOSYA → editor tour, operator-approved 2026-08-22) — the plan proposal as
// compact 32px rows, ONE anatomy from proposal to done. The EDIT mode (designed with the
// ui-ux-designer pass the same day):
//   • the commit model is honest — drafts STAGE in the caller's editSteps and survive Bitti
//     (Vazgeç is the only discard); the caller gates Onayla on the stage, not on the editor chrome
//   • the role chip opens a PICKER (Radix DropdownMenu — recognition beats the hidden cycle ring):
//     lamp + name + one-line duty, radio semantics, full keyboard path
//   • ▲ ▼ ✕ carry tooltips (the aria words — one source); the EDGE controls render GUARDED
//     (dim, handler-less — the operator's "disable gibi görünsün" ruling; a `disabled` attribute
//     is CI-banned, the guarded form is the house idiom)
//   • an empty aim wears the error border (WO-0036's field rule) and the rail names the row;
//     "+ Adım ekle" focuses the fresh input; edit and view rows sit at the same height.
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { SessionRole, StepSpec } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { cn } from '../../kit';
import { Input } from '../../kit';
import { Tooltip } from '../../kit';
import { RoleChip } from './RoleChip';

/** The row's role edge — the .rlamp grammar (architect signal / implementer info / verifier proceed). */
const ROLE_EDGE: Record<SessionRole, string> = {
  architect: 'border-l-signal',
  implementer: 'border-l-info',
  verifier: 'border-l-proceed',
};

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

export function PlanSection({
  editing,
  steps,
  onAimChange,
  onRoleSelect,
  onMove,
  onRemove,
  onAdd,
}: {
  editing: boolean;
  steps: StepSpec[];
  onAimChange: (idx: number, aim: string) => void;
  onRoleSelect: (idx: number, role: SessionRole) => void;
  onMove: (idx: number, dir: -1 | 1) => void;
  onRemove: (idx: number) => void;
  onAdd: () => void;
}) {
  const { UI } = useLabels();
  return (
    <section data-plan-cards={steps.length}>
      {/* Operator ruling (2026-08-22): the readout alone — the count is the rows themselves. */}
      <div className="mb-2 flex min-w-0 items-baseline gap-2.5">
        <span className="readout shrink-0 text-signal">{UI.planReadyHeader}</span>
      </div>
      <ul className="flex min-w-0 flex-col gap-1.5">
        {steps.map((s, i) =>
          editing ? (
            <li
              key={s.idx}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md border border-l-2 border-hairline bg-surface px-2.5 py-1',
                ROLE_EDGE[s.role],
              )}
            >
              <span className="shrink-0 font-mono text-[11px] text-inkdim">{s.idx}</span>
              <RolePicker role={s.role} onSelect={(r) => onRoleSelect(s.idx, r)} />
              <Input
                value={s.aim}
                onChange={(e) => onAimChange(s.idx, e.target.value)}
                placeholder={UI.editNewStepAim}
                aria-label={UI.stepRef(s.idx)}
                {...(i === steps.length - 1 && s.aim === '' ? { autoFocus: true } : {})}
                className={cn(
                  'h-6 min-w-0 flex-1 rounded-md border bg-bg px-2.5 font-sans text-[12.5px]',
                  s.aim.trim() ? 'border-hairline' : 'border-error',
                )}
              />
              <div className="flex shrink-0 gap-0.5">
                {i === 0 ? (
                  <GuardedIbtn>
                    <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  </GuardedIbtn>
                ) : (
                  <Tooltip label={UI.editMoveUpAria}>
                    <button type="button" className="ibtn h-6 w-6" aria-label={UI.editMoveUpAria} onClick={() => onMove(s.idx, -1)}>
                      <ChevronUp className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Tooltip>
                )}
                {i === steps.length - 1 ? (
                  <GuardedIbtn>
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  </GuardedIbtn>
                ) : (
                  <Tooltip label={UI.editMoveDownAria}>
                    <button type="button" className="ibtn h-6 w-6" aria-label={UI.editMoveDownAria} onClick={() => onMove(s.idx, 1)}>
                      <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Tooltip>
                )}
                {steps.length === 1 ? (
                  <GuardedIbtn>
                    <X className="h-3 w-3" aria-hidden="true" />
                  </GuardedIbtn>
                ) : (
                  <Tooltip label={UI.editRemoveAria}>
                    <button type="button" className="ibtn ibtn-danger h-6 w-6" aria-label={UI.editRemoveAria} onClick={() => onRemove(s.idx)}>
                      <X className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </Tooltip>
                )}
              </div>
            </li>
          ) : (
            <li
              key={s.idx}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-md border border-l-2 border-hairline bg-surface px-2.5 py-1.5',
                ROLE_EDGE[s.role],
              )}
            >
              <span className="shrink-0 font-mono text-[11px] text-inkdim">{s.idx}</span>
              <RoleChip role={s.role} />
              <span className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{s.aim}</span>
              <span className="ml-auto shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-inkdim">
                {UI.stepReady}
              </span>
            </li>
          ),
        )}
        {editing ? (
          <li>
            <button
              type="button"
              className="irow w-full rounded-md border border-dashed border-hairline px-2.5 py-1.5 text-left font-mono text-[11px] text-inkdim"
              onClick={onAdd}
            >
              {UI.editAddStep}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}
