// components/settings-cards.tsx — the card surfaces Settings shares: the centred empty card (icon,
// title, one line, an optional action), the info banner with its action inside on the right, and
// the two cards built from them (the Roller unset banner, the Yetenekler discovery card). A page
// never shows an empty state as a bare line of text. Every length is rem, every radius a token.
import type { ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';

const InboxIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
    <path d="M2.5 9.5 4 3.5h8l1.5 6" />
    <path d="M2.5 9.5v3h11v-3H10a2 2 0 0 1-4 0H2.5Z" />
  </svg>
);

const InfoIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5 flex-none text-signal-soft">
    <circle cx="8" cy="8" r="6" />
    <path d="M8 7.2V11M8 5v.1" />
  </svg>
);

export interface EmptyCardProps {
  /** The e2e and test hook that names which empty state this is. */
  readonly mark: string;
  readonly title: string;
  /** One short line under the title; a state whose title says it all leaves it out. */
  readonly line?: string;
  /** The one action of the state, drawn under the line. */
  readonly action?: ReactNode;
  readonly icon?: ReactNode;
}

/** A centred card in the place of a list that holds nothing yet. */
export function EmptyCard({ mark, title, line, action, icon }: EmptyCardProps) {
  return (
    <div data-empty-card={mark} className="grid justify-items-center gap-2 rounded-card border border-hairline bg-band px-4 py-6 text-center">
      <span className="text-inkdim">{icon ?? <InboxIcon />}</span>
      <b className="text-[0.8125rem] font-bold leading-[1.25rem] text-ink">{title}</b>
      {line !== undefined ? <p className="m-0 text-[0.8125rem] leading-[1.25rem] text-inkdim">{line}</p> : null}
      {action !== undefined ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** A bordered info banner: the icon on the left, the text, and the action inside on the right. */
export function InfoBanner({ mark, children, action }: { readonly mark: string; readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <div {...{ [mark]: '' }} className="flex flex-wrap items-center gap-3 rounded-card border border-signal/40 bg-surface px-4 py-3">
      <InfoIcon />
      <span className="min-w-0 text-[0.8125rem] leading-[1.25rem] text-ink">{children}</span>
      {action !== undefined ? <span className="ml-auto flex-none">{action}</span> : null}
    </div>
  );
}

/** Roller: how many roles skip the recommended work style, with the fix inside the banner. */
export function RolesUnsetBanner({ locale, count, onApply }: { readonly locale: Locale; readonly count: number; readonly onApply: () => void }) {
  return (
    <InfoBanner
      mark="data-roles-unset"
      action={
        <ActionButton variant="neutral" onClick={onApply}>
          {t(locale, 'roles.unset.apply')}
        </ActionButton>
      }
    >
      {t(locale, 'roles.unset.line').replace('{n}', String(count))}
    </InfoBanner>
  );
}

/** Yetenekler: the discovery is not built yet; the card says so across the full width. */
export function CapabilitiesCard({ locale }: { readonly locale: Locale }) {
  return (
    <div data-capabilities-empty="">
      <EmptyCard mark="capabilities" title={t(locale, 'settings.capabilities.soonTitle')} line={t(locale, 'settings.capabilities.soonBody')} />
    </div>
  );
}
