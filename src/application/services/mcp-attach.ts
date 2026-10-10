// services/mcp-attach.ts — the one attachment of Docket's own MCP capability (A-144/A-203),
// extracted from the run executor so the chat runner attaches exactly the same way (A-236): the
// capability is appended LAST (a stored definition of the same id is replaced), the token is minted
// only here, and DOCKET_MCP_KIND names the token kind the child should be served — 'run' for a
// work-order run, 'chat' for an assistant turn. A role that opted out, a provider whose CLI cannot
// attach MCP, and a shell without an endpoint all get the capabilities unchanged and no token.
import type { AccountId, CapabilityDef, RoleDef } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { AppDeps, RunTokenBinding, RunTokenKind } from '../ports';

/** Not a secret: it only picks which tool list the child shows. The app enforces the kind of the
 *  token itself, so a changed value widens nothing. */
export const DOCKET_MCP_KIND_BY_TOKEN: Readonly<Record<RunTokenKind, string>> = { run: 'run', chat: 'chat' };

const DOCKET_PAGES_CAPABILITY = parseSlug<'capability'>('docket-pages');

export const attachDocketCapability = async (
  deps: Pick<AppDeps, 'accounts' | 'capabilities' | 'runTokens' | 'mcpEndpoint'>,
  input: {
    /** The binding the minted token carries; its kind picks the DOCKET_MCP_KIND value. */
    readonly binding: RunTokenBinding;
    readonly accountId: AccountId;
    readonly role: RoleDef;
    readonly capabilities: readonly CapabilityDef[];
  },
): Promise<readonly CapabilityDef[]> => {
  const endpoint = deps.mcpEndpoint;
  if (endpoint === undefined || input.role.docketTools === false || !DOCKET_PAGES_CAPABILITY.ok) return input.capabilities;
  const account = await deps.accounts.get(input.accountId);
  if (account !== undefined && deps.capabilities.mcpSupport(account.provider) === false) return input.capabilities;

  const token = deps.runTokens.mint(input.binding);
  const env: Record<string, { readonly literal: string }> = {};
  for (const [name, value] of Object.entries(endpoint.env)) env[name] = { literal: value };
  env['DOCKET_MCP_SOCKET'] = { literal: endpoint.socketPath };
  env['DOCKET_MCP_TOKEN'] = { literal: token };
  env['DOCKET_MCP_KIND'] = { literal: DOCKET_MCP_KIND_BY_TOKEN[input.binding.kind] };
  return [
    ...input.capabilities.filter((capability) => capability.id !== DOCKET_PAGES_CAPABILITY.value),
    { kind: 'mcp', id: DOCKET_PAGES_CAPABILITY.value, name: 'Docket pages', command: endpoint.command, args: endpoint.args, env },
  ];
};
