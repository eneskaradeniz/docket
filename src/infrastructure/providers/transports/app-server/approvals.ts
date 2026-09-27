// Approval requests the app-server sends to its client: which ones Docket surfaces as a
// permission_ask, and how a user decision maps back onto each method's response shape. The
// decision values follow each method's documented response type. Contract: docs/v2/providers.md
// → P-13 ("nothing is ever auto-approved").
import { isRecord } from './rate-limits';

const DENIED_BY_OPERATOR = 'Denied by the operator';

const stringField = (holder: unknown, key: string): string | undefined => {
  if (!isRecord(holder)) return undefined;
  const value = holder[key];
  return typeof value === 'string' ? value : undefined;
};

export interface ApprovalAsk {
  /** Display name of the thing asking for approval. */
  readonly tool: string;
  /** The most identifying string the request carries (the command, the granted root, …). */
  readonly target?: string;
  /** The user's decision → this method's JSON-RPC result object. */
  response(decision: 'allow' | 'deny'): Readonly<Record<string, unknown>>;
}

const v2Decision = (decision: 'allow' | 'deny'): Readonly<Record<string, unknown>> => ({
  decision: decision === 'allow' ? 'accept' : 'decline',
});

const legacyDecision = (decision: 'allow' | 'deny'): Readonly<Record<string, unknown>> =>
  decision === 'allow'
    ? { decision: 'approved' }
    : { decision: { denied: { rejection: DENIED_BY_OPERATOR } } };

/** `item/permissions/requestApproval` grants (or grants nothing) instead of answering
 * accept/decline: an empty grant is the denial. */
const permissionGrant =
  (params: unknown) =>
  (decision: 'allow' | 'deny'): Readonly<Record<string, unknown>> => ({
    permissions: decision === 'allow' && isRecord(params) && isRecord(params['permissions']) ? params['permissions'] : {},
    scope: 'turn',
  });

/** The server requests this client must answer so the run can proceed. Everything else — other
 * server requests, unknown methods — is the caller's to ignore. */
export function describeApprovalRequest(method: string, params: unknown): ApprovalAsk | undefined {
  switch (method) {
    case 'item/commandExecution/requestApproval':
      return withTarget('shell', stringField(params, 'command'), v2Decision);
    case 'item/fileChange/requestApproval':
      return withTarget('fileChange', stringField(params, 'grantRoot'), v2Decision);
    case 'item/permissions/requestApproval':
      return withTarget('permissions', stringField(params, 'cwd'), permissionGrant(params));
    case 'execCommandApproval': {
      // The legacy variant carries the command as an argv array.
      const command = isRecord(params) && Array.isArray(params['command'])
        ? params['command'].filter((part): part is string => typeof part === 'string').join(' ')
        : undefined;
      return withTarget('shell', command, legacyDecision);
    }
    case 'applyPatchApproval':
      return withTarget('applyPatch', stringField(params, 'cwd'), legacyDecision);
    default:
      return undefined;
  }
}

function withTarget(
  tool: string,
  target: string | undefined,
  response: (decision: 'allow' | 'deny') => Readonly<Record<string, unknown>>,
): ApprovalAsk {
  return {
    tool,
    ...(target === undefined ? {} : { target }),
    response,
  };
}
