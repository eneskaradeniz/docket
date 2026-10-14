// stores/project-spend.ts — pure view-model for the project header spend strip (U-329, U-330).
import { spendStatus, type SpendCap, type SpendStatus } from '../../domain/index';
import type { ProjectSpendView } from '../../api/queries';

export type ProjectSpendBilling = ProjectSpendView['billing'];

export type ProjectSpendDisplay =
  | { readonly kind: 'hidden' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'error' }
  | { readonly kind: 'meter'; readonly totalUsd: number; readonly cap: SpendCap; readonly status: SpendStatus; readonly percent: number }
  | { readonly kind: 'counter'; readonly totalUsd: number };

/** Whether anything should draw in the header for this spend answer. */
export const projectSpendDisplay = (
  view: ProjectSpendView | null,
  loading: boolean,
  problem: string | null,
): ProjectSpendDisplay => {
  if (loading && view === null && problem === null) return { kind: 'loading' };
  if (problem !== null) return { kind: 'error' };
  if (view === null || view.billing === 'included') return { kind: 'hidden' };
  if (view.cap !== undefined) {
    const status = spendStatus(view.totalUsd, view.cap);
    const percent =
      view.cap.amountUsd <= 0 ? 0 : Math.min(100, Math.round((view.totalUsd / view.cap.amountUsd) * 100));
    return { kind: 'meter', totalUsd: view.totalUsd, cap: view.cap, status, percent };
  }
  if (view.totalUsd > 0) return { kind: 'counter', totalUsd: view.totalUsd };
  return { kind: 'hidden' };
};

export const projectCapHardStop = (view: ProjectSpendView | null): boolean =>
  view?.cap !== undefined && spendStatus(view.totalUsd, view.cap) === 'hard_stop';
