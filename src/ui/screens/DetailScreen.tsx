import type { StepRole, WorkOrderDetailView } from '../../core/types';
import type { WoEvent } from '../../core/types';
import type { PermissionRule, UpdateWorkOrderInput } from '../../core/source';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

// The console FRAME (WO-0031c / v4): the detail fills the viewport below the 48px AppShell bar — the
// rail pins to the window bottom and the body row scrolls internally (the mockup's `.console` grid,
// strip / substrip / body / rail). The board keeps its normal page scroll; only the detail is a console.
export function DetailScreen({
  detail,
  docs,
  events,
  permissionRule,
  onBack,
  onApprovePlan,
  onUpdateWorkOrder,
  onRecordPermissionDecision,
  onGetStepReport,
  onGetStepVerdict,
  onResetStep,
  reloadDetail,
  onDelete,
  onCloseWorkOrder,
  onOverrideVerdict,
  autoRequestPlan,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  events: WoEvent[];
  /** WO-0031c: the effective permission rule (the WO's own, else the Settings default). */
  permissionRule: PermissionRule;
  onBack: () => void;
  onApprovePlan: (planText: string, opts?: { editedCount?: number }) => Promise<void>;
  onUpdateWorkOrder: (patch: UpdateWorkOrderInput) => Promise<void>;
  onRecordPermissionDecision: (input: { allowed: boolean; tool: string; target: string }) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  reloadDetail: () => void;
  onCloseWorkOrder: (note: string) => Promise<void>;
  onOverrideVerdict: (idx: number) => Promise<void>;
  onDelete: () => Promise<void>;
  /** WO-0031c "Oluştur ve plan iste": fire the architect plan drive once on arrival. */
  autoRequestPlan?: boolean;
}) {
  return (
    <main className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-[1160px] flex-col overflow-hidden px-5 pb-3.5 pt-2.5">
      <WorkOrderDetail
        detail={detail}
        docs={docs}
        events={events}
        onBack={onBack}
        onApprovePlan={onApprovePlan}
        onUpdateWorkOrder={onUpdateWorkOrder}
        onRecordPermissionDecision={onRecordPermissionDecision}
        permissionRule={permissionRule}
        autoRequestPlan={autoRequestPlan}
        onGetStepReport={onGetStepReport}
        onGetStepVerdict={onGetStepVerdict}
        onResetStep={onResetStep}
        reloadDetail={reloadDetail}
        onCloseWorkOrder={onCloseWorkOrder}
        onOverrideVerdict={onOverrideVerdict}
        onDelete={onDelete}
      />
    </main>
  );
}
