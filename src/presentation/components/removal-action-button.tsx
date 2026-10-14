// components/removal-action-button.tsx — Sil / Arşivle with dependency blockers (U-293).
import { t, type Locale } from '../labels/t';
import type { RemovalBlockNote } from '../stores/roles';
import { ActionButton } from './action-button';

export interface RemovalActionButtonProps {
  readonly locale: Locale;
  readonly action: 'delete' | 'archive' | 'blocked';
  readonly labelAction: 'delete' | 'archive';
  readonly blockNote: RemovalBlockNote | null;
  readonly onAction: () => void;
}

export function RemovalActionButton({ locale, action, labelAction, blockNote, onAction }: RemovalActionButtonProps) {
  const disabled = action === 'blocked';
  const label = labelAction === 'archive' ? t(locale, 'definition.action.archive') : t(locale, 'definition.action.delete');
  const noteLabel = t(locale, 'definition.blocked.noteLabel');
  return (
    <div className="grid gap-1.5">
      <ActionButton
        variant="neutral"
        size="md"
        aria-label={label}
        disabled={disabled}
        title={blockNote?.full}
        onClick={() => {
          if (!disabled) onAction();
        }}
      >
        {label}
      </ActionButton>
      {blockNote !== null ? (
        <p role="note" aria-label={noteLabel} title={blockNote.full} className="rounded-card border border-hairline bg-raised px-3 py-2 text-[12px] text-inkdim">
          {blockNote.short}
        </p>
      ) : null}
    </div>
  );
}
