import type { StepRole, WorkOrderDetailView } from '../../core/types';
import type { WoEvent } from '../../core/types';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

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
    <main className="mx-auto max-w-3xl px-6 py-8">
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
