// components/status-lamp.tsx — a status as the book writes it: an 8px lamp and the word beside it
// (Hazır proceed · Giriş gerekli signal · Doğrulanamadı dim), in sans — never an outlined mono
// chip. The word always arrives resolved; the lamp's hue comes from the store's tone.
import type { LampTone } from '../stores/candidates';

const LAMP_CLASS: Readonly<Record<LampTone, string>> = {
  proceed: 'bg-proceed',
  signal: 'bg-signal',
  dim: 'bg-inkdim',
  error: 'bg-error',
  info: 'bg-info',
};

export interface StatusLampProps {
  readonly tone: LampTone;
  readonly children: string;
}

export function StatusLamp({ tone, children }: StatusLampProps) {
  return (
    <span className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap text-[12.5px] text-inkdim" data-status-lamp={tone}>
      <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${LAMP_CLASS[tone]}`} />
      {children}
    </span>
  );
}
