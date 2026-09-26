// definitions/validate.ts — narrows untyped (parsed YAML/JSON) input into typed Definitions.
// Field-by-field narrowing only; every issue is collected before deciding (all-or-nothing).
import { err, ok, parseSlug, type Result, type Slug, type CapabilitySlug, type FlowSlug, type RoleSlug, type StageSlug, type WorkspaceSlug } from '../shared';
import type {
  CapabilityDef,
  Definitions,
  EnvValue,
  FlowDef,
  GateDef,
  HookEvent,
  RepoRef,
  RoleDef,
  RoleOverride,
  StageDef,
  WorkspaceDef,
  WriteScope,
} from './types';

export interface DefinitionIssue {
  readonly path: string; // JSON-pointer-like: "flows[0].stages[2].onFail.goto"
  readonly code: DefinitionIssueCode;
  readonly message: string; // English, for logs; the UI maps `code` to its own copy
}
export type DefinitionIssueCode =
  | 'invalid_slug' | 'duplicate_id' | 'unknown_role' | 'inactive_role' | 'unknown_stage'
  | 'forward_goto' | 'bad_attempts' | 'empty_flow' | 'unknown_capability' | 'unknown_flow'
  | 'default_flow_not_enabled' | 'unknown_command_set' | 'secret_literal' | 'missing_field' | 'wrong_type';

type UnknownRecord = Readonly<Record<string, unknown>>;

const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD)/i;

type GateKind = 'human' | 'command' | 'agent_verdict' | 'secret_scan' | 'page_approval';
type CapabilityKind = 'mcp' | 'skill' | 'hook' | 'context';
type SimpleWriteScopeKind = 'none' | 'docs' | 'tests' | 'repo';

// Internal parse results. Arrays keep their original indices as `undefined` slots so that
// cross-reference checks report precise paths even when a sibling entry failed to parse.
// A draft survives partial failure (fields stay undefined) so reference checks against its
// id still run instead of cascading into phantom "unknown" references.
interface RoleDraft {
  readonly id: RoleSlug | undefined;
  readonly name: string | undefined;
  readonly instructions: string | undefined;
  readonly writeScope: WriteScope | undefined;
  readonly capabilitySlots: readonly (CapabilitySlug | undefined)[] | undefined;
  readonly active: boolean | undefined;
}

interface OnFailDraft {
  readonly goto: StageSlug | undefined;
  readonly maxAttempts: number | undefined;
}

interface StageDraft {
  readonly id: StageSlug;
  readonly name: string;
  readonly role: RoleSlug | null;
  readonly exit: readonly (GateDef | undefined)[];
  readonly onFail: OnFailDraft | undefined;
}

interface FlowDraft {
  readonly id: FlowSlug;
  readonly name: string;
  readonly stages: readonly (StageDraft | undefined)[];
}

interface WorkspaceDraft {
  readonly id: WorkspaceSlug | undefined;
  readonly name: string | undefined;
  readonly repos: readonly RepoRef[] | undefined;
  readonly flowSlots: readonly (FlowSlug | undefined)[] | undefined;
  readonly defaultFlow: FlowSlug | undefined;
  readonly commandSets: Readonly<Record<string, readonly string[]>> | undefined;
  readonly roleOverrides: readonly RoleOverride[] | undefined;
  readonly docsRoot: string | undefined;
  readonly testGlobs: readonly string[] | undefined;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isGateKind = (value: unknown): value is GateKind =>
  value === 'human' || value === 'command' || value === 'agent_verdict' || value === 'secret_scan' || value === 'page_approval';

const isCapabilityKind = (value: unknown): value is CapabilityKind =>
  value === 'mcp' || value === 'skill' || value === 'hook' || value === 'context';

const isSimpleWriteScopeKind = (value: unknown): value is SimpleWriteScopeKind =>
  value === 'none' || value === 'docs' || value === 'tests' || value === 'repo';

const isHookEvent = (value: unknown): value is HookEvent =>
  value === 'before_tool' || value === 'after_tool' || value === 'after_write' || value === 'run_end';

const addIssue = (issues: DefinitionIssue[], path: string, code: DefinitionIssueCode, message: string): void => {
  issues.push({ path, code, message });
};

const readStringField = (issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): string | undefined => {
  const value: unknown = container[field];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (typeof value !== 'string') {
    addIssue(issues, path, 'wrong_type', `${path} must be a string`);
    return undefined;
  }
  return value;
};

const readOptionalStringField = (issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): string | undefined => {
  const value: unknown = container[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    addIssue(issues, path, 'wrong_type', `${path} must be a string`);
    return undefined;
  }
  return value;
};

const readBooleanField = (issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): boolean | undefined => {
  const value: unknown = container[field];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (typeof value !== 'boolean') {
    addIssue(issues, path, 'wrong_type', `${path} must be a boolean`);
    return undefined;
  }
  return value;
};

const readOptionalBooleanField = (issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): boolean | undefined => {
  const value: unknown = container[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    addIssue(issues, path, 'wrong_type', `${path} must be a boolean`);
    return undefined;
  }
  return value;
};

const readNumberField = (issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): number | undefined => {
  const value: unknown = container[field];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (typeof value !== 'number') {
    addIssue(issues, path, 'wrong_type', `${path} must be a number`);
    return undefined;
  }
  return value;
};

const readSlugField = <B extends string>(issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): Slug<B> | undefined => {
  const value = readStringField(issues, container, field, path);
  if (value === undefined) return undefined;
  const parsed = parseSlug<B>(value);
  if (!parsed.ok) {
    addIssue(issues, path, 'invalid_slug', `${path} "${value}" is not a valid slug (^[a-z0-9][a-z0-9-]{0,62}$)`);
    return undefined;
  }
  return parsed.value;
};

const readStringArrayField = (issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): readonly string[] | undefined => {
  const value: unknown = container[field];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an array of strings`);
    return undefined;
  }
  const out: string[] = [];
  let valid = true;
  value.forEach((item: unknown, index: number) => {
    if (typeof item !== 'string') {
      addIssue(issues, `${path}[${index}]`, 'wrong_type', `${path}[${index}] must be a string`);
      valid = false;
    } else {
      out.push(item);
    }
  });
  return valid ? out : undefined;
};

/** Parses an array of slug strings, keeping one slot per input item (undefined = bad item). */
const readSlugSlots = <B extends string>(issues: DefinitionIssue[], value: unknown, path: string): readonly (Slug<B> | undefined)[] | undefined => {
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an array`);
    return undefined;
  }
  const slots: (Slug<B> | undefined)[] = [];
  value.forEach((item: unknown, index: number) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== 'string') {
      addIssue(issues, itemPath, 'wrong_type', `${itemPath} must be a string`);
      slots.push(undefined);
      return;
    }
    const parsed = parseSlug<B>(item);
    if (!parsed.ok) {
      addIssue(issues, itemPath, 'invalid_slug', `${itemPath} "${item}" is not a valid slug`);
      slots.push(undefined);
      return;
    }
    slots.push(parsed.value);
  });
  return slots;
};

const parseWriteScopeValue = (issues: DefinitionIssue[], value: unknown, path: string): WriteScope | undefined => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an object`);
    return undefined;
  }
  const kind: unknown = value['kind'];
  if (kind === undefined) {
    addIssue(issues, `${path}.kind`, 'missing_field', `${path}.kind is required`);
    return undefined;
  }
  if (isSimpleWriteScopeKind(kind)) return { kind };
  if (kind === 'paths') {
    const globs = readStringArrayField(issues, value, 'globs', `${path}.globs`);
    return globs === undefined ? undefined : { kind: 'paths', globs };
  }
  addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be one of none, docs, tests, repo, paths`);
  return undefined;
};

const parseEnv = (issues: DefinitionIssue[], value: unknown, path: string): Readonly<Record<string, EnvValue>> | undefined => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an object`);
    return undefined;
  }
  const env: Record<string, EnvValue> = {};
  let valid = true;
  for (const [key, raw] of Object.entries(value)) {
    const entryPath = `${path}.${key}`;
    if (!isRecord(raw)) {
      addIssue(issues, entryPath, 'wrong_type', `${entryPath} must be { literal } or { secretRef }`);
      valid = false;
      continue;
    }
    const literal: unknown = raw['literal'];
    const secretRef: unknown = raw['secretRef'];
    if (literal !== undefined && secretRef === undefined) {
      if (typeof literal !== 'string') {
        addIssue(issues, entryPath, 'wrong_type', `${entryPath}.literal must be a string`);
        valid = false;
      } else if (SECRET_KEY_RE.test(key)) {
        addIssue(issues, entryPath, 'secret_literal', `${entryPath} has a secret-looking key; use { secretRef } instead of a literal`);
        valid = false;
      } else {
        env[key] = { literal };
      }
    } else if (secretRef !== undefined && literal === undefined) {
      if (typeof secretRef !== 'string') {
        addIssue(issues, entryPath, 'wrong_type', `${entryPath}.secretRef must be a string`);
        valid = false;
      } else {
        env[key] = { secretRef };
      }
    } else {
      addIssue(issues, entryPath, 'wrong_type', `${entryPath} must have exactly one of literal or secretRef`);
      valid = false;
    }
  }
  return valid ? env : undefined;
};

const parseGate = (issues: DefinitionIssue[], container: UnknownRecord, path: string): GateDef | undefined => {
  const kind: unknown = container['kind'];
  if (kind === undefined) {
    addIssue(issues, `${path}.kind`, 'missing_field', `${path}.kind is required`);
    return undefined;
  }
  if (!isGateKind(kind)) {
    addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be one of human, command, agent_verdict, secret_scan, page_approval`);
    return undefined;
  }
  const id = readSlugField<'gate'>(issues, container, 'id', `${path}.id`);
  switch (kind) {
    case 'human':
    case 'page_approval': {
      const label = readStringField(issues, container, 'label', `${path}.label`);
      if (id === undefined || label === undefined) return undefined;
      return { kind, id, label };
    }
    case 'command': {
      const commandSet = readStringField(issues, container, 'commandSet', `${path}.commandSet`);
      if (id === undefined || commandSet === undefined) return undefined;
      return { kind, id, commandSet };
    }
    case 'agent_verdict': {
      const role = readSlugField<'role'>(issues, container, 'role', `${path}.role`);
      if (id === undefined || role === undefined) return undefined;
      return { kind, id, role };
    }
    case 'secret_scan': {
      if (id === undefined) return undefined;
      return { kind, id };
    }
  }
  return undefined;
};

const parseCapability = (issues: DefinitionIssue[], container: UnknownRecord, path: string): CapabilityDef | undefined => {
  const kind: unknown = container['kind'];
  if (kind === undefined) {
    addIssue(issues, `${path}.kind`, 'missing_field', `${path}.kind is required`);
    return undefined;
  }
  if (!isCapabilityKind(kind)) {
    addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be one of mcp, skill, hook, context`);
    return undefined;
  }
  const id = readSlugField<'capability'>(issues, container, 'id', `${path}.id`);
  const name = readStringField(issues, container, 'name', `${path}.name`);
  if (id === undefined || name === undefined) return undefined;
  switch (kind) {
    case 'mcp': {
      const command = readStringField(issues, container, 'command', `${path}.command`);
      const args = readStringArrayField(issues, container, 'args', `${path}.args`);
      const envRaw: unknown = container['env'];
      const env = envRaw === undefined ? undefined : parseEnv(issues, envRaw, `${path}.env`);
      if (envRaw === undefined) addIssue(issues, `${path}.env`, 'missing_field', `${path}.env is required`);
      if (command === undefined || args === undefined || envRaw === undefined || env === undefined) return undefined;
      return { kind, id, name, command, args, env };
    }
    case 'skill':
    case 'context': {
      const filePath = readStringField(issues, container, 'path', `${path}.path`);
      return filePath === undefined ? undefined : { kind, id, name, path: filePath };
    }
    case 'hook': {
      const command = readStringField(issues, container, 'command', `${path}.command`);
      const event: unknown = container['event'];
      if (event === undefined) addIssue(issues, `${path}.event`, 'missing_field', `${path}.event is required`);
      else if (!isHookEvent(event)) addIssue(issues, `${path}.event`, 'wrong_type', `${path}.event must be one of before_tool, after_tool, after_write, run_end`);
      if (command === undefined || event === undefined || !isHookEvent(event)) return undefined;
      return { kind, id, name, event, command };
    }
  }
  return undefined;
};

const parseStage = (issues: DefinitionIssue[], container: UnknownRecord, path: string): StageDraft | undefined => {
  const id = readSlugField<'stage'>(issues, container, 'id', `${path}.id`);
  const name = readStringField(issues, container, 'name', `${path}.name`);

  const roleRaw: unknown = container['role'];
  let role: RoleSlug | null | undefined;
  if (roleRaw === undefined) {
    addIssue(issues, `${path}.role`, 'missing_field', `${path}.role is required (null for a human-only stage)`);
    role = undefined;
  } else if (roleRaw === null) {
    role = null;
  } else if (typeof roleRaw !== 'string') {
    addIssue(issues, `${path}.role`, 'wrong_type', `${path}.role must be a slug string or null`);
    role = undefined;
  } else {
    const parsed = parseSlug<'role'>(roleRaw);
    if (!parsed.ok) {
      addIssue(issues, `${path}.role`, 'invalid_slug', `${path}.role "${roleRaw}" is not a valid slug`);
      role = undefined;
    } else {
      role = parsed.value;
    }
  }

  const exitRaw: unknown = container['exit'];
  let exit: readonly (GateDef | undefined)[] | undefined;
  if (exitRaw === undefined) {
    addIssue(issues, `${path}.exit`, 'missing_field', `${path}.exit is required`);
    exit = undefined;
  } else if (!Array.isArray(exitRaw)) {
    addIssue(issues, `${path}.exit`, 'wrong_type', `${path}.exit must be an array`);
    exit = undefined;
  } else {
    exit = exitRaw.map((gate: unknown, gateIndex: number) => {
      const gatePath = `${path}.exit[${gateIndex}]`;
      if (!isRecord(gate)) {
        addIssue(issues, gatePath, 'wrong_type', `${gatePath} must be an object`);
        return undefined;
      }
      return parseGate(issues, gate, gatePath);
    });
  }

  const onFailRaw: unknown = container['onFail'];
  let onFail: OnFailDraft | undefined;
  if (onFailRaw === undefined) {
    onFail = undefined;
  } else if (!isRecord(onFailRaw)) {
    addIssue(issues, `${path}.onFail`, 'wrong_type', `${path}.onFail must be an object`);
    onFail = undefined;
  } else {
    const goto = readSlugField<'stage'>(issues, onFailRaw, 'goto', `${path}.onFail.goto`);
    let maxAttempts = readNumberField(issues, onFailRaw, 'maxAttempts', `${path}.onFail.maxAttempts`);
    if (maxAttempts !== undefined && (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10)) {
      addIssue(issues, `${path}.onFail.maxAttempts`, 'bad_attempts', `${path}.onFail.maxAttempts must be an integer between 1 and 10`);
      maxAttempts = undefined;
    }
    onFail = { goto, maxAttempts };
  }

  if (id === undefined || name === undefined || role === undefined || exit === undefined) return undefined;
  return { id, name, role, exit, onFail };
};

const parseRole = (issues: DefinitionIssue[], container: UnknownRecord, path: string): RoleDraft | undefined => {
  const id = readSlugField<'role'>(issues, container, 'id', `${path}.id`);
  const name = readStringField(issues, container, 'name', `${path}.name`);
  const instructions = readStringField(issues, container, 'instructions', `${path}.instructions`);
  const writeScopeRaw: unknown = container['writeScope'];
  let writeScope: WriteScope | undefined;
  if (writeScopeRaw === undefined) {
    addIssue(issues, `${path}.writeScope`, 'missing_field', `${path}.writeScope is required`);
    writeScope = undefined;
  } else {
    writeScope = parseWriteScopeValue(issues, writeScopeRaw, `${path}.writeScope`);
  }
  const capabilitySlots = readSlugSlots<'capability'>(issues, container['capabilities'], `${path}.capabilities`);
  const active = readBooleanField(issues, container, 'active', `${path}.active`);

  return { id, name, instructions, writeScope, capabilitySlots, active };
};

const parseRoleOverride = (issues: DefinitionIssue[], container: UnknownRecord, path: string): RoleOverride | undefined => {
  const id = readSlugField<'role'>(issues, container, 'id', `${path}.id`);
  if (id === undefined) return undefined;

  const parts: {
    name?: string;
    instructions?: string;
    writeScope?: WriteScope;
    capabilities?: readonly CapabilitySlug[];
    active?: boolean;
  } = {};
  const name = readOptionalStringField(issues, container, 'name', `${path}.name`);
  if (name !== undefined) parts.name = name;
  const instructions = readOptionalStringField(issues, container, 'instructions', `${path}.instructions`);
  if (instructions !== undefined) parts.instructions = instructions;
  const writeScopeRaw: unknown = container['writeScope'];
  if (writeScopeRaw !== undefined) {
    const writeScope = parseWriteScopeValue(issues, writeScopeRaw, `${path}.writeScope`);
    if (writeScope !== undefined) parts.writeScope = writeScope;
  }
  const capabilityRaw: unknown = container['capabilities'];
  if (capabilityRaw !== undefined) {
    const capabilitySlots = readSlugSlots<'capability'>(issues, capabilityRaw, `${path}.capabilities`);
    if (capabilitySlots !== undefined) {
      parts.capabilities = capabilitySlots.filter((slot): slot is CapabilitySlug => slot !== undefined);
    }
  }
  const active = readOptionalBooleanField(issues, container, 'active', `${path}.active`);
  if (active !== undefined) parts.active = active;

  return { id, ...parts };
};

const parseWorkspace = (issues: DefinitionIssue[], container: UnknownRecord): WorkspaceDraft | undefined => {
  const id = readSlugField<'workspace'>(issues, container, 'id', 'workspace.id');
  const name = readStringField(issues, container, 'name', 'workspace.name');
  const docsRoot = readStringField(issues, container, 'docsRoot', 'workspace.docsRoot');
  const testGlobs = readStringArrayField(issues, container, 'testGlobs', 'workspace.testGlobs');
  const flowSlots = readSlugSlots<'flow'>(issues, container['flows'], 'workspace.flows');
  const defaultFlow = readSlugField<'flow'>(issues, container, 'defaultFlow', 'workspace.defaultFlow');

  const reposRaw: unknown = container['repos'];
  let repos: readonly RepoRef[] | undefined;
  if (reposRaw === undefined) {
    addIssue(issues, 'workspace.repos', 'missing_field', 'workspace.repos is required');
  } else if (!Array.isArray(reposRaw)) {
    addIssue(issues, 'workspace.repos', 'wrong_type', 'workspace.repos must be an array');
  } else {
    const list: RepoRef[] = [];
    reposRaw.forEach((repo: unknown, index: number) => {
      const repoPath = `workspace.repos[${index}]`;
      if (!isRecord(repo)) {
        addIssue(issues, repoPath, 'wrong_type', `${repoPath} must be an object`);
        return;
      }
      const repoId = readStringField(issues, repo, 'id', `${repoPath}.id`);
      const remote = readStringField(issues, repo, 'remote', `${repoPath}.remote`);
      const defaultBranch = readStringField(issues, repo, 'defaultBranch', `${repoPath}.defaultBranch`);
      if (repoId !== undefined && remote !== undefined && defaultBranch !== undefined) {
        list.push({ id: repoId, remote, defaultBranch });
      }
    });
    repos = list;
  }

  const commandSetsRaw: unknown = container['commandSets'];
  let commandSets: Readonly<Record<string, readonly string[]>> | undefined;
  if (commandSetsRaw === undefined) {
    addIssue(issues, 'workspace.commandSets', 'missing_field', 'workspace.commandSets is required');
  } else if (!isRecord(commandSetsRaw)) {
    addIssue(issues, 'workspace.commandSets', 'wrong_type', 'workspace.commandSets must be an object');
  } else {
    const out: Record<string, readonly string[]> = {};
    let valid = true;
    for (const [setName, commands] of Object.entries(commandSetsRaw)) {
      const setPath = `workspace.commandSets.${setName}`;
      if (!Array.isArray(commands)) {
        addIssue(issues, setPath, 'wrong_type', `${setPath} must be an array of strings`);
        valid = false;
        continue;
      }
      const list: string[] = [];
      let setValid = true;
      commands.forEach((command: unknown, index: number) => {
        if (typeof command !== 'string') {
          addIssue(issues, `${setPath}[${index}]`, 'wrong_type', `${setPath}[${index}] must be a string`);
          setValid = false;
        } else {
          list.push(command);
        }
      });
      if (setValid) out[setName] = list;
      else valid = false;
    }
    if (valid) commandSets = out;
  }

  const overridesRaw: unknown = container['roleOverrides'];
  let roleOverrides: readonly RoleOverride[] | undefined;
  if (overridesRaw === undefined) {
    addIssue(issues, 'workspace.roleOverrides', 'missing_field', 'workspace.roleOverrides is required');
  } else if (!Array.isArray(overridesRaw)) {
    addIssue(issues, 'workspace.roleOverrides', 'wrong_type', 'workspace.roleOverrides must be an array');
  } else {
    const list: RoleOverride[] = [];
    overridesRaw.forEach((override: unknown, index: number) => {
      const overridePath = `workspace.roleOverrides[${index}]`;
      if (!isRecord(override)) {
        addIssue(issues, overridePath, 'wrong_type', `${overridePath} must be an object`);
        return;
      }
      const parsed = parseRoleOverride(issues, override, overridePath);
      if (parsed !== undefined) list.push(parsed);
    });
    roleOverrides = list;
  }

  return { id, name, repos, flowSlots, defaultFlow, commandSets, roleOverrides, docsRoot, testGlobs };
};

const parseRoles = (issues: DefinitionIssue[], input: UnknownRecord): readonly (RoleDraft | undefined)[] => {
  const raw: unknown = input['roles'];
  if (raw === undefined) {
    addIssue(issues, 'roles', 'missing_field', 'roles is required');
    return [];
  }
  if (!Array.isArray(raw)) {
    addIssue(issues, 'roles', 'wrong_type', 'roles must be an array');
    return [];
  }
  return raw.map((item: unknown, index: number) => {
    const path = `roles[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, path, 'wrong_type', `${path} must be an object`);
      return undefined;
    }
    return parseRole(issues, item, path);
  });
};

const parseFlows = (issues: DefinitionIssue[], input: UnknownRecord): readonly (FlowDraft | undefined)[] => {
  const raw: unknown = input['flows'];
  if (raw === undefined) {
    addIssue(issues, 'flows', 'missing_field', 'flows is required');
    return [];
  }
  if (!Array.isArray(raw)) {
    addIssue(issues, 'flows', 'wrong_type', 'flows must be an array');
    return [];
  }
  return raw.map((item: unknown, index: number) => {
    const path = `flows[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, path, 'wrong_type', `${path} must be an object`);
      return undefined;
    }
    const id = readSlugField<'flow'>(issues, item, 'id', `${path}.id`);
    const name = readStringField(issues, item, 'name', `${path}.name`);
    const stagesRaw: unknown = item['stages'];
    let stages: readonly (StageDraft | undefined)[] | undefined;
    if (stagesRaw === undefined) {
      addIssue(issues, `${path}.stages`, 'missing_field', `${path}.stages is required`);
      stages = undefined;
    } else if (!Array.isArray(stagesRaw)) {
      addIssue(issues, `${path}.stages`, 'wrong_type', `${path}.stages must be an array`);
      stages = undefined;
    } else {
      if (stagesRaw.length === 0) addIssue(issues, `${path}.stages`, 'empty_flow', `${path} must have at least one stage`);
      stages = stagesRaw.map((stage: unknown, stageIndex: number) => {
        const stagePath = `${path}.stages[${stageIndex}]`;
        if (!isRecord(stage)) {
          addIssue(issues, stagePath, 'wrong_type', `${stagePath} must be an object`);
          return undefined;
        }
        return parseStage(issues, stage, stagePath);
      });
    }
    if (id === undefined || name === undefined || stages === undefined) return undefined;
    return { id, name, stages };
  });
};

const parseCapabilities = (issues: DefinitionIssue[], input: UnknownRecord): readonly (CapabilityDef | undefined)[] => {
  const raw: unknown = input['capabilities'];
  if (raw === undefined) {
    addIssue(issues, 'capabilities', 'missing_field', 'capabilities is required');
    return [];
  }
  if (!Array.isArray(raw)) {
    addIssue(issues, 'capabilities', 'wrong_type', 'capabilities must be an array');
    return [];
  }
  return raw.map((item: unknown, index: number) => {
    const path = `capabilities[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, path, 'wrong_type', `${path} must be an object`);
      return undefined;
    }
    return parseCapability(issues, item, path);
  });
};

const crossCheck = (
  issues: DefinitionIssue[],
  roleDrafts: readonly (RoleDraft | undefined)[],
  capabilityDrafts: readonly (CapabilityDef | undefined)[],
  flowDrafts: readonly (FlowDraft | undefined)[],
  workspace: WorkspaceDraft | undefined,
): void => {
  const roleById = new Map<string, RoleDraft>();
  const seenRoleIds = new Set<string>();
  roleDrafts.forEach((draft, index) => {
    if (draft === undefined || draft.id === undefined) return;
    if (seenRoleIds.has(draft.id)) {
      addIssue(issues, `roles[${index}].id`, 'duplicate_id', `roles[${index}].id "${draft.id}" duplicates an earlier role id`);
    } else {
      seenRoleIds.add(draft.id);
    }
    if (!roleById.has(draft.id)) roleById.set(draft.id, draft);
  });

  const capabilityIds = new Set<string>();
  capabilityDrafts.forEach((draft, index) => {
    if (draft === undefined) return;
    if (capabilityIds.has(draft.id)) {
      addIssue(issues, `capabilities[${index}].id`, 'duplicate_id', `capabilities[${index}].id "${draft.id}" duplicates an earlier capability id`);
    } else {
      capabilityIds.add(draft.id);
    }
  });

  roleDrafts.forEach((draft, roleIndex) => {
    if (draft === undefined) return;
    draft.capabilitySlots?.forEach((slot, slotIndex) => {
      if (slot !== undefined && !capabilityIds.has(slot)) {
        addIssue(issues, `roles[${roleIndex}].capabilities[${slotIndex}]`, 'unknown_capability', `"${slot}" is not a defined capability`);
      }
    });
  });

  const flowIds = new Set<string>();
  flowDrafts.forEach((draft, index) => {
    if (draft === undefined) return;
    if (flowIds.has(draft.id)) {
      addIssue(issues, `flows[${index}].id`, 'duplicate_id', `flows[${index}].id "${draft.id}" duplicates an earlier flow id`);
    } else {
      flowIds.add(draft.id);
    }
  });

  flowDrafts.forEach((draft, flowIndex) => {
    if (draft === undefined) return;
    const stageIdsAtIndex = draft.stages.map((stage) => stage?.id);
    const seenStageIds = new Set<string>();
    draft.stages.forEach((stage, stageIndex) => {
      if (stage === undefined) return;
      const stagePath = `flows[${flowIndex}].stages[${stageIndex}]`;
      if (seenStageIds.has(stage.id)) {
        addIssue(issues, `${stagePath}.id`, 'duplicate_id', `${stagePath}.id "${stage.id}" duplicates an earlier stage id in this flow`);
      } else {
        seenStageIds.add(stage.id);
      }
      if (stage.role !== null) {
        const role = roleById.get(stage.role);
        if (role === undefined) {
          addIssue(issues, `${stagePath}.role`, 'unknown_role', `"${stage.role}" is not a defined role`);
        } else if (role.active === false) {
          addIssue(issues, `${stagePath}.role`, 'inactive_role', `role "${stage.role}" is not active`);
        }
      }
      const seenGateIds = new Set<string>();
      stage.exit.forEach((gate, gateIndex) => {
        if (gate === undefined) return;
        const gatePath = `${stagePath}.exit[${gateIndex}]`;
        if (seenGateIds.has(gate.id)) {
          addIssue(issues, `${gatePath}.id`, 'duplicate_id', `${gatePath}.id "${gate.id}" duplicates an earlier gate id in this stage`);
        } else {
          seenGateIds.add(gate.id);
        }
        if (gate.kind === 'agent_verdict' && !roleById.has(gate.role)) {
          addIssue(issues, `${gatePath}.role`, 'unknown_role', `"${gate.role}" is not a defined role`);
        }
        if (gate.kind === 'command' && workspace !== undefined && workspace.commandSets !== undefined && !(gate.commandSet in workspace.commandSets)) {
          addIssue(issues, `${gatePath}.commandSet`, 'unknown_command_set', `"${gate.commandSet}" is not defined in workspace.commandSets`);
        }
      });
      if (stage.onFail !== undefined && stage.onFail.goto !== undefined) {
        const goto = stage.onFail.goto;
        const gotoPath = `${stagePath}.onFail.goto`;
        const target = stageIdsAtIndex.findIndex((stageId) => stageId === goto);
        if (target === -1) {
          addIssue(issues, gotoPath, 'unknown_stage', `"${goto}" is not a stage of this flow`);
        } else if (target > stageIndex) {
          addIssue(issues, gotoPath, 'forward_goto', `onFail.goto "${goto}" must target the same stage or an earlier one`);
        }
      }
    });
  });

  if (workspace !== undefined) {
    workspace.flowSlots?.forEach((slot, index) => {
      if (slot !== undefined && !flowIds.has(slot)) {
        addIssue(issues, `workspace.flows[${index}]`, 'unknown_flow', `"${slot}" is not a defined flow`);
      }
    });
    if (workspace.defaultFlow !== undefined && workspace.flowSlots !== undefined && !workspace.flowSlots.some((slot) => slot === workspace.defaultFlow)) {
      addIssue(issues, 'workspace.defaultFlow', 'default_flow_not_enabled', `default flow "${workspace.defaultFlow}" is not listed in workspace.flows`);
    }
    workspace.roleOverrides?.forEach((override, index) => {
      if (!roleById.has(override.id)) {
        addIssue(issues, `workspace.roleOverrides[${index}].id`, 'unknown_role', `"${override.id}" is not a defined role`);
      }
    });
  }
};

const buildStageDef = (stage: StageDraft): StageDef | undefined => {
  const exit = stage.exit.filter((gate): gate is GateDef => gate !== undefined);
  if (stage.onFail === undefined) {
    return { id: stage.id, name: stage.name, role: stage.role, exit };
  }
  if (stage.onFail.goto === undefined || stage.onFail.maxAttempts === undefined) return undefined;
  return { id: stage.id, name: stage.name, role: stage.role, exit, onFail: { goto: stage.onFail.goto, maxAttempts: stage.onFail.maxAttempts } };
};

const buildFlowDef = (flow: FlowDraft): FlowDef | undefined => {
  const stages: StageDef[] = [];
  for (const stage of flow.stages) {
    if (stage === undefined) return undefined;
    const built = buildStageDef(stage);
    if (built === undefined) return undefined;
    stages.push(built);
  }
  return { id: flow.id, name: flow.name, stages };
};

const buildWorkspaceDef = (workspace: WorkspaceDraft): WorkspaceDef | undefined => {
  if (
    workspace.id === undefined ||
    workspace.name === undefined ||
    workspace.repos === undefined ||
    workspace.flowSlots === undefined ||
    workspace.defaultFlow === undefined ||
    workspace.commandSets === undefined ||
    workspace.roleOverrides === undefined ||
    workspace.docsRoot === undefined ||
    workspace.testGlobs === undefined
  ) {
    return undefined;
  }
  return {
    id: workspace.id,
    name: workspace.name,
    repos: workspace.repos,
    flows: workspace.flowSlots.filter((slot): slot is FlowSlug => slot !== undefined),
    defaultFlow: workspace.defaultFlow,
    commandSets: workspace.commandSets,
    roleOverrides: workspace.roleOverrides,
    docsRoot: workspace.docsRoot,
    testGlobs: workspace.testGlobs,
  };
};

/** Validates untyped input (parsed YAML/JSON). All-or-nothing: any issue → err with ALL issues. */
export function validateDefinitions(input: unknown): Result<Definitions, readonly DefinitionIssue[]> {
  const issues: DefinitionIssue[] = [];

  if (!isRecord(input)) {
    return err([{ path: '', code: 'wrong_type', message: 'definitions must be an object' }]);
  }

  const roleDrafts = parseRoles(issues, input);
  const flowDrafts = parseFlows(issues, input);
  const capabilityDrafts = parseCapabilities(issues, input);

  const workspaceRaw: unknown = input['workspace'];
  let workspace: WorkspaceDraft | undefined;
  if (workspaceRaw === undefined) {
    workspace = undefined;
  } else if (!isRecord(workspaceRaw)) {
    addIssue(issues, 'workspace', 'wrong_type', 'workspace must be an object');
    workspace = undefined;
  } else {
    workspace = parseWorkspace(issues, workspaceRaw);
  }

  crossCheck(issues, roleDrafts, capabilityDrafts, flowDrafts, workspace);

  if (issues.length > 0) return err(issues);

  const flows: FlowDef[] = [];
  for (const flow of flowDrafts) {
    if (flow === undefined) continue;
    const built = buildFlowDef(flow);
    if (built !== undefined) flows.push(built);
  }

  const roles: RoleDef[] = [];
  for (const draft of roleDrafts) {
    if (
      draft === undefined ||
      draft.id === undefined ||
      draft.name === undefined ||
      draft.instructions === undefined ||
      draft.writeScope === undefined ||
      draft.capabilitySlots === undefined ||
      draft.active === undefined
    ) {
      continue;
    }
    roles.push({
      id: draft.id,
      name: draft.name,
      instructions: draft.instructions,
      writeScope: draft.writeScope,
      capabilities: draft.capabilitySlots.filter((slot): slot is CapabilitySlug => slot !== undefined),
      active: draft.active,
    });
  }

  const base: Omit<Definitions, 'workspace'> = {
    roles,
    flows,
    capabilities: capabilityDrafts.filter((draft): draft is CapabilityDef => draft !== undefined),
  };

  if (workspace === undefined) return ok(base);
  const workspaceDef = buildWorkspaceDef(workspace);
  if (workspaceDef === undefined) return ok(base);
  return ok({ ...base, workspace: workspaceDef });
}
