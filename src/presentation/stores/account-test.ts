// stores/account-test.ts — U-39: the pure side of "Test et". The row's `test` view (A-72) becomes
// one result line, a `model` failure becomes the account's "Model hatası" status (accountStatus in
// account-editor.ts reads the same view), and each refusal of `account.test` becomes its U-8
// label. The model's output is never an input here: `detail` is the redacted class detail the
// api already cut, shown only inside the closed "Ayrıntı" disclosure.
import type { AccountTestView } from '../../api/queries';
import type { LabelKey } from '../labels/keys';
import type { Locale } from '../labels/t';
import type { ProviderRow } from './candidates';
import { failureKey } from './results';

type TestClass = NonNullable<AccountTestView['class']>;

const CLASS_KEY: Readonly<Record<TestClass, LabelKey>> = {
  auth: 'accountTest.class.auth',
  limit: 'accountTest.class.limit',
  model: 'accountTest.class.model',
  network: 'accountTest.class.network',
  install: 'accountTest.class.install',
  unknown: 'accountTest.class.unknown',
};

/** One result line. `lead` is the headline label; `at` and `model` are the facts that follow it
 *  (`model` null = the route's default, which the screen words "asistanın varsayılanı"). */
export type AccountTestLine =
  | { readonly kind: 'untested'; readonly lead: LabelKey }
  | { readonly kind: 'running'; readonly lead: LabelKey }
  | { readonly kind: 'ok'; readonly lead: LabelKey; readonly at: number; readonly model: string | null }
  | {
      readonly kind: 'failed';
      readonly lead: LabelKey;
      readonly at: number;
      readonly model: string | null;
      /** Inside the closed "Ayrıntı" disclosure; null when there is nothing to show. */
      readonly detail: string | null;
    };

/** The row's `test` view as its result line; `null` reads as never tested. Pure. */
export const accountTestLine = (test: AccountTestView | null): AccountTestLine => {
  if (test === null) return { kind: 'untested', lead: 'accountTest.untested' };
  if (test.state === 'running') return { kind: 'running', lead: 'accountTest.running' };
  if (test.state === 'ok') return { kind: 'ok', lead: 'accountTest.ok', at: test.at, model: test.model };
  const detail = test.detail === null || test.detail.trim() === '' ? null : test.detail;
  return {
    kind: 'failed',
    lead: CLASS_KEY[test.class ?? 'unknown'],
    at: test.at,
    model: test.model,
    detail,
  };
};

/** True when the account's last test failed with class `model` — the row reads "Model hatası". */
export const isModelError = (test: AccountTestView | null): boolean => test?.state === 'failed' && test.class === 'model';

/** The refusals of `account.test` (A-68) as the label under the button; `needs_spend_consent`
 *  also offers the link to the Modeller tab. */
export interface TestRefusal {
  readonly code: string;
  readonly labelKey: LabelKey;
  readonly modelsLink: boolean;
}

const REFUSAL_KEY: Readonly<Record<string, LabelKey>> = {
  needs_spend_consent: 'accountTest.refusal.needs_spend_consent',
  spend_cap_reached: 'accountTest.refusal.spend_cap_reached',
  busy: 'accountTest.refusal.busy',
  unsupported: 'accountTest.refusal.unsupported',
};

/** Test-specific keys: these codes are the account test's own, so a later command that refuses
 *  with the same word must not inherit the test's sentence. Everything else (not_found) reads
 *  through the generic failure labels. */
export const testRefusal = (code: string): TestRefusal => ({
  code,
  labelKey: REFUSAL_KEY[code] ?? failureKey(code),
  modelsLink: code === 'needs_spend_consent',
});

/** An account's provider reads Doğrulanamadı when discovery found its binary but the login probe
 *  proved nothing (`loggedIn: null`, U-38) — the only Hesaplar rows that carry an inline "Test et". */
export const providerUnverified = (providers: readonly Pick<ProviderRow, 'id' | 'statusKey'>[], providerId: string): boolean =>
  providers.some((row) => row.id === providerId && row.statusKey === 'candidates.status.unknown');

const UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

/** "3 dk önce" style time since `at`, read at `now`; under a minute reads as "şimdi" (numeric
 *  'auto'). Pure: the clock is the caller's. */
export const relativeTime = (locale: Locale, at: number, now: number): string => {
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  const elapsed = Math.max(0, now - at);
  for (const [unit, size] of UNITS) {
    if (elapsed >= size) return formatter.format(-Math.floor(elapsed / size), unit);
  }
  return formatter.format(0, 'second');
};
