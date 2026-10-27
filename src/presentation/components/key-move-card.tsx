// components/key-move-card.tsx — the separate card of a candidate whose `envOverrides` holds a
// token (U-34): "Erişim anahtarını Anahtar Zinciri'ne taşı" with a switch that starts off. While
// the token is not moved the row it belongs to is "Kurulum bekliyor" and cannot be selected
// (U-262), so the card shows before any selection and stays after the move to allow undo. The
// wizard's Hesaplar rows and Settings → Hesaplar → Eklenmemiş share it. No value is ever shown.
import { t, type Locale } from '../labels/t';
import { InfoBubble } from './info-bubble';

export interface KeyMoveCardProps {
  readonly locale: Locale;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}

export function KeyMoveCard({ locale, on, onChange }: KeyMoveCardProps) {
  return (
    <div className="mx-3.5 mb-3 rounded-card border border-hairline bg-band px-3 py-2" data-key-move-card="">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[13px] text-ink">{t(locale, 'candidates.keymove.title')}</span>
        <InfoBubble locale={locale} subject={t(locale, 'candidates.keymove.title')} body={t(locale, 'candidates.keymove.body')} />
        <span className="flex-1" />
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t(locale, 'candidates.keymove.switch')}
          onClick={(event) => {
            event.stopPropagation();
            onChange(!on);
          }}
          className={`relative h-5 w-9 flex-none rounded-full border transition-colors ${on ? 'border-signal bg-signal' : 'border-hairline bg-raised'}`}
        >
          <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-ink transition-[left] ${on ? 'left-[18px]' : 'left-0.5'}`} />
        </button>
      </div>
    </div>
  );
}
