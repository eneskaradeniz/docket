// stores/recommended.ts — the one table of recommended settings (U-29) and the pure comparison
// of an account against it. Every surface that marks "Önerilen", counts changed settings or
// resets one reads this table; no other file spells a recommended value.
import type { SettingsAccountView } from '../../api/queries';

export type WorkStyle = 'fast' | 'balanced' | 'careful';

export const RECOMMENDED = {
  limitPolicy: 'wait_resume',
  /** No reserve: both windows keep nothing back. */
  reserve: { short: 0, long: 0 },
  warnPercent: 80,
  cap: { scope: 'account_month', amountUsd: 50 },
} as const;

// By role id; a role outside the list is balanced (U-33).
const ROLE_WORK_STYLE: Readonly<Record<string, WorkStyle>> = {
  planner: 'careful',
  reviewer: 'careful',
  'security-auditor': 'careful',
  developer: 'balanced',
  'test-writer': 'balanced',
  analyst: 'fast',
  documenter: 'fast',
};

export const recommendedWorkStyle = (roleId: string): WorkStyle => ROLE_WORK_STYLE[roleId] ?? 'balanced';

export type SettingKey = 'limitPolicy' | 'reserve' | 'cap' | 'warnPercent';

export interface SettingDiff {
  readonly key: SettingKey;
  /** Canonical text or number: reserve `short/long` (0 for none), cap `scope:amount`. */
  readonly current: string | number;
  readonly recommended: string | number;
}

/** An account whose billing view is not `included` may spend money (P-51, A-83) — never decided by
 *  the connection kind. */
export const isPayPerUse = (account: SettingsAccountView): boolean => account.billing !== 'included';

/** Whether the account may spend money, so a cap row belongs on it (U-30). */
export const mayHaveCap = (account: SettingsAccountView): boolean => isPayPerUse(account) || account.consentedModels.length > 0;

export const settingDiffs = (account: SettingsAccountView): readonly SettingDiff[] => {
  const diffs: SettingDiff[] = [];
  if (account.limitPolicy !== RECOMMENDED.limitPolicy) {
    diffs.push({ key: 'limitPolicy', current: account.limitPolicy, recommended: RECOMMENDED.limitPolicy });
  }
  const short = account.reserve.short ?? 0;
  const long = account.reserve.long ?? 0;
  if (short > 0 || long > 0) {
    diffs.push({ key: 'reserve', current: `${short}/${long}`, recommended: `${RECOMMENDED.reserve.short}/${RECOMMENDED.reserve.long}` });
  }
  const offCap = account.caps.find((cap) => cap.scope !== RECOMMENDED.cap.scope || cap.amountUsd !== RECOMMENDED.cap.amountUsd);
  if (offCap !== undefined) {
    diffs.push({
      key: 'cap',
      current: `${offCap.scope}:${offCap.amountUsd}`,
      recommended: `${RECOMMENDED.cap.scope}:${RECOMMENDED.cap.amountUsd}`,
    });
  }
  const offWarn = account.caps.find((cap) => cap.warnPercent !== RECOMMENDED.warnPercent);
  if (offWarn !== undefined) {
    diffs.push({ key: 'warnPercent', current: offWarn.warnPercent, recommended: RECOMMENDED.warnPercent });
  }
  return diffs;
};
