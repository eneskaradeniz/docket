import type { PrimaryAction } from '../../../core/types';
import { ABSENT_REASON_LABELS, ACTION_LABELS } from '../../data/labels';

// AC3 in the flesh: when evidence is missing the action is ABSENT with a reason — no disabled control.
export function PrimaryActionBar({ action }: { action: PrimaryAction }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
      {action.kind === 'available' ? (
        <button
          type="button"
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          {ACTION_LABELS[action.intent]}
        </button>
      ) : (
        <p className="text-sm text-slate-500">
          <span className="font-medium text-slate-700">No action available.</span>{' '}
          {ABSENT_REASON_LABELS[action.reason]}
        </p>
      )}
    </div>
  );
}
