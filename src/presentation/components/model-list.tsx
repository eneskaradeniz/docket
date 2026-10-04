// components/model-list.tsx — the account editor's Modeller list (U-32, P-40): the catalog grouped
// by billing (Plana dahil without a mark, Kullanım başına ücretli with `$`, Doğrulanamadı with a
// dashed `?`), one row per catalog model — the display name, the tier chip when known, and the billing
// mark (`included` shows none, `metered` a currency mark, `unknown` a question mark with its
// explanation — never an amount or a price claim) — the unpinned default's one line above them,
// the stale note a kept-after-failed-refresh list carries with its refresh action, and the inline
// consent draft: one sentence of what may happen, the cap controls, allow (disabled until the cap
// parses — the store decides) and cancel. Purely presentational; the copy arrives resolved and the
// standing through props (U-1).
import type { ReactNode } from 'react';

import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { AccountModelsState, CapScope, ConsentDraft, ModelRowDisplay } from '../stores/account-models';
import { CAP_SCOPES, groupModels } from '../stores/account-models';
import { failureKey } from '../stores/results';
import { ActionButton } from './action-button';
import { Skeleton, SkeletonReveal, SkeletonStyle, useSkeleton } from './skeleton';
import { StateBadge } from './state-badge';

const TIER_KEY: Readonly<Record<'strong' | 'balanced' | 'fast', LabelKey>> = {
  strong: 'tier.strong',
  balanced: 'tier.balanced',
  fast: 'tier.fast',
};

const GROUP_KEY: Readonly<Record<'included' | 'metered' | 'unknown', LabelKey>> = {
  included: 'settings.models.group.included',
  metered: 'settings.models.group.metered',
  unknown: 'settings.models.group.unknown',
};

const GROUP_HINT_KEY: Readonly<Record<'included' | 'metered' | 'unknown', LabelKey>> = {
  included: 'settings.models.groupHint.included',
  metered: 'settings.models.groupHint.metered',
  unknown: 'settings.models.groupHint.unknown',
};

const CAP_SCOPE_KEY: Readonly<Record<CapScope, LabelKey>> = {
  account_day: 'cap.scope.account_day',
  account_week: 'cap.scope.account_week',
  account_month: 'cap.scope.account_month',
};

/** The billing mark's glyph with its explanation as the hover text: a currency mark for `metered`,
 *  a question mark for `unknown`. `included` renders no mark at all. */
const BillingMarkGlyph = ({ locale, billing }: { readonly locale: Locale; readonly billing: 'metered' | 'unknown' }) =>
  billing === 'metered' ? (
    <span className="font-mono text-[12px] text-signal" title={t(locale, 'settings.models.metered')}>
      $
    </span>
  ) : (
    <span className="rounded-control border border-dashed border-signal px-1 font-mono text-[12px] font-semibold text-signal" title={t(locale, 'settings.models.unknown')}>
      ?
    </span>
  );

/** One model row: name, tier chip, billing mark, and the consent standing — an allowed model
 *  carries its badge and the revoke action; a non-included one that is not allowed yet offers the
 *  select action that opens the consent draft; an included model needs neither. */
const ModelRow = ({
  row,
  locale,
  onSelect,
  onRevoke,
  card,
  reason,
}: {
  readonly row: ModelRowDisplay;
  readonly locale: Locale;
  readonly onSelect: (row: ModelRowDisplay) => void;
  readonly onRevoke: (model: string) => void;
  /** The inline consent card, rendered under the row it belongs to. */
  readonly card: ReactNode;
  /** Why an included model is in the plan ("haftalık limiti olduğu için planda"), or null. */
  readonly reason: string | null;
}) => (
  <li className="grid gap-2 border-t border-hairline px-3.5 py-2.5 first:border-t-0">
   <div className="flex min-w-0 items-center gap-2.5">
    <span className="min-w-0 truncate text-[13px] text-ink" title={row.name}>
      {row.name}
    </span>
    {row.tier !== null ? <StateBadge tone="dim">{t(locale, TIER_KEY[row.tier])}</StateBadge> : null}
    {row.billing !== 'included' ? <BillingMarkGlyph locale={locale} billing={row.billing} /> : null}
    {reason !== null ? <span className="ml-auto text-[12px] text-inkdim">{reason}</span> : null}
    <span className={`flex flex-none items-center gap-2 ${reason === null ? 'ml-auto' : ''}`}>
      {row.consented ? (
        <>
          <StateBadge tone="proceed">{t(locale, 'settings.models.allowed')}</StateBadge>
          <ActionButton variant="ghost" onClick={() => onRevoke(row.id)}>
            {t(locale, 'settings.models.revoke')}
          </ActionButton>
        </>
      ) : row.billing !== 'included' ? (
        <ActionButton variant="neutral" onClick={() => onSelect(row)}>
          {t(locale, 'settings.models.select')}
        </ActionButton>
      ) : null}
    </span>
   </div>
   {card}
  </li>
);

/** The inline consent draft (P-40): a bordered band inside the account card, never a modal — it
 *  states what may happen in one sentence, asks for the cap (the account's day, week or month and
 *  an amount), and its allow action is disabled until the entered cap parses. */
const ConsentPanel = ({
  draft,
  locale,
  onEditCap,
  onAllow,
  onCancel,
}: {
  readonly draft: ConsentDraft;
  readonly locale: Locale;
  readonly onEditCap: (input: { readonly scope?: CapScope; readonly amountUsd?: string }) => void;
  readonly onAllow: () => void;
  readonly onCancel: () => void;
}) => (
  <div
    role="group"
    aria-label={t(locale, 'settings.models.consent.title')}
    className="grid gap-2.5 rounded-card border border-signal/40 bg-band px-3 py-2.5"
  >
    <p className="text-[13px] font-semibold text-ink">
      {t(locale, 'settings.models.consent.title')}
      {draft.name === null ? '' : ` · ${draft.name}`}
    </p>
    <p className="max-w-[52ch] text-[12.5px] text-inkdim">
      {t(locale, draft.billing === 'metered' ? 'settings.models.metered' : 'settings.models.unknown')}
    </p>
    <p className="max-w-[52ch] text-[12.5px] text-inkdim">{t(locale, 'settings.models.consent.body')}</p>
    <p className="max-w-[52ch] text-[12.5px] text-inkdim">
      {t(locale, draft.capRequired ? 'settings.models.consent.capNeeded' : 'settings.models.consent.capHas')}
    </p>
    <div className="flex flex-wrap items-end gap-3">
      {draft.capRequired ? (
      <>
      <label className="grid gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">
          {t(locale, 'settings.models.consent.scope')}
        </span>
        <select
          value={draft.cap.scope}
          onChange={(event) => onEditCap({ scope: event.target.value as CapScope })}
          className="rounded-control border border-bord bg-raised px-2 py-[5px] text-[13px] text-ink outline-none focus:border-signal"
        >
          {CAP_SCOPES.map((scope) => (
            <option key={scope} value={scope}>
              {t(locale, CAP_SCOPE_KEY[scope])}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-inkdim">
          {t(locale, 'settings.models.consent.amount')}
        </span>
        <input
          value={draft.cap.amountUsd}
          onChange={(event) => onEditCap({ amountUsd: event.target.value })}
          inputMode="decimal"
          placeholder={t(locale, 'settings.models.consent.amountPlaceholder')}
          className="w-28 rounded-control border border-bord bg-raised px-2 py-[5px] font-mono text-[13px] text-ink outline-none placeholder:text-inkdim focus:border-signal"
        />
      </label>
      </>
      ) : null}
      <span className="flex items-center gap-2">
        <ActionButton variant="primary" disabled={!draft.allowEnabled} onClick={onAllow}>
          {t(locale, 'settings.models.consent.allow')}
        </ActionButton>
        <ActionButton variant="neutral" onClick={onCancel}>
          {t(locale, 'settings.models.consent.cancel')}
        </ActionButton>
      </span>
    </div>
    {draft.capRequired && !draft.allowEnabled ? (
      <p className="text-[12px] text-inkdim">{t(locale, 'settings.models.consent.amountHint')}</p>
    ) : null}
  </div>
);

export interface ModelListProps {
  readonly locale: Locale;
  readonly state: AccountModelsState;
  readonly onSelect: (row: ModelRowDisplay) => void;
  /** The unpinned default's own consent trigger — the account-level `*` marker (P-40). */
  readonly onSelectDefault: () => void;
  readonly onRefresh: () => void;
  readonly onEditCap: (input: { readonly scope?: CapScope; readonly amountUsd?: string }) => void;
  readonly onAllow: () => void;
  readonly onCancel: () => void;
  readonly onRevoke: (model: string) => void;
  /** Why an included model is in the plan, resolved; null when there is nothing to say. */
  readonly reasonOf?: (row: ModelRowDisplay) => string | null;
}

export function ModelList({ locale, state, onSelect, onSelectDefault, onRefresh, onEditCap, onAllow, onCancel, onRevoke, reasonOf }: ModelListProps) {
  const rows = state.rows;
  const defaultModel = state.defaultModel;
  const draftCard = (model: string): ReactNode =>
    state.draft !== null && state.draft.model === model ? (
      <ConsentPanel draft={state.draft} locale={locale} onEditCap={onEditCap} onAllow={onAllow} onCancel={onCancel} />
    ) : null;
  const { skeleton, reveal } = useSkeleton(state.loading && rows === null, () => Date.now());

  return (
    <div className="grid gap-2.5 border-t border-hairline pt-2.5" data-model-list>
      {state.problem !== null ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {state.lastOutcome !== null && !state.lastOutcome.result.ok ? (
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, state.lastOutcome.labelKey)}
        </div>
      ) : null}

      {skeleton || rows === null
        ? null
        : state.stale && (
            <p className="flex flex-wrap items-center gap-2 text-[12px] text-inkdim">
              {t(locale, 'settings.models.stale')}
              <ActionButton variant="ghost" disabled={state.refreshing} onClick={onRefresh}>
                {t(locale, 'settings.models.refresh')}
              </ActionButton>
            </p>
          )}

      {skeleton ? (
        <div aria-busy="true" className="grid gap-2">
          <SkeletonStyle />
          <Skeleton height="18px" radius="control" width="42%" />
          <Skeleton height="18px" radius="control" width="68%" />
          <Skeleton height="18px" radius="control" width="55%" />
        </div>
      ) : rows === null ? null : (
        <SkeletonReveal active={reveal} className="grid gap-2">
          {rows.length === 0 && defaultModel === null ? (
            <p className="text-[12.5px] text-inkdim">{t(locale, 'settings.models.empty')}</p>
          ) : (
            <>
              {/* The unpinned default: the billing a run without a pinned model would take, and
                  its own consent standing through the * marker. An included default shows the line
                  with no mark and no action — nothing to consent. */}
              {defaultModel !== null ? (
                <div className="grid gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="min-w-0 truncate text-[13px] font-semibold text-ink" title={t(locale, 'settings.models.default')}>
                    {t(locale, 'settings.models.default')}
                  </span>
                  {defaultModel.billing !== 'included' ? (
                    <>
                      <BillingMarkGlyph locale={locale} billing={defaultModel.billing} />
                      <span className="ml-auto flex flex-none items-center gap-2">
                        {defaultModel.consented ? (
                          <>
                            <StateBadge tone="proceed">{t(locale, 'settings.models.allowed')}</StateBadge>
                            <ActionButton variant="ghost" onClick={() => onRevoke('*')}>
                              {t(locale, 'settings.models.revoke')}
                            </ActionButton>
                          </>
                        ) : (
                          <ActionButton variant="neutral" onClick={onSelectDefault}>
                            {t(locale, 'settings.models.select')}
                          </ActionButton>
                        )}
                      </span>
                    </>
                  ) : null}
                </div>
                {draftCard('*')}
                </div>
              ) : null}
              {groupModels(rows).map((group) => (
                <section key={group.billing} className="overflow-hidden rounded-card border border-hairline" data-billing-group={group.billing}>
                  <h4 className="border-b border-hairline bg-band px-3.5 py-2 text-[13px] font-bold text-ink">
                    {t(locale, GROUP_KEY[group.billing])}
                    <span className="font-medium text-inkdim"> · {t(locale, GROUP_HINT_KEY[group.billing])}</span>
                  </h4>
                  <ul className="m-0 list-none p-0">
                    {group.rows.map((row) => (
                      <ModelRow key={row.id} row={row} locale={locale} onSelect={onSelect} onRevoke={onRevoke} card={draftCard(row.id)} reason={reasonOf?.(row) ?? null} />
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </SkeletonReveal>
      )}

    </div>
  );
}
