// components/memory-section.tsx — Settings → Hafıza: proposals, auto-accept per scope, saved notes.
import { useSyncExternalStore } from 'react';

import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { AgentCapabilitiesStore, MemoryScope } from '../stores/agent-capabilities';
import { failureKey } from '../stores/results';
import { ActionButton } from './action-button';
import { SegmentedControl } from './segmented-control';
import { SettingRow, SettingRows } from './setting-row';
import { EmptyCard } from './settings-cards';
import { Skeleton, SkeletonStyle } from './skeleton';

const SCOPES: readonly MemoryScope[] = ['global', 'project', 'repo'];

const SCOPE_KEY: Readonly<Record<MemoryScope, LabelKey>> = {
  global: 'capabilities.memory.scope.global',
  project: 'capabilities.memory.scope.project',
  repo: 'capabilities.memory.scope.repo',
};

export interface MemorySectionProps {
  readonly locale: Locale;
  readonly store: AgentCapabilitiesStore;
  readonly active: boolean;
}

export function MemorySection({ locale, store, active }: MemorySectionProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  const memory = state.memory;
  const scope = state.memoryScope;

  const scopeLabel = (item: { readonly scope: MemoryScope; readonly scopeId?: string }): string => {
    const base = t(locale, SCOPE_KEY[item.scope]);
    if (item.scope === 'global') return base;
    const id = item.scopeId ?? '';
    if (item.scope === 'project') return `${base} · ${state.projectNames[id] ?? id}`;
    return `${base} · ${state.repoNames[id] ?? id}`;
  };

  if (!active) return null;

  if (state.loading && memory === null) {
    return (
      <div aria-busy="true">
        <SkeletonStyle />
        <Skeleton width="100%" height="6rem" radius="card" />
      </div>
    );
  }

  if (state.problem !== null && memory === null) {
    return (
      <div role="alert" className="rounded-card border border-error/40 px-3 py-3 text-[13px] text-error">
        {t(locale, failureKey(state.problem))}
      </div>
    );
  }

  if (memory === null) return null;

  const proposals = memory.proposals.filter((row) => row.state === 'pending' && row.scope === scope);
  const notes = memory.notes.filter((row) => row.active && row.scope === scope);
  const autoOn =
    scope === 'global' ? memory.autoAccept.global : scope === 'project' ? memory.autoAccept.project : memory.autoAccept.repo;
  const empty = proposals.length === 0 && notes.length === 0;

  return (
    <div className="grid gap-3" data-memory-section="">
      <SegmentedControl
        label={t(locale, 'capabilities.memory.scope.label')}
        value={scope}
        onPick={(next) => store.setMemoryScope(next)}
        options={SCOPES.map((entry) => ({ id: entry, text: t(locale, SCOPE_KEY[entry]) }))}
      />

      <SettingRows>
        <SettingRow
          framed
          locale={locale}
          title={t(locale, 'capabilities.memory.autoAccept.title')}
          purpose={t(locale, 'capabilities.memory.autoAccept.purpose')}
          control={
            <button
              type="button"
              role="switch"
              aria-checked={autoOn}
              aria-label={t(locale, 'capabilities.memory.autoAccept.title')}
              onClick={() => void store.setAutoAccept(scope, !autoOn)}
              className={`relative h-5 w-9 flex-none rounded-full border transition-colors ${autoOn ? 'border-ink bg-ink' : 'border-hairline bg-raised'}`}
            >
              <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-[left] ${autoOn ? 'left-[18px] bg-bg' : 'left-0.5 bg-ink'}`} />
            </button>
          }
        />
      </SettingRows>

      {memory.truncated ? (
        <p className="m-0 text-[12.5px] text-signal-soft">{t(locale, 'capabilities.memory.truncated')}</p>
      ) : null}

      {proposals.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="m-0 text-[13px] font-bold text-ink">{t(locale, 'capabilities.memory.proposals.title')}</h3>
          <SettingRows>
            {proposals.map((row) => (
              <SettingRow
                key={row.id}
                framed
                locale={locale}
                title={row.text}
                below={
                  <div className="flex flex-wrap items-center gap-2 text-[12px] text-inkdim">
                    <span className="rounded-full bg-raised px-2 py-0.5">{scopeLabel(row)}</span>
                    <span className="font-mono">{row.sourceRun}</span>
                    {/* The proposal rows are many at once; each takes the outline so the view keeps
                        at most one primary (U-375). */}
                    <ActionButton
                      variant="neutral"
                      size="sm"
                      aria-label={`${t(locale, 'capabilities.memory.accept')}: ${row.text}`}
                      onClick={() => void store.acceptProposal(row.id)}
                    >
                      {t(locale, 'capabilities.memory.accept')}
                    </ActionButton>
                    <ActionButton
                      variant="neutral"
                      size="sm"
                      aria-label={`${t(locale, 'capabilities.memory.reject')}: ${row.text}`}
                      onClick={() => void store.rejectProposal(row.id)}
                    >
                      {t(locale, 'capabilities.memory.reject')}
                    </ActionButton>
                  </div>
                }
                control={null}
              />
            ))}
          </SettingRows>
        </section>
      ) : null}

      {notes.length > 0 ? (
        <section className="grid gap-2">
          <h3 className="m-0 text-[13px] font-bold text-ink">{t(locale, 'capabilities.memory.notes.title')}</h3>
          <SettingRows>
            {notes.map((row) => (
              <SettingRow
                key={row.id}
                framed
                locale={locale}
                title={row.text}
                below={
                  <div className="flex flex-wrap gap-2 text-[12px] text-inkdim">
                    <span className="rounded-full bg-raised px-2 py-0.5">{scopeLabel(row)}</span>
                    <span className="rounded-full bg-band px-2 py-0.5">
                      {row.createdBy === 'user' ? t(locale, 'capabilities.memory.note.user') : t(locale, 'capabilities.memory.note.agent')}
                    </span>
                  </div>
                }
                control={null}
              />
            ))}
          </SettingRows>
        </section>
      ) : null}

      {/* The empty card and the create form never stand together — the card's own opener hides
          while the form is open, so the view keeps one primary (U-375). */}
      {empty && state.view !== 'create' ? (
        <EmptyCard
          mark="capabilities-memory"
          title={t(locale, 'capabilities.empty.memory.title')}
          line={t(locale, 'capabilities.empty.memory.line')}
          action={
            <ActionButton variant="primary" onClick={() => store.openCreate()}>
              {t(locale, 'capabilities.empty.createAction')}
            </ActionButton>
          }
        />
      ) : null}

      {state.view === 'create' && state.createDraft?.kind === 'memory' ? (
        <div className="rounded-card border border-hairline bg-surface shadow-elevation-card p-3" data-memory-create="">
          <label className="grid gap-1 text-[13px]">
            <span className="font-semibold text-ink">{t(locale, 'capabilities.empty.createAction')}</span>
            <textarea
              className="min-h-[4rem] rounded-control border border-bord bg-transparent px-2.5 py-2 text-[13px] text-ink"
              value={state.createDraft.text}
              onChange={(event) => {
                const draft = state.createDraft;
                if (draft?.kind !== 'memory') return;
                store.setCreateDraft({ kind: 'memory', text: event.target.value, scope, scopeId: draft.scopeId });
              }}
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            <ActionButton variant="neutral" size="sm" onClick={() => store.cancelCreate()}>
              {t(locale, 'repoSettings.saveBar.cancel')}
            </ActionButton>
            <ActionButton variant="primary" size="sm" disabled={state.saving || state.createDraft.text.trim() === ''} onClick={() => void store.saveCreate()}>
              {t(locale, 'repoSettings.saveBar.save')}
            </ActionButton>
          </div>
        </div>
      ) : null}
    </div>
  );
}
