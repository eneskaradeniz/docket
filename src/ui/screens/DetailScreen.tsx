import type { WorkOrderDetailView } from '../../core/types';
import { WorkOrderDetail } from '../components/detail/WorkOrderDetail';

export function DetailScreen({
  detail,
  docs,
  onBack,
}: {
  detail: WorkOrderDetailView;
  docs: { order: string; plan: string };
  onBack: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <WorkOrderDetail detail={detail} docs={docs} onBack={onBack} />
    </main>
  );
}
