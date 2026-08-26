// BudgetRefusalCard (WO-0047) — the budget gate's TWO-CHOICE resolution, Paperclip's shape
// (keep_paused | raise_budget_and_resume, minus their pause — Docket's gate is pre-drive). The
// grammar is the ask card's (StopAndAskCard): lamp-edged card, readout title, body, right-aligned
// ghost/primary pair — but the semantics are refusal, not permission: the drive already returned
// with an error carrying the refusal's facts, and the operator resolves it exactly two ways
// (AC3: no third path, no flag). Raise = a PERMANENT settings write + the SAME drive re-issued
// (the store's restart); Keep = dismiss — the standing stop line on the card/band carries the
// reason from here on (ADR-0001: present with its reason, never disabled).
// ⏎ rides the raise primary only while the input is valid (the objection-layer rule — this is
// not an ask: the fold is 'error', never 'stopped_asking').
import { useEffect, useRef, useState } from 'react';
import { Landmark } from 'lucide-react';
import { parseAmount } from '../../../core/budget';
import { useLabels } from '../../data/locale';
import { Button, Field, Input } from '../../kit';

export function BudgetRefusalCard({
  observedUsd,
  capUsd,
  hasUnknown,
  busy,
  onRaise,
  onKeep,
}: {
  observedUsd: number;
  capUsd: number;
  hasUnknown: boolean;
  busy?: boolean;
  /** The raise action: persists the new cap (permanent) — the caller then re-runs the drive. */
  onRaise: (newCapUsd: number) => void;
  /** The keep action: dismiss the card; the standing stop line carries the reason. */
  onKeep: () => void;
}) {
  const { UI } = useLabels();
  const [text, setText] = useState(() => String(Math.max(observedUsd + 10, capUsd)));
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = parseAmount(text);
  const invalid = !touched || busy ? null : !(parsed > 0) ? UI.budgetErrNumber : parsed <= observedUsd ? UI.budgetErrRaise : null;
  const valid = parsed > observedUsd;
  // The re-arm rule (WO-0047): a NEW refusal identity re-shows the card — the prefill follows.
  useEffect(() => {
    setText(String(Math.max(observedUsd + 10, capUsd)));
    setTouched(false);
  }, [observedUsd, capUsd]);
  const raise = (): void => {
    setTouched(true);
    if (!valid || busy) {
      inputRef.current?.focus();
      return;
    }
    onRaise(parsed);
  };
  return (
    <div
      data-budget-refusal-card
      className="flex items-stretch overflow-hidden rounded-md border border-signal/40 bg-surface shadow-sm"
    >
      <div className="lamp lamp-signal-breathe" />
      <div className="min-w-0 w-full px-3.5 py-3">
        <p className="readout flex items-center gap-1.5 text-signal">
          <Landmark className="h-3.5 w-3.5" aria-hidden="true" />
          {UI.budgetRefusalTitle}
        </p>
        <p className="mt-1.5 text-sm text-ink">{UI.budgetRefusalBody(observedUsd, capUsd)}</p>
        {/* AC5 said aloud: the gate never touches a running drive; the refusal is the NEXT drive's. */}
        <p className="mt-1 text-xs text-inkdim">{UI.budgetRefusalRunningNote}</p>
        {/* The figure's basis (the order's Notes): unknown-cost rows never count — when any sit in
            the window the sum is the KNOWN spend, and the card says so. */}
        {hasUnknown ? <p className="mt-1 text-xs text-inkdim">{UI.budgetBasisNote}</p> : null}
        <div className="mt-2.5 max-w-56">
          <Field label={UI.budgetRaiseLabel} error={invalid}>
            <Input
              ref={inputRef}
              value={text}
              inputMode="decimal"
              data-budget-raise-input=""
              aria-invalid={invalid !== null}
              aria-label={UI.budgetRaiseLabel}
              onChange={(e) => {
                setText(e.target.value);
                setTouched(true);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  raise();
                }
              }}
            />
          </Field>
        </div>
        <div className="mt-2.5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onKeep}>{UI.budgetKeepAction}</Button>
          <Button variant="primary" size="sm" busy={busy} locked={busy} onClick={raise}>
            {UI.budgetRaiseAction}
          </Button>
        </div>
      </div>
    </div>
  );
}
