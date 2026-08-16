// PlanApprovalCards (WO-0031c / v4) — the plan's PRIMARY surface at the approval moment: "Mimar N adım
// önerdi" over a grid of StepCards (the markdown prose stays a document, read in DETAY · Belgeler).
// The approval ACTIONS live in the rail (Onayla / İtiraz et / Düzenle) — this card only speaks.
// The EDITOR (c2): aim becomes an input, the role chip cycles (Mimar→Uyg→Doğ), ▲▼ reorder, ✕ removes
// (min 1), + Adım ekle appends — the rail carries the change counter and the "düzenlenmiş onay".
import { parsePlanSteps } from '../../../core/plan-steps';
import type { StepSpec } from '../../../core/types';
import { UI } from '../../data/labels';
import { RoleChip } from './StepCard';

export function PlanApprovalCards({
  plan,
  editing,
  steps,
  hint,
  onAimChange,
  onRoleCycle,
  onMove,
  onRemove,
  onAdd,
}: {
  /** The proposed plan text (undefined while the editor is open — the editor IS the plan then). */
  plan?: string;
  editing?: boolean;
  steps?: StepSpec[];
  hint?: string;
  onAimChange?: (idx: number, aim: string) => void;
  onRoleCycle?: (idx: number) => void;
  onMove?: (idx: number, dir: -1 | 1) => void;
  onRemove?: (idx: number) => void;
  onAdd?: () => void;
}) {
  const specs = editing ? steps ?? [] : plan !== undefined ? parsePlanSteps(plan) : [];
  return (
    <section data-plan-cards="" className="rounded-md border border-hairline bg-surface p-3.5 shadow-sm">
      <header className="mb-2.5 flex items-baseline gap-2.5">
        <p className="readout text-signal">{UI.planReadyHeader}</p>
        {editing ? null : <p className="text-[13px] font-semibold text-ink">{UI.planProposedSteps(specs.length)}</p>}
        {hint ? <p className="ml-auto text-[11px] text-inkdim">{hint}</p> : null}
      </header>
      {specs.length === 0 && !editing ? (
        <p className="rounded-md border border-signal/40 bg-signal/5 px-3 py-2 text-[12px] text-signal">
          {UI.planNoStepsWarn}
        </p>
      ) : (
        <div className={`grid grid-cols-1 gap-2 min-[640px]:grid-cols-2 ${editing ? '[&__.stepcard]:border-dashed' : ''}`}>
          {specs.map((s, i) => (
            <div key={`${s.idx}-${i}`} className="stepcard relative rounded-md border bg-surface p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono text-[12px] text-inkdim">{s.idx}</span>
                <button
                  type="button"
                  aria-label={editing ? UI.editRoleAria(s.role) : undefined}
                  onClick={() => onRoleCycle?.(s.idx)}
                  className={editing ? '' : 'pointer-events-none'}
                >
                  <RoleChip role={s.role} />
                </button>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-inkdim">
                  {s.scope.kind === 'all' ? UI.stepScopeAll : s.scope.ref}
                </span>
                {editing ? (
                  <span className="flex items-center gap-0.5">
                    <button
                      type="button"
                      aria-label={UI.editMoveUpAria}
                      onClick={() => onMove?.(s.idx, -1)}
                      className="rounded px-1 text-[11px] text-inkdim transition-colors hover:bg-raised hover:text-ink"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      aria-label={UI.editMoveDownAria}
                      onClick={() => onMove?.(s.idx, 1)}
                      className="rounded px-1 text-[11px] text-inkdim transition-colors hover:bg-raised hover:text-ink"
                    >
                      ▼
                    </button>
                    <button
                      type="button"
                      aria-label={UI.editRemoveAria}
                      onClick={() => onRemove?.(s.idx)}
                      className="rounded px-1 text-[11px] text-inkdim transition-colors hover:bg-raised hover:text-error"
                    >
                      ✕
                    </button>
                  </span>
                ) : null}
              </div>
              {editing ? (
                <input
                  value={s.aim}
                  onChange={(e) => onAimChange?.(s.idx, e.target.value)}
                  placeholder={UI.editNewStepAim}
                  className="mt-1.5 w-full rounded border border-hairline bg-bg px-2 py-1 text-[12.5px] font-semibold text-ink outline-none focus:border-signal"
                />
              ) : (
                <p className="mt-1.5 text-[12.5px] font-semibold leading-snug text-ink">{s.aim}</p>
              )}
              {editing ? null : <p className="mt-1.5 font-mono text-[11px] text-inkdim">{UI.stepReady}</p>}
            </div>
          ))}
          {editing ? (
            <button
              type="button"
              onClick={() => onAdd?.()}
              className="stepcard flex min-h-[76px] items-center justify-center rounded-md border border-dashed border-info/40 text-[12px] text-info transition-colors hover:bg-raised/50"
            >
              {UI.editAddStep}
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
