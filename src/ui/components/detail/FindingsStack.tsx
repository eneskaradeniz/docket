import { useState } from 'react';
import type { Workspace, WorkOrderDetailView } from '../../../core/types';
import type { PendingFinding } from '../../../core/session-store';
import type { WorkOrderSource } from '../../../core/source';
import { useLabels } from '../../data/locale';
import { Button } from '../../kit';

export function FindingsStack({
  findings,
  source,
  workspace,
  workOrder,
  onUpdate
}: {
  findings: PendingFinding[];
  source: WorkOrderSource;
  workspace: Workspace;
  workOrder: WorkOrderDetailView;
  onUpdate: () => void;
}) {
  const { UI, woIdLabel } = useLabels();
  const [working, setWorking] = useState(false);

  if (findings.length === 0) return null;

  // ADR-0001: guarded register - connected repo check.
  const isConnected = (repo: string) => workspace.repos.some(r => r === repo);

  const confirmAll = async () => {
    setWorking(true);
    try {
      for (const f of findings) {
        const repoId = workspace.repos.find(r => r === f.repo);
        if (!repoId) continue;
        
        await source.createWorkOrder({
          workspaceId: workspace.id,
          title: f.problem,
          description: UI.findingProposalDescription(f.repo, f.pointer, woIdLabel(workOrder.id), f.sourceSessionId, f.problem),
          trackRepos: [repoId],
          reviewMode: 'gates',
          contextFiles: [],
        });
        
        await source.consumePendingFinding(f.id);
      }
    } finally {
      setWorking(false);
      onUpdate();
    }
  };

  const dismiss = async (f: PendingFinding) => {
    setWorking(true);
    try {
      await source.dismissPendingFinding(workOrder.id, f.id);
    } finally {
      setWorking(false);
      onUpdate();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {findings.map(f => {
        const locked = !isConnected(f.repo);
        return (
          <div key={f.id} className={`flex items-start justify-between rounded-md border bg-surface p-3 ${locked ? 'border-hairline opacity-60' : 'border-primary/20'}`}>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-medium">{UI.findingProposalTitle}</span>
              <span className="text-xs font-mono text-inkdim">{UI.findingProposalLocation(f.repo, f.pointer)}</span>
              <span className="text-xs">{f.problem}</span>
              {locked && <span className="text-xs text-error font-medium">{UI.findingProposalLocked}</span>}
            </div>
            {!locked && (
              <Button variant="ghost" size="xs" onClick={() => dismiss(f)} busy={working}>
                {UI.findingProposalDismiss}
              </Button>
            )}
          </div>
        );
      })}
      
      {findings.some(f => isConnected(f.repo)) && (
        <div className="flex justify-end">
          <Button variant="primary" size="sm" onClick={confirmAll} busy={working}>
            {UI.findingProposalConfirm(findings.filter(f => isConnected(f.repo)).length)}
          </Button>
        </div>
      )}
    </div>
  );
}
