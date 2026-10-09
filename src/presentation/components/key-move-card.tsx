// components/key-move-card.tsx — the separate card of a selected candidate whose `envOverrides`
// holds a token (U-34): "Erişim anahtarını Anahtar Zinciri'ne taşı" with a switch that starts off.
// The wizard's Hesaplar rows and Settings → Hesaplar → Eklenmemiş share it. No value is ever shown.
import { t, type Locale } from '../labels/t';

export interface KeyMoveCardProps {
  readonly locale: Locale;
  readonly on: boolean;
  readonly onChange: (on: boolean) => void;
}

export function KeyMoveCard({ locale, on, onChange }: KeyMoveCardProps) {
  return (
    <div className="mx-3.5 mb-3 grid gap-2 rounded-card border border-hairline bg-band p-3" data-key-move-card="">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1 text-[13px] text-ink">{t(locale, 'candidates.keymove.title')}</span>
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
      <p className="text-[12px] text-inkdim">{t(locale, 'candidates.keymove.body')}</p>
    </div>
  );
}
