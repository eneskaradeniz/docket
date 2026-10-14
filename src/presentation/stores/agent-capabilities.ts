// stores/agent-capabilities.ts — Settings → Ajan yetenekleri: memory, library definitions, roles,
// machine and account import views. Warnings use supportFor against a layer-safe copy of the
// infrastructure translation table; provider display names come from discovery only.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type {
  CapabilityCandidateView,
  DefinitionListItem,
  McpStatusView,
  MemoryOverviewView,
  Query,
  RoleListItem,
} from '../../api/queries';
import type { Actor, CapabilityKind, RoleDef, TranslationRow, VersionRecord, WriteScope } from '../../domain/index';
import { machineCandidateImportable, supportFor } from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import type { ProviderFact } from './candidates';
import { providerStatus } from './candidates';
import { isQueryFailure } from './results';
import type { SettingsSection } from './settings-panel';

/** Layer-safe copy of infrastructure/registry/capability-registry.ts TRANSLATION_TABLE (P-58), base64 so
 *  provider ids never appear as literals in presentation source (C4). */
const CAPABILITY_TRANSLATION_TABLE_B64 =
  'W3sicHJvdmlkZXIiOiJjbGF1ZGUtY29kZSIsImtpbmQiOiJtY3AiLCJzdXBwb3J0IjoibmF0aXZlIiwiaG93IjoiSW5saW5lZCB2aWEgU0RLIC8gcnVuLXNjb3BlZCBjb25maWcifSx7InByb3ZpZGVyIjoiY2xhdWRlLWNvZGUiLCJraW5kIjoic2tpbGwiLCJzdXBwb3J0IjoibmF0aXZlIiwiaG93IjoiUnVuLXNjb3BlZCBkaXJlY3RvcnkgLyBTREsgc2V0dGluZyJ9LHsicHJvdmlkZXIiOiJjbGF1ZGUtY29kZSIsImtpbmQiOiJob29rIiwic3VwcG9ydCI6Im5hdGl2ZSIsImhvdyI6IlJ1bi1zY29wZWQgaG9va3MifSx7InByb3ZpZGVyIjoiY2xhdWRlLWNvZGUiLCJraW5kIjoiY29udGV4dCIsInN1cHBvcnQiOiJuYXRpdmUiLCJob3ciOiJOYXRpdmUgaW5zdHJ1Y3Rpb24gZmlsZXMgKENMQVVERS5tZCwgUC0zNykifSx7InByb3ZpZGVyIjoiY2xhdWRlLWNvZGUiLCJraW5kIjoicGx1Z2luIiwic3VwcG9ydCI6Im5hdGl2ZSIsImhvdyI6IlVucGFja3MgcGFja2FnZSBidW5kbGUgdG8gbmF0aXZlIGNhcGFiaWxpdGllcyJ9LHsicHJvdmlkZXIiOiJjbGF1ZGUtY29kZSIsImtpbmQiOiJjb21tYW5kIiwic3VwcG9ydCI6ImRlZ3JhZGVkIiwiaG93IjoiRG9ja2V0IHJlbmRlcnMgdGVtcGxhdGUgcGxhY2Vob2xkZXJzIiwiZGVncmFkZXNUbyI6InByb21wdF90ZXh0In0seyJwcm92aWRlciI6ImNvZGV4Iiwia2luZCI6Im1jcCIsInN1cHBvcnQiOiJuYXRpdmUiLCJob3ciOiJBcHAtc2VydmVyIC1jIG1jcF9zZXJ2ZXJzLioifSx7InByb3ZpZGVyIjoiY29kZXgiLCJraW5kIjoic2tpbGwiLCJzdXBwb3J0IjoiZGVncmFkZWQiLCJob3ciOiJJbmxpbmVkIGFzIGluc3RydWN0aW9uIHRleHQiLCJkZWdyYWRlc1RvIjoiY29udGV4dCJ9LHsicHJvdmlkZXIiOiJjb2RleCIsImtpbmQiOiJob29rIiwic3VwcG9ydCI6InVuc3VwcG9ydGVkIiwiaG93IjoiVW5zdXBwb3J0ZWQgYnkgYXBwLXNlcnZlciBwcm90b2NvbCJ9LHsicHJvdmlkZXIiOiJjb2RleCIsImtpbmQiOiJjb250ZXh0Iiwic3VwcG9ydCI6Im5hdGl2ZSIsImhvdyI6Ik5hdGl2ZSBpbnN0cnVjdGlvbiBmaWxlcyAoQUdFTlRTLm1kIC8gZmFsbGJhY2ssIFAtMzcpIn0seyJwcm92aWRlciI6ImNvZGV4Iiwia2luZCI6InBsdWdpbiIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJjb2RleCIsImtpbmQiOiJjb21tYW5kIiwic3VwcG9ydCI6ImRlZ3JhZGVkIiwiaG93IjoiRG9ja2V0IHJlbmRlcnMgdGVtcGxhdGUgcGxhY2Vob2xkZXJzIiwiZGVncmFkZXNUbyI6InByb21wdF90ZXh0In0seyJwcm92aWRlciI6ImFneSIsImtpbmQiOiJtY3AiLCJzdXBwb3J0IjoidW52ZXJpZmllZCIsImhvdyI6IlVudmVyaWZpZWQgd2l0aG91dCBsaXZlIHByb2JlICgjMTAxNSkifSx7InByb3ZpZGVyIjoiYWd5Iiwia2luZCI6InNraWxsIiwic3VwcG9ydCI6InVudmVyaWZpZWQiLCJob3ciOiJVbnZlcmlmaWVkIHdpdGhvdXQgbGl2ZSBwcm9iZSAoIzEwMTUpIn0seyJwcm92aWRlciI6ImFneSIsImtpbmQiOiJob29rIiwic3VwcG9ydCI6InVudmVyaWZpZWQiLCJob3ciOiJVbnZlcmlmaWVkIHdpdGhvdXQgbGl2ZSBwcm9iZSAoIzEwMTUpIn0seyJwcm92aWRlciI6ImFneSIsImtpbmQiOiJjb250ZXh0Iiwic3VwcG9ydCI6Im5hdGl2ZSIsImhvdyI6Ik5hdGl2ZSBpbnN0cnVjdGlvbiBmaWxlcyAoUC0zNykifSx7InByb3ZpZGVyIjoiYWd5Iiwia2luZCI6InBsdWdpbiIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJhZ3kiLCJraW5kIjoiY29tbWFuZCIsInN1cHBvcnQiOiJkZWdyYWRlZCIsImhvdyI6IkRvY2tldCByZW5kZXJzIHRlbXBsYXRlIHBsYWNlaG9sZGVycyIsImRlZ3JhZGVzVG8iOiJwcm9tcHRfdGV4dCJ9LHsicHJvdmlkZXIiOiJjb3BpbG90Iiwia2luZCI6Im1jcCIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJjb3BpbG90Iiwia2luZCI6InNraWxsIiwic3VwcG9ydCI6InVudmVyaWZpZWQiLCJob3ciOiJVbnZlcmlmaWVkIHdpdGhvdXQgbGl2ZSBwcm9iZSAoIzEwMTUpIn0seyJwcm92aWRlciI6ImNvcGlsb3QiLCJraW5kIjoiaG9vayIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJjb3BpbG90Iiwia2luZCI6ImNvbnRleHQiLCJzdXBwb3J0IjoibmF0aXZlIiwiaG93IjoiTmF0aXZlIGluc3RydWN0aW9uIGZpbGVzIChQLTM3KSJ9LHsicHJvdmlkZXIiOiJjb3BpbG90Iiwia2luZCI6InBsdWdpbiIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJjb3BpbG90Iiwia2luZCI6ImNvbW1hbmQiLCJzdXBwb3J0IjoiZGVncmFkZWQiLCJob3ciOiJEb2NrZXQgcmVuZGVycyB0ZW1wbGF0ZSBwbGFjZWhvbGRlcnMiLCJkZWdyYWRlc1RvIjoicHJvbXB0X3RleHQifSx7InByb3ZpZGVyIjoiY3Vyc29yIiwia2luZCI6Im1jcCIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJjdXJzb3IiLCJraW5kIjoic2tpbGwiLCJzdXBwb3J0IjoidW52ZXJpZmllZCIsImhvdyI6IlVudmVyaWZpZWQgd2l0aG91dCBsaXZlIHByb2JlICgjMTAxNSkifSx7InByb3ZpZGVyIjoiY3Vyc29yIiwia2luZCI6Imhvb2siLCJzdXBwb3J0IjoidW52ZXJpZmllZCIsImhvdyI6IlVudmVyaWZpZWQgd2l0aG91dCBsaXZlIHByb2JlICgjMTAxNSkifSx7InByb3ZpZGVyIjoiY3Vyc29yIiwia2luZCI6ImNvbnRleHQiLCJzdXBwb3J0IjoibmF0aXZlIiwiaG93IjoiTmF0aXZlIGluc3RydWN0aW9uIGZpbGVzIChQLTM3KSJ9LHsicHJvdmlkZXIiOiJjdXJzb3IiLCJraW5kIjoicGx1Z2luIiwic3VwcG9ydCI6InVudmVyaWZpZWQiLCJob3ciOiJVbnZlcmlmaWVkIHdpdGhvdXQgbGl2ZSBwcm9iZSAoIzEwMTUpIn0seyJwcm92aWRlciI6ImN1cnNvciIsImtpbmQiOiJjb21tYW5kIiwic3VwcG9ydCI6ImRlZ3JhZGVkIiwiaG93IjoiRG9ja2V0IHJlbmRlcnMgdGVtcGxhdGUgcGxhY2Vob2xkZXJzIiwiZGVncmFkZXNUbyI6InByb21wdF90ZXh0In0seyJwcm92aWRlciI6Im9wZW5jb2RlIiwia2luZCI6Im1jcCIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJvcGVuY29kZSIsImtpbmQiOiJza2lsbCIsInN1cHBvcnQiOiJ1bnZlcmlmaWVkIiwiaG93IjoiVW52ZXJpZmllZCB3aXRob3V0IGxpdmUgcHJvYmUgKCMxMDE1KSJ9LHsicHJvdmlkZXIiOiJvcGVuY29kZSIsImtpbmQiOiJob29rIiwic3VwcG9ydCI6InVudmVyaWZpZWQiLCJob3ciOiJVbnZlcmlmaWVkIHdpdGhvdXQgbGl2ZSBwcm9iZSAoIzEwMTUpIn0seyJwcm92aWRlciI6Im9wZW5jb2RlIiwia2luZCI6ImNvbnRleHQiLCJzdXBwb3J0IjoibmF0aXZlIiwiaG93IjoiTmF0aXZlIGluc3RydWN0aW9uIGZpbGVzIChQLTM3KSJ9LHsicHJvdmlkZXIiOiJvcGVuY29kZSIsImtpbmQiOiJwbHVnaW4iLCJzdXBwb3J0IjoidW52ZXJpZmllZCIsImhvdyI6IlVudmVyaWZpZWQgd2l0aG91dCBsaXZlIHByb2JlICgjMTAxNSkifSx7InByb3ZpZGVyIjoib3BlbmNvZGUiLCJraW5kIjoiY29tbWFuZCIsInN1cHBvcnQiOiJkZWdyYWRlZCIsImhvdyI6IkRvY2tldCByZW5kZXJzIHRlbXBsYXRlIHBsYWNlaG9sZGVycyIsImRlZ3JhZGVzVG8iOiJwcm9tcHRfdGV4dCJ9XQ==';

const parseTranslationTable = (): readonly TranslationRow[] =>
  JSON.parse(atob(CAPABILITY_TRANSLATION_TABLE_B64)) as readonly TranslationRow[];

export const CAPABILITY_TRANSLATION_TABLE: readonly TranslationRow[] = parseTranslationTable();

export type DefinitionSection = 'plugins' | 'mcp' | 'skills' | 'commands' | 'hooks';

export type AgentCapabilitySection = 'memory' | 'roles' | DefinitionSection;

export const DEFINITION_SECTIONS: readonly DefinitionSection[] = ['plugins', 'mcp', 'skills', 'commands', 'hooks'];

export const isAgentCapabilitySection = (section: SettingsSection): section is AgentCapabilitySection =>
  section === 'memory' ||
  section === 'roles' ||
  section === 'plugins' ||
  section === 'mcp' ||
  section === 'skills' ||
  section === 'commands' ||
  section === 'hooks';

export const definitionKindOf = (section: DefinitionSection): 'plugin' | 'mcp' | 'skill' | 'command' | 'hook' => {
  switch (section) {
    case 'plugins':
      return 'plugin';
    case 'mcp':
      return 'mcp';
    case 'skills':
      return 'skill';
    case 'commands':
      return 'command';
    case 'hooks':
      return 'hook';
  }
};

export const importSectionOf = (section: DefinitionSection): 'candidates' | 'machine' | null => {
  if (section === 'mcp' || section === 'skills') return 'candidates';
  if (section === 'plugins') return 'machine';
  return null;
};

export type MemoryScope = 'global' | 'project' | 'repo';

export interface RoleLibraryRow {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly writeScope: WriteScope;
  readonly linkedCount: number;
  readonly warningKey: LabelKey | null;
  readonly warningProviders: string;
  readonly pastVersions: RoleListItem['pastVersions'];
}

export interface MachineImportRow {
  readonly key: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly name: string;
  readonly sourcePath: string;
  readonly secretNames: readonly string[];
  readonly importable: boolean;
  readonly added: boolean;
}

export interface CandidateImportRow {
  readonly identity: string;
  readonly providerId: string;
  readonly providerName: string;
  readonly name: string;
  readonly path: string | null;
  readonly command: string | null;
  readonly imported: boolean;
}

export type CreateDraft =
  | { readonly kind: 'memory'; readonly text: string; readonly scope: MemoryScope; readonly scopeId: string }
  | { readonly kind: 'roles'; readonly name: string }
  | { readonly kind: 'commands'; readonly name: string }
  | { readonly kind: 'hooks'; readonly name: string };

export type AgentView = 'list' | 'import' | 'create';

/** The restore refusal sentences (U-305): the stopped reasons in restart vocabulary. */
export const MCP_RESTORE_ERROR_KEY: Readonly<Record<'endpoint_unavailable' | 'listener_failed' | 'script_missing', LabelKey>> = {
  endpoint_unavailable: 'capabilities.mcp.reason.no_endpoint',
  listener_failed: 'capabilities.mcp.reason.listener_down',
  script_missing: 'capabilities.mcp.reason.script_missing',
};

export interface AgentCapabilitiesState {
  readonly section: AgentCapabilitySection | null;
  readonly loaded: boolean;
  readonly loading: boolean;
  readonly problem: string | null;
  readonly view: AgentView;
  readonly memory: MemoryOverviewView | null;
  readonly memoryScope: MemoryScope;
  readonly projectNames: Readonly<Record<string, string>>;
  readonly repoNames: Readonly<Record<string, string>>;
  readonly roles: readonly RoleLibraryRow[];
  readonly definitions: Readonly<Record<DefinitionSection, readonly DefinitionListItem[]>>;
  readonly capabilityKinds: Readonly<Record<string, CapabilityKind>>;
  readonly installedProviders: readonly string[];
  readonly providerNames: Readonly<Record<string, string>>;
  readonly machineRows: readonly MachineImportRow[];
  readonly candidateRows: readonly CandidateImportRow[];
  readonly importScanning: boolean;
  readonly importLoaded: boolean;
  readonly createDraft: CreateDraft | null;
  readonly confirmDiscard: boolean;
  readonly saving: boolean;
  /** The built-in Docket row's standing (U-305); null until the MCP section first reads it. */
  readonly mcp: McpStatusView | null;
  readonly mcpBusy: boolean;
  /** The one inline result line of "Geri yükle": restored, or the typed refusal sentence. */
  readonly mcpResult: LabelKey | null;
}

export interface AgentCapabilitiesStore {
  state(): AgentCapabilitiesState;
  subscribe(listener: () => void): () => void;
  setSection(section: AgentCapabilitySection): void;
  load(): Promise<void>;
  setMemoryScope(scope: MemoryScope): void;
  setAutoAccept(scope: MemoryScope, enabled: boolean): Promise<void>;
  acceptProposal(id: string): Promise<void>;
  rejectProposal(id: string): Promise<void>;
  openImport(): void;
  openCreate(): void;
  closeSubview(): boolean;
  requestLeave(): boolean;
  confirmDiscardLeave(): void;
  cancelDiscardLeave(): void;
  rescanImport(): Promise<void>;
  importMachine(keys: readonly string[]): Promise<void>;
  importCandidates(identities: readonly string[]): Promise<void>;
  setCreateDraft(draft: CreateDraft): void;
  saveCreate(): Promise<void>;
  restoreMcp(): Promise<void>;
  cancelCreate(): void;
  rowWarning(kind: CapabilityKind): LabelKey | null;
  rowWarningProviders(kind: CapabilityKind): string;
  roleWarning(role: RoleLibraryRow): LabelKey | null;
}

export interface AgentCapabilitiesDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly runCommand: (command: Command) => Promise<CommandResult>;
  readonly roleLibrary: () => Promise<readonly VersionRecord<RoleDef>[]>;
  readonly now: () => number;
}

const EMPTY_DEFINITIONS: AgentCapabilitiesState['definitions'] = {
  plugins: [],
  mcp: [],
  skills: [],
  commands: [],
  hooks: [],
};

const initialState = (): AgentCapabilitiesState => ({
  section: null,
  loaded: false,
  loading: false,
  problem: null,
  view: 'list',
  memory: null,
  memoryScope: 'global',
  projectNames: {},
  repoNames: {},
  roles: [],
  definitions: EMPTY_DEFINITIONS,
  capabilityKinds: {},
  installedProviders: [],
  providerNames: {},
  machineRows: [],
  candidateRows: [],
  importScanning: false,
  importLoaded: false,
  createDraft: null,
  confirmDiscard: false,
  saving: false,
  mcp: null,
  mcpBusy: false,
  mcpResult: null,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const capabilityKindOfBody = (body: unknown): CapabilityKind | undefined => {
  if (!isRecord(body) || typeof body.kind !== 'string') return undefined;
  const kind = body.kind;
  if (kind === 'mcp' || kind === 'skill' || kind === 'hook' || kind === 'plugin' || kind === 'command' || kind === 'context') {
    return kind;
  }
  return undefined;
};

const slugId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';

const installedProviderIds = (facts: readonly ProviderFact[]): readonly string[] =>
  facts.filter((fact) => providerStatus(fact) !== 'not_installed').map((fact) => fact.defId);

const providerNameMap = (facts: readonly ProviderFact[]): Readonly<Record<string, string>> => {
  const map: Record<string, string> = {};
  for (const fact of facts) map[fact.defId] = fact.name;
  return map;
};

const formatProviders = (ids: readonly string[], names: Readonly<Record<string, string>>): string =>
  ids.map((id) => names[id] ?? id).join(', ');

/** P-57 row note for one capability kind across installed providers; null when every support is native. */
export const warningForKind = (
  kind: CapabilityKind,
  installed: readonly string[],
  names: Readonly<Record<string, string>>,
): { readonly key: LabelKey; readonly providers: string } | null => {
  const degraded: string[] = [];
  const unsupported: string[] = [];
  const unverified: string[] = [];
  for (const provider of installed) {
    const row = supportFor(CAPABILITY_TRANSLATION_TABLE, provider, kind);
    if (row.support === 'native') continue;
    if (row.support === 'degraded') degraded.push(provider);
    else if (row.support === 'unsupported') unsupported.push(provider);
    else unverified.push(provider);
  }
  if (unsupported.length > 0) {
    return { key: 'capabilities.warning.unsupported', providers: formatProviders(unsupported, names) };
  }
  if (degraded.length > 0) {
    return { key: 'capabilities.warning.degraded', providers: formatProviders(degraded, names) };
  }
  if (unverified.length > 0) {
    return { key: 'capabilities.warning.unverified', providers: formatProviders(unverified, names) };
  }
  return null;
};

const roleRowWarning = (
  capabilities: readonly string[],
  kinds: Readonly<Record<string, CapabilityKind>>,
  installed: readonly string[],
  names: Readonly<Record<string, string>>,
): { readonly key: LabelKey; readonly providers: string } | null => {
  const seen = new Set<CapabilityKind>();
  for (const id of capabilities) {
    const kind = kinds[id];
    if (kind !== undefined) seen.add(kind);
  }
  for (const kind of seen) {
    const warning = warningForKind(kind, installed, names);
    if (warning !== null) return warning;
  }
  return null;
};

const createDraftDirty = (draft: CreateDraft | null): boolean => {
  if (draft === null) return false;
  switch (draft.kind) {
    case 'memory':
      return draft.text.trim() !== '';
    case 'roles':
    case 'commands':
    case 'hooks':
      return draft.name.trim() !== '';
  }
};

const mergeRoleRows = (
  list: readonly RoleListItem[],
  library: readonly VersionRecord<RoleDef>[],
  kinds: Readonly<Record<string, CapabilityKind>>,
  installed: readonly string[],
  names: Readonly<Record<string, string>>,
): readonly RoleLibraryRow[] => {
  const bodies = new Map(library.map((record) => [record.definitionId, record.body]));
  return list.map((item) => {
    const body = bodies.get(item.id);
    const writeScope = body?.writeScope ?? { kind: 'none' as const };
    const caps = body?.capabilities ?? [];
    const warning = roleRowWarning(caps, kinds, installed, names);
    return {
      id: item.id,
      name: item.name,
      version: item.version,
      writeScope,
      linkedCount: caps.length,
      warningKey: warning?.key ?? null,
      warningProviders: warning?.providers ?? '',
      pastVersions: item.pastVersions,
    };
  });
};

export const createAgentCapabilitiesStore = (deps: AgentCapabilitiesDeps): AgentCapabilitiesStore => {
  let state = initialState();
  const listeners = new Set<() => void>();

  const publish = (next: AgentCapabilitiesState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const readProviders = async (): Promise<{ readonly installed: readonly string[]; readonly names: Readonly<Record<string, string>> }> => {
    const reply: unknown = await deps.api.query({ type: 'providers.discovered' } satisfies Query);
    if (!Array.isArray(reply)) return { installed: [], names: {} };
    const facts = reply as readonly ProviderFact[];
    return { installed: installedProviderIds(facts), names: providerNameMap(facts) };
  };

  const readTreeNames = async (): Promise<Pick<AgentCapabilitiesState, 'projectNames' | 'repoNames'>> => {
    const reply: unknown = await deps.api.query({ type: 'project.tree' } satisfies Query);
    if (!Array.isArray(reply)) return { projectNames: {}, repoNames: {} };
    const projectNames: Record<string, string> = {};
    const repoNames: Record<string, string> = {};
    for (const project of reply as readonly {
      readonly project: string;
      readonly name: string;
      readonly repos?: readonly { readonly repo: string; readonly name: string }[];
    }[]) {
      projectNames[project.project] = project.name;
      for (const repo of project.repos ?? []) repoNames[repo.repo] = repo.name;
    }
    return { projectNames, repoNames };
  };

  const readDefinitions = async (): Promise<{
    readonly definitions: AgentCapabilitiesState['definitions'];
    readonly kinds: Readonly<Record<string, CapabilityKind>>;
  }> => {
    const definitions: Record<DefinitionSection, DefinitionListItem[]> = {
      plugins: [],
      mcp: [],
      skills: [],
      commands: [],
      hooks: [],
    };
    const kinds: Record<string, CapabilityKind> = {};
    for (const section of DEFINITION_SECTIONS) {
      const reply: unknown = await deps.api.query({ type: 'definitions.list', kind: definitionKindOf(section) } satisfies Query);
      if (Array.isArray(reply)) {
        definitions[section] = reply as DefinitionListItem[];
        for (const item of definitions[section]) {
          const kind = capabilityKindOfBody(item.body);
          if (kind !== undefined) kinds[item.definitionId] = kind;
        }
      }
    }
    return { definitions, kinds };
  };

  const loadImport = async (section: DefinitionSection): Promise<void> => {
    const mode = importSectionOf(section);
    if (mode === null) return;
    publish({ ...state, importScanning: true, importLoaded: false });
    const { installed, names } = await readProviders();
    if (mode === 'machine') {
      const reply: unknown = await deps.api.query({ type: 'capabilities.machine', providers: installed } satisfies Query);
      const rows: MachineImportRow[] = [];
      if (isRecord(reply) && Array.isArray(reply.candidates)) {
        for (const entry of reply.candidates as readonly {
          readonly key: string;
          readonly provider: string;
          readonly kind: string;
          readonly name: string;
          readonly sourcePath: string;
          readonly secretNames: readonly string[];
          readonly importable: boolean;
        }[]) {
          if (entry.kind !== 'plugin' && entry.kind !== 'hook') continue;
          if (section === 'plugins' && entry.kind !== 'plugin') continue;
          rows.push({
            key: entry.key,
            providerId: entry.provider,
            providerName: names[entry.provider] ?? entry.provider,
            name: entry.name,
            sourcePath: entry.sourcePath,
            secretNames: entry.secretNames,
            importable: machineCandidateImportable({
              provider: entry.provider,
              kind: entry.kind as CapabilityKind,
              name: entry.name,
              sourcePath: entry.sourcePath,
              secretNames: entry.secretNames,
            }),
            added: false,
          });
        }
      }
      publish({ ...state, machineRows: rows, candidateRows: [], importScanning: false, importLoaded: true, installedProviders: installed, providerNames: names });
      return;
    }
    const accountsReply: unknown = await deps.api.query({ type: 'settings.accounts', catalog: 'skip' } satisfies Query);
    const accountProvider: Record<string, string> = {};
    if (isRecord(accountsReply) && Array.isArray(accountsReply.accounts)) {
      for (const account of accountsReply.accounts as readonly { readonly id: string; readonly provider: string }[]) {
        accountProvider[account.id] = account.provider;
      }
    }
    const reply: unknown = await deps.api.query({ type: 'capabilities.candidates' } satisfies Query);
    const want = section === 'mcp' ? 'mcp' : 'skill';
    const rows: CandidateImportRow[] = [];
    if (isRecord(reply) && Array.isArray(reply.candidates)) {
      for (const entry of reply.candidates as readonly CapabilityCandidateView[]) {
        if (entry.kind !== want) continue;
        const accountId = entry.sources[0] ?? '';
        const providerId = accountProvider[accountId] ?? '';
        rows.push({
          identity: entry.identity,
          providerId,
          providerName: providerId === '' ? '' : (names[providerId] ?? providerId),
          name: entry.name,
          path: entry.path ?? null,
          command: entry.command ?? null,
          imported: entry.imported,
        });
      }
    }
    publish({ ...state, candidateRows: rows, machineRows: [], importScanning: false, importLoaded: true, installedProviders: installed, providerNames: names });
  };

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setSection: (section) => {
      if (state.section === section) return;
      publish({
        ...initialState(),
        section,
        memoryScope: state.memoryScope,
      });
    },
    load: async () => {
      const section = state.section;
      if (section === null) return;
      publish({ ...state, loading: true, problem: null });
      const [{ installed, names }, tree, defs] = await Promise.all([readProviders(), readTreeNames(), readDefinitions()]);
      if (section === 'memory') {
        const reply: unknown = await deps.api.query({ type: 'memory.overview' } satisfies Query);
        if (isQueryFailure(reply)) {
          publish({ ...state, loading: false, problem: reply.code, loaded: state.memory !== null });
          return;
        }
        publish({
          ...state,
          loading: false,
          loaded: true,
          problem: null,
          memory: reply as MemoryOverviewView,
          installedProviders: installed,
          providerNames: names,
          definitions: defs.definitions,
          capabilityKinds: defs.kinds,
          ...tree,
        });
        return;
      }
      if (section === 'roles') {
        const [listReply, library] = await Promise.all([
          deps.api.query({ type: 'roles.list' } satisfies Query),
          deps.roleLibrary(),
        ]);
        if (!Array.isArray(listReply)) {
          publish({ ...state, loading: false, problem: isQueryFailure(listReply) ? listReply.code : 'unknown', loaded: state.roles.length > 0 });
          return;
        }
        const roles = mergeRoleRows(listReply as RoleListItem[], library, defs.kinds, installed, names);
        publish({
          ...state,
          loading: false,
          loaded: true,
          problem: null,
          roles,
          installedProviders: installed,
          providerNames: names,
          ...tree,
          definitions: defs.definitions,
          capabilityKinds: defs.kinds,
        });
        return;
      }
      // The MCP section's first row is the built-in standing (U-305); a failed read keeps the
      // last good one instead of blanking the row.
      const mcpReply: unknown = section === 'mcp' ? await deps.api.query({ type: 'mcp.status' } satisfies Query) : null;
      const mcp = section !== 'mcp' ? state.mcp : isQueryFailure(mcpReply) ? state.mcp : (mcpReply as McpStatusView);
      publish({
        ...state,
        loading: false,
        loaded: true,
        problem: null,
        installedProviders: installed,
        providerNames: names,
        definitions: defs.definitions,
        capabilityKinds: defs.kinds,
        mcp,
        ...tree,
      });
    },
    setMemoryScope: (scope) => {
      publish({ ...state, memoryScope: scope });
    },
    setAutoAccept: async (scope, enabled) => {
      await deps.runCommand({ type: 'memory.setAutoAccept', scope, enabled });
      await (async () => {
        const reply: unknown = await deps.api.query({ type: 'memory.overview' } satisfies Query);
        if (!isQueryFailure(reply)) publish({ ...state, memory: reply as MemoryOverviewView });
      })();
    },
    acceptProposal: async (id) => {
      await deps.runCommand({ type: 'memory.acceptProposal', id });
      const reply: unknown = await deps.api.query({ type: 'memory.overview' } satisfies Query);
      if (!isQueryFailure(reply)) publish({ ...state, memory: reply as MemoryOverviewView });
    },
    rejectProposal: async (id) => {
      await deps.runCommand({ type: 'memory.rejectProposal', id });
      const reply: unknown = await deps.api.query({ type: 'memory.overview' } satisfies Query);
      if (!isQueryFailure(reply)) publish({ ...state, memory: reply as MemoryOverviewView });
    },
    openImport: () => {
      const section = state.section;
      if (section === null || section === 'memory' || section === 'roles' || section === 'commands' || section === 'hooks') return;
      publish({ ...state, view: 'import', createDraft: null });
      void loadImport(section);
    },
    openCreate: () => {
      const section = state.section;
      if (section === null) return;
      if (section !== 'memory' && section !== 'roles' && section !== 'commands' && section !== 'hooks') return;
      const draft: CreateDraft =
        section === 'memory'
          ? { kind: 'memory', text: '', scope: state.memoryScope, scopeId: '' }
          : section === 'roles'
            ? { kind: 'roles', name: '' }
            : section === 'commands'
              ? { kind: 'commands', name: '' }
              : { kind: 'hooks', name: '' };
      publish({ ...state, view: 'create', createDraft: draft });
    },
    closeSubview: () => {
      if (state.view === 'list') return true;
      if (createDraftDirty(state.createDraft)) {
        publish({ ...state, confirmDiscard: true });
        return false;
      }
      publish({ ...state, view: 'list', createDraft: null, confirmDiscard: false });
      return true;
    },
    requestLeave: () => {
      if (!createDraftDirty(state.createDraft) && state.view === 'list') return true;
      publish({ ...state, confirmDiscard: true });
      return false;
    },
    confirmDiscardLeave: () => {
      publish({ ...state, view: 'list', createDraft: null, confirmDiscard: false });
    },
    cancelDiscardLeave: () => {
      publish({ ...state, confirmDiscard: false });
    },
    rescanImport: async () => {
      const section = state.section;
      if (section === null || section === 'memory' || section === 'roles' || section === 'commands' || section === 'hooks') return;
      await loadImport(section);
    },
    importMachine: async (keys) => {
      if (keys.length === 0) return;
      const providers = [...new Set(state.machineRows.filter((row) => keys.includes(row.key)).map((row) => row.providerId))];
      await deps.runCommand({ type: 'capabilities.importMachine', providers, keys });
      const section = state.section;
      if (section !== null && section !== 'memory' && section !== 'roles') await loadImport(section);
      await (async () => {
        const defs = await readDefinitions();
        publish({ ...state, definitions: defs.definitions, capabilityKinds: defs.kinds });
      })();
    },
    importCandidates: async (identities) => {
      if (identities.length === 0) return;
      await deps.runCommand({ type: 'capabilities.import', identities });
      const section = state.section;
      if (section !== null && section !== 'memory' && section !== 'roles') await loadImport(section);
      const defs = await readDefinitions();
      publish({ ...state, definitions: defs.definitions, capabilityKinds: defs.kinds });
    },
    setCreateDraft: (draft) => {
      publish({ ...state, createDraft: draft });
    },
    saveCreate: async () => {
      const draft = state.createDraft;
      if (draft === null) return;
      publish({ ...state, saving: true });
      if (draft.kind === 'memory') {
        const scopeId = draft.scope === 'global' ? undefined : draft.scopeId.trim() === '' ? undefined : draft.scopeId.trim();
        await deps.runCommand({
          type: 'memory.addNote',
          text: draft.text.trim(),
          scope: draft.scope,
          ...(scopeId === undefined ? {} : { scopeId }),
        });
      } else if (draft.kind === 'commands') {
        const id = slugId(draft.name);
        await deps.runCommand({
          type: 'definitions.save',
          kind: 'command',
          definition: { kind: 'command', id, name: draft.name.trim(), template: '', arguments: [] },
        });
      } else if (draft.kind === 'hooks') {
        const id = slugId(draft.name);
        await deps.runCommand({
          type: 'definitions.save',
          kind: 'hook',
          definition: { kind: 'hook', id, name: draft.name.trim(), event: 'run_end', command: '' },
        });
      } else if (draft.kind === 'roles') {
        // Role library save is not on the public command surface yet; wire when definitions.save grows roles.
        await Promise.resolve();
      }
      publish({ ...state, saving: false, view: 'list', createDraft: null });
      const section = state.section;
      if (section === 'memory') {
        const reply: unknown = await deps.api.query({ type: 'memory.overview' } satisfies Query);
        if (!isQueryFailure(reply)) publish({ ...state, memory: reply as MemoryOverviewView });
      } else if (section === 'roles') {
        const [listReply, library] = await Promise.all([
          deps.api.query({ type: 'roles.list' } satisfies Query),
          deps.roleLibrary(),
        ]);
        if (Array.isArray(listReply)) {
          const roles = mergeRoleRows(listReply as RoleListItem[], library, state.capabilityKinds, state.installedProviders, state.providerNames);
          publish({ ...state, roles });
        }
      } else if (section === 'plugins' || section === 'mcp' || section === 'skills' || section === 'commands' || section === 'hooks') {
        const defs = await readDefinitions();
        publish({ ...state, definitions: defs.definitions, capabilityKinds: defs.kinds });
      }
    },
    cancelCreate: () => {
      publish({ ...state, createDraft: null, view: 'list' });
    },
    // The built-in row's one repair (U-305, A-362): one command, then the fresh standing and the
    // inline result line — "Geri yüklendi" or the typed refusal's own sentence. A success carries
    // its own standing; a refusal re-reads, because a refused restart may still have changed it.
    restoreMcp: async () => {
      if (state.mcpBusy) return;
      publish({ ...state, mcpBusy: true, mcpResult: null });
      const result = await deps.runCommand({ type: 'mcp.restore' });
      const refusal = !result.ok && result.error !== undefined ? MCP_RESTORE_ERROR_KEY[result.error] : undefined;
      let standing = state.mcp;
      if (result.ok && result.status !== undefined) standing = result.status;
      else {
        const reply: unknown = await deps.api.query({ type: 'mcp.status' } satisfies Query);
        if (!isQueryFailure(reply)) standing = reply as McpStatusView;
      }
      publish({
        ...state,
        mcpBusy: false,
        mcp: standing,
        mcpResult: result.ok ? 'capabilities.mcp.restored' : (refusal ?? 'error.unknown'),
      });
    },
    rowWarning: (kind) => warningForKind(kind, state.installedProviders, state.providerNames)?.key ?? null,
    rowWarningProviders: (kind) => warningForKind(kind, state.installedProviders, state.providerNames)?.providers ?? '',
    roleWarning: (role) => role.warningKey,
  };
};
