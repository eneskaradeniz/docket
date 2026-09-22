import type { StepRole, WorkOrderDetailView } from '../../core/types';
import type { PermissionRule, UpdateWorkOrderInput } from '../../core/source';
import type { WorkspaceBudgetView } from '../../core/budget';
import type { ChangesBridge } from '../components/detail/ChangesSection';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

// The console FRAME (WO-0031c / v4 → WO-0039 rail-free): the detail fills the viewport below the
// 48px AppShell bar — one DOSYA scroll under the header band (ADR-0013; the bottom rail died with
// WO-0039). The board keeps its normal page scroll; only the detail is a console.
export function DetailScreen({
  detail,
  docs,
  permissionRule,
  onBack,
  onApprovePlan,
  onSavePlanDraft,
  onGetOriginalPlan,
  onRestoreOriginalPlan,
  onUpdateWorkOrder,
  onRecordPermissionDecision,
  onGetStepReport,
  onGetStepVerdict,
  onResetStep,
  budget,
  onRaiseBudget,
  reloadDetail,
  onDelete,
  onCloseWorkOrder,
  onOverrideVerdict,
  onRetractSteerNote,
  autoRequestPlan,
  taskChip,
  issueChip,
  onOpenIssueExternal,
  changes,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  /** WO-0031c: the effective permission rule (the WO's own, else the Settings default). */
  permissionRule: PermissionRule;
  onBack: () => void;
  onApprovePlan: (planText: string, opts?: { editedCount?: number }) => Promise<void>;
  onSavePlanDraft: (planText: string) => Promise<void>;
  onGetOriginalPlan: () => Promise<string | null>;
  onRestoreOriginalPlan: () => Promise<void>;
  onUpdateWorkOrder: (patch: UpdateWorkOrderInput) => Promise<void>;
  onRecordPermissionDecision: (input: { allowed: boolean; tool: string; target: string }) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  /** WO-0047: the workspace's budget view — the band's warn line + the refusal card's context. */
  budget?: WorkspaceBudgetView;
  /** WO-0047: the refusal card's RAISE action (a permanent settings write + refresh). */
  onRaiseBudget: (capUsd: number) => Promise<void>;
  reloadDetail: () => void;
  onCloseWorkOrder: (note: string) => Promise<void>;
  onOverrideVerdict: (idx: number) => Promise<void>;
  /** WO-0045: retract a queued note from a STOPPED drive's mirror (the data-port route). */
  onRetractSteerNote?: (sessionId: string, noteId: string) => Promise<boolean>;
  onDelete: () => Promise<void>;
  /** WO-0031c "Oluştur ve plan iste": fire the architect plan drive once on arrival. */
  autoRequestPlan?: boolean;
  /** WO-0049 (mockup kare 07): the linked task — resolved / 'missing' / undefined, straight through. */
  taskChip?: { fazId: string; taskTitle: string } | 'missing';
  /** WO-0092: the order.md `issue:` ref chip (↗ when the cache resolves its display url). */
  issueChip?: { ref: string; url?: string };
  /** WO-0092: the chip's browser action (shell.openExternal, https-allowlisted main-side). */
  onOpenIssueExternal?: (url: string) => void;
  /** WO-0068: the operator's console bridge (the optional `changes` group), straight through. */
  changes?: ChangesBridge;
}) {
  return (
    <main className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-[1160px] flex-col overflow-hidden px-5 pb-3.5 pt-2.5">
      <WorkOrderDetail
        detail={detail}
        docs={docs}
        onBack={onBack}
        onApprovePlan={onApprovePlan}
        onSavePlanDraft={onSavePlanDraft}
        onGetOriginalPlan={onGetOriginalPlan}
        onRestoreOriginalPlan={onRestoreOriginalPlan}
        onUpdateWorkOrder={onUpdateWorkOrder}
        onRecordPermissionDecision={onRecordPermissionDecision}
        permissionRule={permissionRule}
        autoRequestPlan={autoRequestPlan}
        onGetStepReport={onGetStepReport}
        onGetStepVerdict={onGetStepVerdict}
        onResetStep={onResetStep}
        budget={budget}
        onRaiseBudget={onRaiseBudget}
        reloadDetail={reloadDetail}
        onCloseWorkOrder={onCloseWorkOrder}
        onOverrideVerdict={onOverrideVerdict}
        onDelete={onDelete}
        onRetractSteerNote={onRetractSteerNote}
        taskChip={taskChip}
        issueChip={issueChip}
        onOpenIssueExternal={onOpenIssueExternal}
        changes={changes}
      />
    </main>
  );
}
