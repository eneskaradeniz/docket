// components/phone-window.tsx — Telefon's own window. Pairing does not exist yet, so the window
// says so and offers a disabled Eşleştir: the same honest standing Settings used to carry, moved
// out of that panel so Ayarlar no longer lists it.
import { ActionButton } from './action-button';
import { ModalWindow } from './new-work-order-window';
import { SettingRow, SettingRows } from './setting-row';
import { StatusLamp } from './status-lamp';
import { WindowTitle } from './window-frame';
import { t, type Locale } from '../labels/t';

const CloseIcon = () => (
  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" className="block h-[15px] w-[15px]">
    <path d="m4 4 8 8M12 4 4 12" />
  </svg>
);

export interface PhoneWindowProps {
  readonly open: boolean;
  readonly locale: Locale;
  readonly onClose: () => void;
}

export function PhoneWindow({ open, locale, onClose }: PhoneWindowProps) {
  const titleId = 'phone-window-title';
  return (
    <ModalWindow
      open={open}
      label={t(locale, 'phone.title')}
      titleId={titleId}
      brand={t(locale, 'phone.title')}
      dataMark="data-phone-window"
      scrimMark="data-phone-window-scrim"
      onClose={onClose}
      head={
        <div className="flex items-start gap-3">
          <div id={titleId} className="min-w-0">
            <WindowTitle title={t(locale, 'phone.title')} />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(locale, 'phone.close')}
            title={t(locale, 'phone.close')}
            className="ml-auto grid h-8 w-8 flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
          >
            <CloseIcon />
          </button>
        </div>
      }
    >
      <SettingRows>
        <SettingRow
          framed
          locale={locale}
          title={t(locale, 'phone.none')}
          purpose={t(locale, 'phone.explain')}
          control={
            <span className="flex items-center gap-3">
              <StatusLamp tone="dim">{t(locale, 'phone.soon')}</StatusLamp>
              <span className="inline-flex [&>button]:h-8">
                <ActionButton variant="neutral" size="md" disabled>
                  {t(locale, 'phone.pair')}
                </ActionButton>
              </span>
            </span>
          }
        />
      </SettingRows>
    </ModalWindow>
  );
}
