// components/accounts-sections.tsx — Settings → Hesaplar as two disclosures, Eklenenler and
// Eklenmemiş: a header button (turning chevron, name, count badge, an `aside` slot at the right
// edge for the section's own action) over one bordered panel card. A section with nothing in it
// shows its empty card instead of the list. The host owns the open standing.
import type { ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import { ActionButton } from './action-button';
import { EmptyCard, ListBottomFade } from './settings-cards';

export type AccountsSectionKind = 'added' | 'unadded';

export interface AccountsSectionsProps {
  readonly locale: Locale;
  readonly addedCount: number;
  readonly unaddedCount: number;
  readonly addedOpen: boolean;
  readonly unaddedOpen: boolean;
  readonly onToggle: (kind: AccountsSectionKind) => void;
  /** "Hesap ekle" of the empty Eklenenler card: it brings the operator to the addable accounts. */
  readonly onAdd: () => void;
  readonly added: ReactNode;
  readonly unadded: ReactNode;
  /** The right-aligned slot of each header (the scan's own action lives there). */
  readonly addedAside?: ReactNode;
  readonly unaddedAside?: ReactNode;
}

function Disclosure({
  kind,
  title,
  count,
  open,
  onToggle,
  aside,
  children,
}: {
  readonly kind: AccountsSectionKind;
  readonly title: string;
  readonly count: number;
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly aside?: ReactNode;
  readonly children: ReactNode;
}) {
  const buttonId = `accounts-${kind}`;
  const panelId = `${buttonId}-body`;
  return (
    <section data-account-disclosure={kind} aria-labelledby={buttonId} className="grid gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          id={buttonId}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-w-0 items-center gap-2 rounded-control px-2 py-1.5 text-left text-[0.8125rem] font-extrabold leading-[1.25rem] text-ink hover:bg-raised"
        >
          <svg
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3.5 w-3.5 flex-none text-inkdim motion-safe:transition-transform motion-reduce:transition-none ${open ? '' : '-rotate-90'}`}
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
          <span>{title}</span>
          <span data-count-badge="" className="rounded-full border border-hairline bg-raised px-2 text-[0.75rem] font-semibold leading-[1.125rem] text-inkdim">
            {count}
          </span>
        </button>
        <span data-section-aside={kind} className="ml-auto flex items-center">
          {aside}
        </span>
      </div>
      {/* The panel's own `hidden` stays on a plain wrapper: a display class on the same element
          would win over the attribute and keep a closed section on screen. */}
      <div id={panelId} hidden={!open}>
        <div className="grid gap-3 p-4 rounded-panel border border-hairline bg-surface">{children}</div>
      </div>
    </section>
  );
}

export function AccountsSections({ locale, addedCount, unaddedCount, addedOpen, unaddedOpen, onToggle, onAdd, added, unadded, addedAside, unaddedAside }: AccountsSectionsProps) {
  return (
    <div className="grid gap-5" data-accounts-sections="">
      <Disclosure kind="added" title={t(locale, 'accountGroups.added')} count={addedCount} open={addedOpen} onToggle={() => onToggle('added')} aside={addedAside}>
        {addedCount === 0 ? (
          <EmptyCard
            mark="accounts-added"
            title={t(locale, 'accounts.added.empty.title')}
            line={t(locale, 'accounts.added.empty.line')}
            action={
              <ActionButton variant="primary" size="md" onClick={onAdd}>
                {t(locale, 'accounts.added.empty.add')}
              </ActionButton>
            }
          />
        ) : (
          added
        )}
      </Disclosure>
      <Disclosure kind="unadded" title={t(locale, 'candidates.title')} count={unaddedCount} open={unaddedOpen} onToggle={() => onToggle('unadded')} aside={unaddedAside}>
        {unaddedCount === 0 ? <EmptyCard mark="accounts-unadded" title={t(locale, 'accounts.unadded.empty.title')} line={t(locale, 'accounts.unadded.empty.line')} /> : unadded}
      </Disclosure>
      {/* The list's scroll cue: pinned to the window body's bottom edge while the panels continue
          below it, resting under the last card once the end arrives. */}
      <ListBottomFade />
    </div>
  );
}
