// components/builtin-mcp-row.tsx — the first, permanent row of the MCP menu (U-305): Docket's own
// server with its live standing and its one repair. The row is not a library entry (A-144), so no
// remove, archive, rename or edit control ever renders here — absent, not disabled.
import type { McpStatusView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import { ActionButton } from './action-button';
import { SettingRow } from './setting-row';

const REASON_KEY: Readonly<Record<'no_endpoint' | 'listener_down' | 'script_missing', LabelKey>> = {
  no_endpoint: 'capabilities.mcp.reason.no_endpoint',
  listener_down: 'capabilities.mcp.reason.listener_down',
  script_missing: 'capabilities.mcp.reason.script_missing',
};

const STATUS_KEY: Readonly<Record<'running' | 'stopped', LabelKey>> = {
  running: 'capabilities.mcp.running',
  stopped: 'capabilities.mcp.stopped',
};

export interface BuiltinMcpRowProps {
  readonly locale: Locale;
  /** The `mcp.status` standing; null while the section's first read is still out. */
  readonly status: McpStatusView | null;
  readonly busy: boolean;
  /** The inline result line of "Geri yükle": restored, or the typed refusal sentence. */
  readonly result: LabelKey | null;
  readonly onRestore: () => void;
  /** The "N rolde kapalı" link's navigation; absent renders the count as plain text. */
  readonly onOpenRoles?: () => void;
}

export function BuiltinMcpRow({ locale, status, busy, result, onRestore, onOpenRoles }: BuiltinMcpRowProps) {
  const stopped = status !== null && status.state === 'stopped';
  const below =
    status === null ? undefined : (
      <div className="grid gap-1 text-[12px] text-inkdim">
        <span aria-live="polite" data-mcp-status={status.state}>
          {t(locale, STATUS_KEY[status.state])}
          {status.reason === undefined ? null : ` — ${t(locale, REASON_KEY[status.reason])}`}
        </span>
        <span className="font-mono">{`run · ${status.tools.run.join(', ')}`}</span>
        <span className="font-mono">{`chat · ${status.tools.chat.join(', ')}`}</span>
        {status.rolesWithout.length > 0 ? (
          onOpenRoles === undefined ? (
            <span>{t(locale, 'capabilities.mcp.rolesWithout').replace('{count}', String(status.rolesWithout.length))}</span>
          ) : (
            <button
              type="button"
              onClick={onOpenRoles}
              data-mcp-roles-without=""
              className="w-fit rounded-control border border-bord px-2 py-0.5 font-semibold text-inkdim hover:bg-raised hover:text-ink"
            >
              {t(locale, 'capabilities.mcp.rolesWithout').replace('{count}', String(status.rolesWithout.length))}
            </button>
          )
        ) : null}
        {result === null ? null : (
          <span role="status" data-mcp-restore-result="">
            {t(locale, result)}
          </span>
        )}
      </div>
    );
  return (
    <SettingRow
      framed
      locale={locale}
      title={t(locale, 'capabilities.mcp.rowTitle')}
      below={below}
      control={
        <>
          <span className="rounded-full border border-bord px-2 py-0.5 text-[11px] font-semibold text-inkdim" data-mcp-builtin="">
            {t(locale, 'capabilities.mcp.builtin')}
          </span>
          {stopped || busy ? (
            <ActionButton variant="neutral" size="sm" disabled={busy} onClick={onRestore}>
              {t(locale, busy ? 'capabilities.mcp.restoring' : 'capabilities.mcp.restore')}
            </ActionButton>
          ) : null}
        </>
      }
    />
  );
}
