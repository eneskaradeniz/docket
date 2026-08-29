// UsageScreen (WO-0054) — the THIRD surface: the month head · the live quota · the breakdown ·
// the spend list, ONE 840px scroll in that fixed order (mockup karar 1; no tabs, no drill-down —
// the detail's home is the WO card and the CLI tail). The read is workspace-keyed like the
// board's and the roadmap's (a fresh surface on swap). `view === undefined` → the named loadline;
// `empty` → the invitation face and the LEDGER sections gone — no zero bars, no empty cards, no
// figures (AC6) — with the unledgered line DIRECTLY UNDER THE INVITATION when the pre-WO-0052
// vintage exists (architect F4: the spend list does not render on this face). The LIVE quota
// panel is not a ledger figure (the provider's own % — no $ anywhere): it still renders on the
// empty face when a drive signals, or a running ✦ draft on an unledgered workspace would be
// invisible exactly when the operator most needs the window (D7's draft-arm spec pins it).
//
// The LIVE quota panel reads the running drive's fold through the app-level drive store, BOTH
// arms: the WO arm through activeSnapshot (running AND its woId ∈ this workspace's WO ids —
// another workspace's drive never paints this screen, karar 4) and the ✦ draft arm through the
// `${workspaceId}:draft` key (a draft key never enters activeSnapshot — drive-store.ts:101-105).
// The store's one-active-drive rule makes the arms mutually exclusive; without a signal the
// section is ABSENT, never from rows, never from a stamp (AC3, the WO-0053 rule inherited).
import { useCallback, useSyncExternalStore } from 'react';
import type { WorkspaceBudgetView } from '../../core/budget';
import { initialSessionState } from '../../core/runner';
import type { WorkspaceUsageView } from '../../core/usage';
import type { WorkOrderId, Workspace } from '../../core/types';
import { useLabels } from '../data/locale';
import { useActiveDrive, useDrive, useDriveStore } from '../components/session/drive-store';
import { UsageHeadCard } from '../components/usage/UsageHeadCard';
import { UsageLimitPanel } from '../components/usage/UsageLimitPanel';
import { UsageBreakdownCard } from '../components/usage/UsageBreakdownCard';
import { UsageSpendList } from '../components/usage/UsageSpendList';

export function UsageScreen({
  view,
  budget,
  workspace,
  woIds,
}: {
  view: WorkspaceUsageView | undefined; // undefined = the read is in flight
  /** The EXISTING budget view — the head renders it, never re-derives it (WO-0047's line). */
  budget?: WorkspaceBudgetView;
  workspace: Workspace;
  /** The workspace's WO ids — the WO arm's membership test (App's snapshot already has them). */
  woIds: WorkOrderId[];
}) {
  const { UI, ROLE_LABELS, woIdLabel } = useLabels();
  const driveStore = useDriveStore();
  const active = useActiveDrive(driveStore);
  const draftKey = `${workspace.id}:draft`;
  // activeSnapshot only builds a snapshot for a WO-keyed drive, but the TYPE carries
  // `woId?: WorkOrderId` — the explicit narrowing is the ADR-0003 discipline (no ui-side cast).
  const woArm =
    active !== undefined && active.running && active.woId !== undefined && woIds.includes(active.woId)
      ? active
      : undefined;
  // The draft arm's liveness read is a SUBSCRIPTION (the review round's fix): a plain
  // `driveStore.get(draftKey)?.running` during render is non-reactive — a future
  // "start a draft from elsewhere" would leave the panel absent until an unrelated re-render.
  // A boolean snapshot is identity-stable, so no #185-style loop.
  const draftRunning = useSyncExternalStore(
    driveStore.subscribe,
    () => driveStore.get(draftKey)?.running ?? false,
    () => false,
  );
  const liveKey = woArm !== undefined ? woArm.key : draftRunning ? draftKey : undefined;
  // The seed is a STABLE identity (the RoadmapScreen precedent — a fresh object per getSnapshot
  // call loops React, #185). No drive ever holds the '' key, so the idle arm reads the initial
  // state; the hook order stays stable across arm switches.
  const seedFn = useCallback(() => initialSessionState, []);
  const liveState = useDrive(driveStore, liveKey ?? '', seedFn);
  const liveHandle = liveKey !== undefined ? driveStore.get(liveKey) : undefined;
  const running = liveHandle?.running ?? false;
  const windows = running ? liveState.limitWindows : undefined;
  const input = liveKey !== undefined ? driveStore.inputOf(liveKey) : undefined;
  const roleWord = input?.role !== undefined ? ROLE_LABELS[input.role] : '';
  const who =
    liveKey === undefined
      ? ''
      : woArm !== undefined && woArm.woId !== undefined
        ? UI.usageLimitMeta(roleWord, woIdLabel(woArm.woId))
        : UI.usageLimitDraftMeta(roleWord);

  let body;
  if (view === undefined) {
    body = <p className="loadline px-1 py-8">{UI.loadUsage}</p>;
  } else if (view.empty) {
    body = (
      <>
        {windows !== undefined ? <UsageLimitPanel windows={windows.windows} status={windows.status} who={who} /> : null}
        <div data-usage-empty className="rounded-md border border-dashed border-hairline px-3 py-2.5">
          <p className="text-sm text-ink">{UI.usageEmptyLine}</p>
          <p className="mt-1 text-xs text-inkdim">{UI.usageEmptyNote}</p>
          {view.unledgeredCount > 0 ? (
            <p className="mt-1 text-xs text-inkdim">{UI.usageUnledgeredLine(view.unledgeredCount)}</p>
          ) : null}
        </div>
      </>
    );
  } else {
    body = (
      <div className="flex flex-col gap-3">
        <UsageHeadCard budget={budget} usage={view} />
        {windows !== undefined ? <UsageLimitPanel windows={windows.windows} status={windows.status} who={who} /> : null}
        <UsageBreakdownCard view={view} />
        <UsageSpendList view={view} />
      </div>
    );
  }
  return (
    <main data-usage-screen className="mx-auto w-full max-w-[840px] px-5 py-5">
      {body}
    </main>
  );
}
