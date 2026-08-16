import type { StepRole, WorkOrderDetailView } from '../../core/types';
import type { WoEvent } from '../../core/types';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

// The console FRAME (WO-0031c / v4): the detail fills the viewport below the 48px AppShell bar — the
// rail pins to the window bottom and the body row scrolls internally (the mockup's `.console` grid,
// strip / substrip / body / rail). The board keeps its normal page scroll; only the detail is a console.
export function DetailScreen({
  detail,
  docs,
  events,
  onBack,
  onApprovePlan,
  onGetStepReport,
  onGetStepVerdict,
  onResetStep,
  reloadDetail,
  onDelete,
  onCloseWorkOrder,
  onOverrideVerdict,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  events: WoEvent[];
  onBack: () => void;
  onApprovePlan: (planText: string) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  onGetStepVerdict: (idx: number) => Promise<string>;
  onResetStep: (idx: number) => Promise<void>;
  reloadDetail: () => void;
  onCloseWorkOrder: (note: string) => Promise<void>;
  onOverrideVerdict: (idx: number) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  return (
    <main className="mx-auto flex h-[calc(100vh-3rem)] w-full max-w-[1240px] flex-col overflow-hidden px-6 pb-4 pt-3">
      <WorkOrderDetail
        detail={detail}
        docs={docs}
        events={events}
        onBack={onBack}
        onApprovePlan={onApprovePlan}
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
