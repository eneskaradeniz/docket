// screens/shell.tsx — the app shell (U-10's window): the navigation rail with the attention badge,
// the workspace switcher, and the content area that mounts the cockpit, a workspace's board, a
// work order's detail, or the settings. The first-run wizard rides above it all as an overlay: the
// shell mounts it, the wizard store's `open` decides whether it shows at all (U-7). The badge
// mirrors the shell store: the cockpit's attention count, present only while attention exists —
// zero renders nothing, never a zero. Every user-visible string arrives through a label key (U-1).
import { useEffect, useState, useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import type { BoardStore } from '../stores/board';
import type { CockpitStore } from '../stores/cockpit';
import type { LocaleStore } from '../stores/locale';
import type { SettingsStore } from '../stores/settings';
import type { ShellStore } from '../stores/shell';
import type { WizardStore } from '../stores/wizard';
import type { WorkOrderDetailStore } from '../stores/work-order-detail';
import { BoardScreen } from './board';
import { CockpitScreen } from './cockpit';
import { WorkOrderDetailScreen } from './detail';
import { SettingsScreen } from './settings';
import { WizardScreen } from './wizard';

export interface ShellScreenProps {
  readonly shell: ShellStore;
  readonly cockpit: CockpitStore;
  readonly board: BoardStore;
  readonly detail: WorkOrderDetailStore;
  readonly settings: SettingsStore;
  readonly wizard: WizardStore;
  /** The locale store's handle for the settings screen's language control (U-9); the active
   *  bundle itself travels as `locale`, refreshed by the root's subscription. */
  readonly localeStore: LocaleStore;
  readonly locale: Locale;
}

/** Where the shell can be. Routes carry only ids; the screens load their own data. */
type ShellRoute =
  | { readonly name: 'cockpit' }
  | { readonly name: 'board'; readonly workspace: string }
  | { readonly name: 'workOrder'; readonly id: string }
  | { readonly name: 'settings' };

const NAV_BASE =
  'flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-[7px] text-left text-[13.5px] transition-colors';

/** The rail entry's standing: the current route reads raised with an inset signal bar, the rest
 *  stay quiet — the same grammar as the design's sidebar. */
const navClass = (current: boolean): string =>
  current ? `${NAV_BASE} bg-raised shadow-[inset_2px_0_0_0] shadow-signal text-ink` : `${NAV_BASE} text-inkdim hover:bg-raised hover:text-ink`;

export function ShellScreen({ shell, cockpit, board, detail, settings, wizard, localeStore, locale }: ShellScreenProps) {
  const state = useSyncExternalStore(shell.subscribe, shell.state);
  const [route, setRoute] = useState<ShellRoute>({ name: 'cockpit' });
  useEffect(() => {
    void shell.load();
  }, [shell]);

  const badge = state.badge;
  const openWorkOrder = (id: string): void => setRoute({ name: 'workOrder', id });

  return (
    <div className="grid min-h-dvh grid-cols-[230px_minmax(0,1fr)] bg-bg text-ink max-[900px]:grid-cols-1">
      <nav
        aria-label={t(locale, 'shell.title')}
        className="flex flex-col gap-0.5 border-r border-hairline bg-surface px-2.5 py-4 max-[900px]:border-b max-[900px]:border-r-0 max-[900px]:px-3"
      >
        <p className="px-2.5 pb-3 font-mono text-[12px] font-medium uppercase tracking-[0.08em] text-inkdim">
          {t(locale, 'shell.title')}
        </p>

        <button type="button" onClick={() => setRoute({ name: 'cockpit' })} className={navClass(route.name === 'cockpit')} aria-current={route.name === 'cockpit' ? 'page' : undefined}>
          <span>{t(locale, 'nav.cockpit')}</span>
          {badge !== null ? (
            <span
              aria-label={t(locale, 'cockpit.section.attention')}
              className="font-mono text-[11px] font-medium text-signal"
            >
              {badge.count}
            </span>
          ) : null}
        </button>

        <button type="button" onClick={() => setRoute({ name: 'settings' })} className={navClass(route.name === 'settings')} aria-current={route.name === 'settings' ? 'page' : undefined}>
          <span>{t(locale, 'nav.settings')}</span>
        </button>

        <p className="px-2.5 pb-1 pt-4 font-mono text-[10.5px] uppercase tracking-[0.08em] text-inkdim">
          {t(locale, 'nav.workspaces')}
        </p>
        {state.workspaces.length === 0 ? (
          <p className="px-2.5 py-1.5 text-[12.5px] text-inkdim">{t(locale, 'nav.workspaces.empty')}</p>
        ) : (
          state.workspaces.map((entry) => {
            const current = route.name === 'board' && route.workspace === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setRoute({ name: 'board', workspace: entry.id })}
                className={navClass(current)}
                aria-current={current ? 'page' : undefined}
              >
                <span className="truncate font-mono text-[13px]">{entry.label}</span>
              </button>
            );
          })
        )}
      </nav>

      <main className="min-w-0 px-[22px] py-[18px] max-[900px]:p-3">
        {route.name === 'cockpit' ? (
          <CockpitScreen store={cockpit} locale={locale} onOpenWorkOrder={openWorkOrder} />
        ) : null}
        {route.name === 'board' ? (
          <BoardScreen store={board} workspace={route.workspace} locale={locale} onOpenWorkOrder={openWorkOrder} />
        ) : null}
        {route.name === 'workOrder' ? (
          <WorkOrderDetailScreen store={detail} workOrderId={route.id} locale={locale} />
        ) : null}
        {route.name === 'settings' ? <SettingsScreen store={settings} locale={locale} localeStore={localeStore} /> : null}
      </main>

      <WizardScreen store={wizard} locale={locale} />
    </div>
  );
}
