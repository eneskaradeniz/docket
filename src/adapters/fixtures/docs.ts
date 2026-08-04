// Owned documents (order.md / plan.md) keyed by work order. Fixture stand-ins for the
// view-time disk/git read (ccd463e: owned docs render inline read-only; never cached).
import type { WorkOrderId } from '../../core/types';
import { woid } from './ids';

export interface OwnedDocs {
  order: string;
  plan: string;
}

export const workOrderDocs: Record<WorkOrderId, OwnedDocs> = {
  [woid('WO-1001')]: {
    order: '# Token refresh on resume\n\nDecide token-rotation semantics when a session resumes after a stop-and-ask gate.\n',
    plan: '## Plan\n\nKeep the existing token; re-issue lazily on the first authenticated call after resume.\n',
  },
  [woid('WO-1002')]: {
    order: '# Trim stale workspace cache\n\nEvict workspace cache entries that outlive their decision-store ref.\n',
    plan: '## Plan\n\nKey cache entries by decision-store sha; drop on mismatch.\n',
  },
  [woid('WO-1003')]: {
    order: '# Evidence pointer resolver\n\nResolve every `path:line` claim at the recorded head sha.\n',
    plan: '## Plan\n\nResolve pointers at view time; an unresolvable pointer is not evidence.\n',
  },
  [woid('WO-1004')]: {
    order: '# Closure gate provenance\n\nRecord the commit sha that updates ROADMAP and tech-debt as closure evidence.\n',
    plan: '## Plan\n\nClosure evidence = doc-update commit sha; merge is not closure.\n',
  },
  [woid('WO-1005')]: {
    order: '# Date picker shared contract\n\nShip one date contract across api and mobile; mobile depends on api.\n',
    plan: '## Plan\n\nDefine the contract in api; mobile consumes it after api merges.\n',
  },
  [woid('WO-1006')]: {
    order: '# Docs site search index\n\nBuild a static search index from the docs markdown.\n',
    plan: '## Plan\n\nGenerate the index at build time; no CI required for the docs repo.\n',
  },
};
