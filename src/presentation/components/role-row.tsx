// components/role-row.tsx — the Roller section's two pieces (U-33): "Asistan sırası", the global
// chain reordered with ↑/↓ or Alt+↑/↓, and one row per role with its work style, the U-29
// recommendation line, the fine-tune disclosure (own chain with model pins, kademe, düşünme, the
// stages' own settings read-only) and the amber same-provider-review line. The rules live in
// stores/roles.ts; this file renders them and forwards intents. Copy arrives through label keys.
import { useEffect, useState, useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import {
  selectableModels,
  THINKING_LEVELS,
  TIERS,
  WORK_STYLES,
  type RoleAccount,
  type RoleRow,
  type RolesStore,
  type Thinking,
  type Tier,
} from '../stores/roles';
import { SAVED_FLAG_MS } from '../stores/account-editor';
import type { WorkStyle } from '../stores/recommended';
import { ActionButton } from './action-button';
import { ProviderMark, type ProviderMarkProps } from './provider-mark';
import { SegmentedControl } from './segmented-control';
import { SettingRow } from './setting-row';

const STYLE_KEY: Readonly<Record<WorkStyle | 'custom', LabelKey>> = {
  fast: 'roles.style.fast',
  balanced: 'roles.style.balanced',
  careful: 'roles.style.careful',
  custom: 'roles.style.custom',
};

const TIER_KEY: Readonly<Record<Tier, LabelKey>> = {
  strong: 'tier.strong',
  balanced: 'tier.balanced',
  fast: 'tier.fast',
};

const LEVEL_KEY: Readonly<Record<string, LabelKey>> = {
  fast: 'roles.thinking.level.fast',
  balanced: 'roles.thinking.level.balanced',
  deep: 'roles.thinking.level.deep',
};

const SELECT_CLASS =
  'rounded-control border border-bord bg-transparent px-2.5 py-1 text-[13px] text-ink focus:border-signal focus:outline-none';

/** Re-renders once when a "Kaydedildi" flag's 1.5 s are up. */
function useSavedFlag(store: RolesStore, row: string): boolean {
  const [, bump] = useState(0);
  const saved = store.isSaved(row);
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => bump((n) => n + 1), SAVED_FLAG_MS);
    return () => window.clearTimeout(timer);
  }, [saved]);
  return saved;
}

export type MarkFor = (provider: string) => ProviderMarkProps['mark'];

function MoveButtons({
  locale,
  name,
  index,
  count,
  onMove,
}: {
  readonly locale: Locale;
  readonly name: string;
  readonly index: number;
  readonly count: number;
  readonly onMove: (delta: number) => void;
}) {
  const button = 'rounded-control border border-bord px-1.5 py-0.5 text-[12px] text-ink hover:bg-raised disabled:opacity-40';
  return (
    <span className="flex flex-none gap-1">
      <button type="button" className={button} disabled={index === 0} aria-label={t(locale, 'roles.chain.up').replace('{name}', name)} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button type="button" className={button} disabled={index === count - 1} aria-label={t(locale, 'roles.chain.down').replace('{name}', name)} onClick={() => onMove(1)}>
        ↓
      </button>
    </span>
  );
}

export interface ChainSectionProps {
  readonly store: RolesStore;
  readonly locale: Locale;
  readonly markFor: MarkFor;
}

/** Asistan sırası: the chain every role without its own uses. */
export function ChainSection({ store, locale, markFor }: ChainSectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const saved = useSavedFlag(store, 'chain');
  const failure = state.failure?.row === 'chain' ? state.failure.labelKey : undefined;
  const chain = state.globalChain
    .map((id) => state.accounts.find((account) => account.id === id))
    .filter((account): account is RoleAccount => account !== undefined);
  return (
    <div className="grid gap-2 border-b border-hairline pb-3" data-roles-chain>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[13.5px] font-semibold text-ink">{t(locale, 'roles.chain.title')}</p>
          <p className="text-[12.5px] text-inkdim">{t(locale, 'roles.chain.purpose')}</p>
        </div>
        {saved ? (
          <span role="status" className="text-[12px] text-proceed">
            {t(locale, 'editor.saved')}
          </span>
        ) : null}
      </div>
      {chain.length === 0 ? (
        <p className="text-[13px] text-inkdim">{t(locale, 'roles.chain.empty')}</p>
      ) : (
        <ol className="grid gap-1.5">
          {chain.map((account, index) => (
            <li
              key={account.id}
              tabIndex={0}
              onKeyDown={(event) => {
                if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
                event.preventDefault();
                void store.moveGlobal(index, event.key === 'ArrowUp' ? -1 : 1);
              }}
              className="flex items-center gap-3 rounded-card border border-hairline bg-surface px-3 py-2 focus:border-signal focus:outline-none"
              data-chain-account={account.id}
            >
              <span className="w-4 flex-none text-[12px] text-inkdim">{index + 1}</span>
              <ProviderMark provider={account.provider} mark={markFor(account.provider)} />
              <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{account.label}</span>
              <MoveButtons locale={locale} name={account.label} index={index} count={chain.length} onMove={(delta) => void store.moveGlobal(index, delta)} />
            </li>
          ))}
        </ol>
      )}
      {failure !== undefined ? (
        <p role="alert" className="text-[12px] text-error">
          {t(locale, failure)}
        </p>
      ) : null}
    </div>
  );
}

const thinkingValue = (thinking: Thinking | null): string =>
  thinking === null ? '' : 'level' in thinking ? `level:${thinking.level}` : `effort:${thinking.effort}`;

const parseThinking = (value: string): Thinking | null => {
  if (value.startsWith('level:')) return { level: value.slice(6) };
  if (value.startsWith('effort:')) return { effort: value.slice(7) };
  return null;
};

const stageSetting = (locale: Locale, stage: RoleRow['stages'][number]): string =>
  [
    stage.tier === null ? null : t(locale, TIER_KEY[stage.tier]),
    stage.thinking === null
      ? null
      : 'level' in stage.thinking
        ? t(locale, LEVEL_KEY[stage.thinking.level] ?? 'roles.thinking.unset')
        : t(locale, 'roles.thinking.effort').replace('{value}', stage.thinking.effort),
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

function FineTune({ row, store, locale, markFor }: { readonly row: RoleRow; readonly store: RolesStore; readonly locale: Locale; readonly markFor: MarkFor }) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const label = (id: string): string => state.accounts.find((account) => account.id === id)?.label ?? id;
  const provider = (id: string): string => state.accounts.find((account) => account.id === id)?.provider ?? '';
  const outside = state.accounts.filter((account) => !row.chain.some((entry) => entry.accountId === account.id));
  const efforts =
    row.thinking !== null && 'effort' in row.thinking && !row.efforts.includes(row.thinking.effort)
      ? [...row.efforts, row.thinking.effort]
      : row.efforts;
  return (
    <div className="grid gap-3" data-role-finetune={row.id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{t(locale, 'roles.chainMode.title')}</span>
        <SegmentedControl
          label={t(locale, 'roles.chainMode.title')}
          value={row.chainMode}
          options={[
            { id: 'all', text: t(locale, 'roles.chainMode.all') },
            { id: 'own', text: t(locale, 'roles.chainMode.own') },
          ]}
          onPick={(mode) => void store.setChainMode(row.id, mode)}
        />
      </div>
      {row.chainMode === 'all' ? (
        <p className="text-[12.5px] text-inkdim">{row.chain.map((entry) => label(entry.accountId)).join(' → ')}</p>
      ) : (
        <div className="grid gap-1.5">
          {row.chain.map((entry, index) => {
            const catalog = state.catalogs[entry.accountId];
            const usable = catalog === undefined ? [] : selectableModels(catalog);
            return (
              <div key={entry.accountId} className="flex flex-wrap items-center gap-2 rounded-card border border-hairline bg-surface px-3 py-2" data-own-account={entry.accountId}>
                <ProviderMark provider={provider(entry.accountId)} mark={markFor(provider(entry.accountId))} />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{label(entry.accountId)}</span>
                <select
                  className={SELECT_CLASS}
                  aria-label={`${label(entry.accountId)} · ${t(locale, 'roles.model.default')}`}
                  value={entry.model ?? ''}
                  onChange={(event) => void store.pinModel(row.id, entry.accountId, event.target.value === '' ? null : event.target.value)}
                >
                  <option value="">{t(locale, 'roles.model.default')}</option>
                  {catalog?.models.map((model) => {
                    const allowed = usable.some((candidate) => candidate.id === model.id);
                    const name = model.displayName ?? model.id;
                    return (
                      <option key={model.id} value={model.id} disabled={!allowed}>
                        {allowed ? name : t(locale, 'roles.model.paidLocked').replace('{model}', name)}
                      </option>
                    );
                  })}
                </select>
                <MoveButtons locale={locale} name={label(entry.accountId)} index={index} count={row.chain.length} onMove={(delta) => void store.moveOwn(row.id, index, delta)} />
                <ActionButton variant="ghost" onClick={() => void store.toggleAccount(row.id, entry.accountId)}>
                  ✕
                </ActionButton>
              </div>
            );
          })}
          {outside.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {outside.map((account) => (
                <ActionButton key={account.id} variant="neutral" onClick={() => void store.toggleAccount(row.id, account.id)}>
                  + {account.label}
                </ActionButton>
              ))}
            </div>
          ) : null}
          <p className="text-[11.5px] text-inkdim">{t(locale, 'roles.model.hint')}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{t(locale, 'roles.tier.title')}</span>
        <select
          className={SELECT_CLASS}
          aria-label={t(locale, 'roles.tier.title')}
          value={row.tier ?? ''}
          onChange={(event) => void store.setTier(row.id, TIERS.find((tier) => tier === event.target.value) ?? null)}
        >
          <option value="">{t(locale, 'roles.tier.unset')}</option>
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {t(locale, TIER_KEY[tier])}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{t(locale, 'roles.thinking.title')}</span>
        <select
          className={SELECT_CLASS}
          aria-label={t(locale, 'roles.thinking.title')}
          value={thinkingValue(row.thinking)}
          onChange={(event) => void store.setThinking(row.id, parseThinking(event.target.value))}
        >
          <option value="">{t(locale, 'roles.thinking.unset')}</option>
          {THINKING_LEVELS.map((level) => (
            <option key={level} value={`level:${level}`}>
              {t(locale, LEVEL_KEY[level] ?? 'roles.thinking.unset')}
            </option>
          ))}
          {efforts.map((effort) => (
            <option key={effort} value={`effort:${effort}`}>
              {t(locale, 'roles.thinking.effort').replace('{value}', effort)}
            </option>
          ))}
        </select>
      </div>
      {row.stages.length > 0 ? (
        <div className="grid gap-1" data-role-stages>
          <span className="text-[12.5px] font-semibold text-ink">{t(locale, 'roles.stages.title')}</span>
          <span className="text-[11.5px] text-inkdim">{t(locale, 'roles.stages.note')}</span>
          <ul className="grid gap-1">
            {row.stages.map((stage) => (
              <li key={`${stage.flowName}:${stage.stageName}`} className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-inkdim">
                <span className="font-mono text-[11.5px]">{t(locale, 'roles.stages.line').replace('{flow}', stage.flowName).replace('{stage}', stage.stageName)}</span>
                <span>{stageSetting(locale, stage)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export interface RoleRowProps {
  readonly row: RoleRow;
  readonly store: RolesStore;
  readonly locale: Locale;
  readonly markFor: MarkFor;
  /** İnce ayar starts open and the row scrolls into view — a role chip's landing (U-37). */
  readonly fineTuneOpen?: boolean;
}

/** One role: work style, the recommendation line, the amber review line and İnce ayar. */
export function RoleRowView({ row, store, locale, markFor, fineTuneOpen = false }: RoleRowProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const saved = useSavedFlag(store, row.id);
  const failure = state.failure?.row === row.id ? state.failure.labelKey : undefined;
  // The fine-tune needs the chain's catalogs for pins and exact efforts; one query per account.
  const chainIds = row.chain.map((entry) => entry.accountId).join('|');
  useEffect(() => {
    for (const entry of row.chain) if (state.catalogs[entry.accountId] === undefined) void store.loadModels(entry.accountId);
  }, [chainIds, store]);
  // The row a role chip pointed at comes into view once, with its İnce ayar already open.
  useEffect(() => {
    if (fineTuneOpen) document.querySelector(`[data-role-finetune="${CSS.escape(row.id)}"]`)?.scrollIntoView({ block: 'center' });
  }, [fineTuneOpen, row.id]);
  return (
    <SettingRow
      locale={locale}
      title={row.name}
      saved={saved}
      {...(row.differs ? { differsFrom: t(locale, STYLE_KEY[row.recommended]), onReset: () => void store.resetStyle(row.id) } : {})}
      {...(failure !== undefined ? { failure: t(locale, failure) } : {})}
      {...(row.sameProviderReview ? { note: t(locale, 'roles.review.sameProvider') } : {})}
      control={
        <span className="flex items-center gap-2">
          <SegmentedControl
            label={`${row.name} · ${t(locale, 'roles.style.title')}`}
            value={row.style === 'custom' || row.style === 'unset' ? null : row.style}
            {...(row.style === 'custom' ? { standing: t(locale, STYLE_KEY.custom) } : {})}
            options={WORK_STYLES.map((style) => ({
              id: style,
              text: t(locale, STYLE_KEY[style]),
              ...(style === row.recommended ? { hint: t(locale, 'editor.recommended') } : {}),
            }))}
            onPick={(style) => void store.setStyle(row.id, style)}
          />
        </span>
      }
      disclosure={{
        label: t(locale, 'roles.fine'),
        startsOpen: fineTuneOpen || row.differs || row.chainMode === 'own',
        children: <FineTune row={row} store={store} locale={locale} markFor={markFor} />,
      }}
    />
  );
}
