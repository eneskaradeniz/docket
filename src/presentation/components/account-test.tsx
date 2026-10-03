// components/account-test.tsx — U-39: the "Test et" button and the one result line under it, shared
// by the Hesaplar row and the account editor's Genel tab. The line shows the class sentence the
// store chose, the time and the model's name (never the model's output); the redacted `detail`
// sits only inside the closed "Ayrıntı" disclosure, in mono.
import { t, type Locale } from '../labels/t';
import { accountTestLine, relativeTime, type TestRefusal } from '../stores/account-test';
import type { AccountTestView } from '../../api/queries';
import { ActionButton } from './action-button';

export interface AccountTestProps {
  readonly locale: Locale;
  /** The account's `test` view as `settings.accounts` reported it. */
  readonly test: AccountTestView | null;
  /** True while the command is open (or the stored record still reads running). */
  readonly testing: boolean;
  readonly refusal: TestRefusal | undefined;
  /** Whether this host shows the button; the Hesaplar row only for a Doğrulanamadı provider. */
  readonly showButton: boolean;
  readonly onTest: () => void;
  /** The "Modeller" link under a needs_spend_consent refusal. */
  readonly onOpenModels: () => void;
}

export function AccountTest({ locale, test, testing, refusal, showButton, onTest, onOpenModels }: AccountTestProps) {
  const line = accountTestLine(test);
  const facts: string[] = [];
  if (line.kind === 'ok' || line.kind === 'failed') {
    facts.push(relativeTime(locale, line.at, Date.now()));
    facts.push(line.model ?? t(locale, 'accountTest.defaultModel'));
  }
  return (
    <div className="grid gap-1" data-account-test="">
      <div className="flex items-center gap-3">
        {showButton ? (
          <ActionButton disabled={testing} onClick={onTest}>
            {t(locale, testing ? 'accountTest.running' : 'accountTest.button')}
          </ActionButton>
        ) : null}
        <p className="min-w-0 text-[12.5px] text-inkdim" data-test-line={line.kind}>
          <span className={line.kind === 'failed' ? 'text-error' : line.kind === 'ok' ? 'text-proceed' : undefined}>{t(locale, line.lead)}</span>
          {facts.length > 0 ? ` · ${facts.join(' · ')}` : ''}
        </p>
      </div>
      {line.kind === 'failed' && line.detail !== null ? (
        <details className="text-[12px] text-inkdim" data-test-detail="">
          <summary className="w-fit hover:text-ink">{t(locale, 'accountTest.detail')}</summary>
          <pre className="mt-1 whitespace-pre-wrap break-words rounded-control bg-band px-2 py-1 font-mono text-[11.5px] text-ink">{line.detail}</pre>
        </details>
      ) : null}
      {refusal !== undefined ? (
        <p role="alert" className="text-[12.5px] text-signal-soft" data-test-refusal={refusal.code}>
          {t(locale, refusal.labelKey)}
          {refusal.modelsLink ? (
            <>
              {' '}
              <button type="button" onClick={onOpenModels} className="rounded-control text-ink underline decoration-bord underline-offset-4 hover:decoration-ink">
                {t(locale, 'accountTest.openModels')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
