import type { WorkOrderDetailView } from '../../core/types';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

export function DetailScreen({
  detail,
  docs,
  workspaceLabel,
  onBack,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  workspaceLabel: string;
  onBack: () => void;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <WorkOrderDetail detail={detail} docs={docs} workspaceLabel={workspaceLabel} onBack={onBack} />
    </main>
  );
}
