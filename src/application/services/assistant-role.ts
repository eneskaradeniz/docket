// services/assistant-role.ts — the built-in Asistan role (docs/v2/application.md A-233): code, not
// a stored definition, so no definition file or override can edit it. The brief is per-turn (the
// conversation's scope), so the role is built per turn from the fixed parts plus assistantBrief.
import type { ConversationScope, RoleDef, RoleSlug, Tier } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import { assistantBrief } from './assistant-brief';
import { DOCKET_CHAT_TOOLS_INSTRUCTIONS } from './docket-tools';

const PARSED = parseSlug<'role'>('assistant');
if (!PARSED.ok) throw new Error('the assistant role slug must parse');

/** The one id the chat runner and its tokens carry. */
export const ASSISTANT_ROLE_ID: RoleSlug = PARSED.value;

/** The role's fixed tier: an unpinned route runs the balanced model of the bound account. */
export const ASSISTANT_TIER: Tier = 'balanced';

/** The role of one turn: the chat tool instructions plus the brief of the conversation's scope. */
export const assistantRole = (scope: ConversationScope): RoleDef => ({
  id: ASSISTANT_ROLE_ID,
  name: 'Asistan',
  instructions: `${DOCKET_CHAT_TOOLS_INSTRUCTIONS}\n\n${assistantBrief({ scope })}`,
  writeScope: { kind: 'none' },
  capabilities: [],
  active: true,
  docketTools: true,
});
