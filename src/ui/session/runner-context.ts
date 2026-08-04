// Provides the session runner (src/core/runner SessionRunner port) deep in the tree
// without drilling it through BoardScreen/DetailScreen/WorkOrderDetail, which do not
// use it. Only the session pane consumes it.
import { createContext, useContext } from 'react';
import type { SessionRunner } from '../../core/runner';

export const RunnerContext = createContext<SessionRunner | null>(null);

export function useRunner(): SessionRunner {
  const runner = useContext(RunnerContext);
  if (!runner) throw new Error('useRunner: no RunnerContext provider');
  return runner;
}
