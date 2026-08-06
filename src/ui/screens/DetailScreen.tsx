import type { StepRole, WorkOrderDetailView } from '../../core/types';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

export function DetailScreen({
  detail,
  docs,
  onBack,
  onApprovePlan,
  onGetStepReport,
  reloadDetail,
  onDelete,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  onBack: () => void;
  onApprovePlan: (planText: string) => Promise<void>;
  onGetStepReport: (idx: number, role: StepRole) => Promise<string>;
  reloadDetail: () => void;
  onDelete: () => Promise<void>;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <WorkOrderDetail
        detail={detail}
        docs={docs}
        onBack={onBack}
        onApprovePlan={onApprovePlan}
        onGetStepReport={onGetStepReport}
        reloadDetail={reloadDetail}
        onDelete={onDelete}
      />
    </main>
  );
}
