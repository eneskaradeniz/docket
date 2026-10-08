// definitions/validate.ts — narrows untyped (parsed YAML/JSON) input into typed Definitions.
// Field-by-field narrowing only; every issue is collected before deciding (all-or-nothing).
import type { SpendCap } from '../budget';
import { err, ok, parseSlug, type Result, type Slug, type CapabilitySlug, type EnvSlug, type FlowSlug, type ProjectSlug, type RepoSlug, type RoleSlug, type StageSlug, type EffortLevel, type ThinkingChoice, type Tier } from '../shared';
import type {
  CapabilityDef,
  Definitions,
  EnvironmentDef,
  EnvValue,
  FlowDef,
  GateDef,
  HookEvent,
  ProjectDef,
  RoleDef,
  RoleOverride,
  StageDef,
  RepoDef,
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
  | 'default_flow_not_enabled' | 'unknown_command_set' | 'secret_literal' | 'missing_field' | 'wrong_type'
  | 'unknown_environment' | 'missing_promote_from' | 'promote_cycle'
  | 'env_command_set_missing' | 'duplicate_env_order'
  | 'empty_repos' | 'main_repo_not_listed' | 'bad_review_of';

type UnknownRecord = Readonly<Record<string, unknown>>;

const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD)/i;

type GateKind = 'human' | 'command' | 'changes' | 'agent_verdict' | 'secret_scan' | 'page_approval' | 'deploy' | 'remote_checks';
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
  readonly tier: Tier | undefined;
  readonly thinking: ThinkingChoice | undefined;
  readonly reviewOf: StageSlug | undefined;
}

interface FlowDraft {
  readonly id: FlowSlug;
  readonly name: string;
  readonly stages: readonly (StageDraft | undefined)[];
}

interface EnvironmentDraft {
  readonly id: EnvSlug | undefined;
  readonly name: string | undefined;
  readonly order: number | undefined;
  readonly deploy: string | undefined;
  readonly verify: string | undefined;
  readonly env: Readonly<Record<string, EnvValue>> | undefined;
  readonly protected: boolean | undefined;
  readonly promoteFrom: EnvSlug | undefined;
}

interface RepoDraft {
  readonly id: RepoSlug | undefined;
  readonly name: string | undefined;
  readonly budget: SpendCap | undefined;
  readonly flowSlots: readonly (FlowSlug | undefined)[] | undefined;
  readonly defaultFlow: FlowSlug | undefined;
  readonly commandSets: Readonly<Record<string, readonly string[]>> | undefined;
  readonly roleOverrides: readonly RoleOverride[] | undefined;
  readonly docsRoot: string | undefined;
  readonly testGlobs: readonly string[] | undefined;
  readonly environments: readonly (EnvironmentDraft | undefined)[] | undefined;
}

interface ProjectDraft {
  readonly id: ProjectSlug | undefined;
  readonly name: string | undefined;
  readonly mainRepo: RepoSlug | undefined;
  readonly repoSlots: readonly (RepoSlug | undefined)[] | undefined;
  readonly budget: SpendCap | undefined;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isGateKind = (value: unknown): value is GateKind =>
  value === 'human' || value === 'command' || value === 'changes' || value === 'agent_verdict' || value === 'secret_scan' || value === 'page_approval' || value === 'deploy' || value === 'remote_checks';

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

const readOptionalSlugField = <B extends string>(issues: DefinitionIssue[], container: UnknownRecord, field: string, path: string): Slug<B> | undefined => {
  const value = readOptionalStringField(issues, container, field, path);
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

/** `required` on a remote_checks gate: the string 'all' or a list of check names. */
const readRequiredChecksField = (issues: DefinitionIssue[], container: UnknownRecord, path: string): readonly string[] | 'all' | undefined => {
  const value: unknown = container['required'];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (value === 'all') return 'all';
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be "all" or an array of strings`);
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

const parseGate = (issues: DefinitionIssue[], container: UnknownRecord, path: string): GateDef | undefined => {
  const kind: unknown = container['kind'];
  if (kind === undefined) {
    addIssue(issues, `${path}.kind`, 'missing_field', `${path}.kind is required`);
    return undefined;
  }
  if (!isGateKind(kind)) {
    addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be one of human, command, changes, agent_verdict, secret_scan, page_approval, deploy, remote_checks`);
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
    case 'changes': {
      if (id === undefined) return undefined;
      return { kind, id };
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
    case 'deploy': {
      const environment = readSlugField<'env'>(issues, container, 'environment', `${path}.environment`);
      if (id === undefined || environment === undefined) return undefined;
      return { kind, id, environment };
    }
    case 'remote_checks': {
      const required = readRequiredChecksField(issues, container, `${path}.required`);
      const timeoutMinutes = readNumberField(issues, container, 'timeoutMinutes', `${path}.timeoutMinutes`);
      if (id === undefined || required === undefined || timeoutMinutes === undefined) return undefined;
      return { kind, id, required, timeoutMinutes };
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

const TIERS: readonly string[] = ['strong', 'balanced', 'fast'];
const LEVELS: readonly string[] = ['fast', 'balanced', 'deep'];
const EFFORTS: readonly string[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

const readOptionalTier = (issues: DefinitionIssue[], container: UnknownRecord, path: string): Tier | undefined => {
  const raw: unknown = container['tier'];
  if (raw === undefined) return undefined;
  if (typeof raw === 'string' && TIERS.includes(raw)) return raw as Tier;
  addIssue(issues, path, 'wrong_type', `${path} must be one of strong, balanced, fast`);
  return undefined;
};

const readOptionalThinking = (issues: DefinitionIssue[], container: UnknownRecord, path: string): ThinkingChoice | undefined => {
  const raw: unknown = container['thinking'];
  if (raw === undefined) return undefined;
  if (isRecord(raw)) {
    const keys = Object.keys(raw);
    const level: unknown = raw['level'];
    const effort: unknown = raw['effort'];
    if (keys.length === 1 && typeof level === 'string' && LEVELS.includes(level)) {
      return { level: level as 'fast' | 'balanced' | 'deep' };
    }
    if (keys.length === 1 && typeof effort === 'string' && EFFORTS.includes(effort)) {
      return { effort: effort as EffortLevel };
    }
  }
  addIssue(issues, path, 'wrong_type', `${path} must be { level: fast|balanced|deep } or { effort: <effort level> }`);
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

  const tier = readOptionalTier(issues, container, `${path}.tier`);
  const thinking = readOptionalThinking(issues, container, `${path}.thinking`);
  const reviewOf = readOptionalSlugField<'stage'>(issues, container, 'reviewOf', `${path}.reviewOf`);

  if (id === undefined || name === undefined || role === undefined || exit === undefined) return undefined;
  return { id, name, role, exit, onFail, tier, thinking, reviewOf };
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

const parseEnvironment = (issues: DefinitionIssue[], container: UnknownRecord, path: string): EnvironmentDraft => {
  const id = readSlugField<'env'>(issues, container, 'id', `${path}.id`);
  const name = readStringField(issues, container, 'name', `${path}.name`);
  const order = readNumberField(issues, container, 'order', `${path}.order`);
  const deploy = readStringField(issues, container, 'deploy', `${path}.deploy`);
  const verify = readOptionalStringField(issues, container, 'verify', `${path}.verify`);
  const envRaw: unknown = container['env'];
  let env: Readonly<Record<string, EnvValue>> | undefined;
  if (envRaw === undefined) {
    addIssue(issues, `${path}.env`, 'missing_field', `${path}.env is required`);
  } else {
    env = parseEnv(issues, envRaw, `${path}.env`);
  }
  const protectedEnv = readBooleanField(issues, container, 'protected', `${path}.protected`);
  const promoteFrom = readOptionalSlugField<'env'>(issues, container, 'promoteFrom', `${path}.promoteFrom`);
  return { id, name, order, deploy, verify, env, protected: protectedEnv, promoteFrom };
};

const parseEnvironments = (issues: DefinitionIssue[], container: UnknownRecord): readonly (EnvironmentDraft | undefined)[] | undefined => {
  const raw: unknown = container['environments'];
  if (raw === undefined) return undefined; // optional, default []
  if (!Array.isArray(raw)) {
    addIssue(issues, 'repo.environments', 'wrong_type', 'repo.environments must be an array');
    return undefined;
  }
  return raw.map((item: unknown, index: number) => {
    const envPath = `repo.environments[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, envPath, 'wrong_type', `${envPath} must be an object`);
      return undefined;
    }
    return parseEnvironment(issues, item, envPath);
  });
};

const parseRepo = (issues: DefinitionIssue[], container: UnknownRecord): RepoDraft | undefined => {
  const id = readSlugField<'repo'>(issues, container, 'id', 'repo.id');
  const name = readStringField(issues, container, 'name', 'repo.name');
  const docsRoot = readStringField(issues, container, 'docsRoot', 'repo.docsRoot');
  const testGlobs = readStringArrayField(issues, container, 'testGlobs', 'repo.testGlobs');
  const flowSlots = readSlugSlots<'flow'>(issues, container['flows'], 'repo.flows');
  const defaultFlow = readSlugField<'flow'>(issues, container, 'defaultFlow', 'repo.defaultFlow');
  const budgetRaw: unknown = container['budget'];
  const budget = budgetRaw === undefined ? undefined : parseSpendCap(issues, budgetRaw, 'repo.budget');

  const commandSetsRaw: unknown = container['commandSets'];
  let commandSets: Readonly<Record<string, readonly string[]>> | undefined;
  if (commandSetsRaw === undefined) {
    addIssue(issues, 'repo.commandSets', 'missing_field', 'repo.commandSets is required');
  } else if (!isRecord(commandSetsRaw)) {
    addIssue(issues, 'repo.commandSets', 'wrong_type', 'repo.commandSets must be an object');
  } else {
    const out: Record<string, readonly string[]> = {};
    let valid = true;
    for (const [setName, commands] of Object.entries(commandSetsRaw)) {
      const setPath = `repo.commandSets.${setName}`;
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
    addIssue(issues, 'repo.roleOverrides', 'missing_field', 'repo.roleOverrides is required');
  } else if (!Array.isArray(overridesRaw)) {
    addIssue(issues, 'repo.roleOverrides', 'wrong_type', 'repo.roleOverrides must be an array');
  } else {
    const list: RoleOverride[] = [];
    overridesRaw.forEach((override: unknown, index: number) => {
      const overridePath = `repo.roleOverrides[${index}]`;
      if (!isRecord(override)) {
        addIssue(issues, overridePath, 'wrong_type', `${overridePath} must be an object`);
        return;
      }
      const parsed = parseRoleOverride(issues, override, overridePath);
      if (parsed !== undefined) list.push(parsed);
    });
    roleOverrides = list;
  }

  return { id, name, budget, flowSlots, defaultFlow, commandSets, roleOverrides, docsRoot, testGlobs, environments: parseEnvironments(issues, container) };
};

/** A budget, in the project or the repo section, must be a valid SpendCap; anything else is wrong_type. */
const parseSpendCap = (issues: DefinitionIssue[], value: unknown, path: string): SpendCap | undefined => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be a SpendCap ({ amountUsd, warnPercent })`);
    return undefined;
  }
  let valid = true;
  const amountRaw: unknown = value['amountUsd'];
  const amountUsd = typeof amountRaw === 'number' && Number.isFinite(amountRaw) ? amountRaw : undefined;
  if (amountUsd === undefined) {
    addIssue(issues, `${path}.amountUsd`, 'wrong_type', `${path}.amountUsd must be a number`);
    valid = false;
  }
  const warnRaw: unknown = value['warnPercent'];
  const warnPercent = typeof warnRaw === 'number' && Number.isFinite(warnRaw) && warnRaw >= 1 && warnRaw <= 100 ? warnRaw : undefined;
  if (warnPercent === undefined) {
    addIssue(issues, `${path}.warnPercent`, 'wrong_type', `${path}.warnPercent must be a number between 1 and 100`);
    valid = false;
  }
  if (!valid || amountUsd === undefined || warnPercent === undefined) return undefined;
  return { amountUsd, warnPercent };
};

const parseProject = (issues: DefinitionIssue[], container: UnknownRecord): ProjectDraft => {
  const id = readSlugField<'project'>(issues, container, 'id', 'project.id');
  const name = readStringField(issues, container, 'name', 'project.name');
  const mainRepo = readSlugField<'repo'>(issues, container, 'mainRepo', 'project.mainRepo');
  const repoSlots = readSlugSlots<'repo'>(issues, container['repos'], 'project.repos');
  const budgetRaw: unknown = container['budget'];
  const budget = budgetRaw === undefined ? undefined : parseSpendCap(issues, budgetRaw, 'project.budget');
  return { id, name, mainRepo, repoSlots, budget };
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
  repo: RepoDraft | undefined,
  project: ProjectDraft | undefined,
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

  // First parsed occurrence wins, so references to an id whose entry failed elsewhere still resolve
  // instead of cascading into phantom "unknown" reports.
  const envById = new Map<string, EnvironmentDraft>();
  const envIds = new Set<string>();
  repo?.environments?.forEach((draft) => {
    if (draft === undefined || draft.id === undefined) return;
    envIds.add(draft.id);
    if (!envById.has(draft.id)) envById.set(draft.id, draft);
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
        if (gate.kind === 'command' && repo !== undefined && repo.commandSets !== undefined && !(gate.commandSet in repo.commandSets)) {
          addIssue(issues, `${gatePath}.commandSet`, 'unknown_command_set', `"${gate.commandSet}" is not defined in repo.commandSets`);
        }
        if (gate.kind === 'deploy' && repo !== undefined && !envIds.has(gate.environment)) {
          addIssue(issues, `${gatePath}.environment`, 'unknown_environment', `"${gate.environment}" is not a defined environment`);
        }
      });
      if (stage.reviewOf !== undefined) {
        const target = stageIdsAtIndex.findIndex((stageId) => stageId === stage.reviewOf);
        const targetRole = target === -1 ? undefined : draft.stages[target]?.role;
        if (target === -1 || target >= stageIndex || targetRole === null || targetRole === undefined) {
          addIssue(issues, `${stagePath}.reviewOf`, 'bad_review_of', `reviewOf "${stage.reviewOf}" must name an earlier stage of this flow that has a role`);
        }
      }
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

  if (repo !== undefined) {
    repo.flowSlots?.forEach((slot, index) => {
      if (slot !== undefined && !flowIds.has(slot)) {
        addIssue(issues, `repo.flows[${index}]`, 'unknown_flow', `"${slot}" is not a defined flow`);
      }
    });
    if (repo.defaultFlow !== undefined && repo.flowSlots !== undefined && !repo.flowSlots.some((slot) => slot === repo.defaultFlow)) {
      addIssue(issues, 'repo.defaultFlow', 'default_flow_not_enabled', `default flow "${repo.defaultFlow}" is not listed in repo.flows`);
    }
    repo.roleOverrides?.forEach((override, index) => {
      if (!roleById.has(override.id)) {
        addIssue(issues, `repo.roleOverrides[${index}].id`, 'unknown_role', `"${override.id}" is not a defined role`);
      }
    });

    const seenEnvIds = new Set<string>();
    const seenOrders = new Set<number>();
    repo.environments?.forEach((draft, index) => {
      if (draft === undefined) return;
      const envPath = `repo.environments[${index}]`;
      if (draft.id !== undefined) {
        if (seenEnvIds.has(draft.id)) {
          addIssue(issues, `${envPath}.id`, 'duplicate_id', `${envPath}.id "${draft.id}" duplicates an earlier environment id`);
        } else {
          seenEnvIds.add(draft.id);
        }
      }
      if (draft.order !== undefined) {
        if (seenOrders.has(draft.order)) {
          addIssue(issues, `${envPath}.order`, 'duplicate_env_order', `${envPath}.order ${draft.order} duplicates an earlier environment order`);
        } else {
          seenOrders.add(draft.order);
        }
      }
      if (repo.commandSets !== undefined) {
        if (draft.deploy !== undefined && !(draft.deploy in repo.commandSets)) {
          addIssue(issues, `${envPath}.deploy`, 'env_command_set_missing', `${envPath}.deploy "${draft.deploy}" is not defined in repo.commandSets`);
        }
        if (draft.verify !== undefined && !(draft.verify in repo.commandSets)) {
          addIssue(issues, `${envPath}.verify`, 'env_command_set_missing', `${envPath}.verify "${draft.verify}" is not defined in repo.commandSets`);
        }
      }
    });

    repo.environments?.forEach((draft, index) => {
      if (draft === undefined || draft.id === undefined) return;
      const promotePath = `repo.environments[${index}].promoteFrom`;
      if (draft.protected === true && draft.promoteFrom === undefined) {
        addIssue(issues, promotePath, 'missing_promote_from', `${promotePath} is required for a protected environment`);
      }
      const promoteFrom = draft.promoteFrom;
      if (promoteFrom === undefined) return;
      const target = envById.get(promoteFrom);
      if (target === undefined) {
        addIssue(issues, promotePath, 'unknown_environment', `"${promoteFrom}" is not a defined environment`);
        return;
      }
      if (promoteFrom === draft.id) {
        addIssue(issues, promotePath, 'promote_cycle', `${promotePath} "${promoteFrom}" must name another environment`);
        return;
      }
      // The chain must descend strictly in order, which alone rules cycles out; an order that does
      // not descend is reported as the cycle it makes possible.
      if (draft.order !== undefined && target.order !== undefined && target.order >= draft.order) {
        addIssue(issues, promotePath, 'promote_cycle', `${promotePath} "${promoteFrom}" must name an environment with a lower order`);
        return;
      }
      const visited = new Set<string>([draft.id, promoteFrom]);
      let next: EnvSlug | undefined = target.promoteFrom;
      while (next !== undefined) {
        if (next === draft.id) {
          addIssue(issues, promotePath, 'promote_cycle', `${promotePath} chain reaches "${draft.id}" again`);
          return;
        }
        if (visited.has(next)) return; // a cycle this environment is not part of; its own members report it
        visited.add(next);
        next = envById.get(next)?.promoteFrom;
      }
    });
  }

  if (project !== undefined) {
    if (project.repoSlots !== undefined && project.repoSlots.length === 0) {
      addIssue(issues, 'project.repos', 'empty_repos', 'project.repos must list at least the main repo');
    }
    const seenRepos = new Set<string>();
    project.repoSlots?.forEach((slot, index) => {
      if (slot === undefined) return;
      if (seenRepos.has(slot)) {
        addIssue(issues, `project.repos[${index}]`, 'duplicate_id', `project.repos[${index}] "${slot}" duplicates an earlier repo`);
      } else {
        seenRepos.add(slot);
      }
    });
    if (project.mainRepo !== undefined && project.repoSlots !== undefined && !project.repoSlots.some((slot) => slot === project.mainRepo)) {
      addIssue(issues, 'project.mainRepo', 'main_repo_not_listed', `main repo "${project.mainRepo}" is not listed in project.repos`);
    }
  }
};

const buildStageDef = (stage: StageDraft): StageDef | undefined => {
  const exit = stage.exit.filter((gate): gate is GateDef => gate !== undefined);
  const extras = {
    ...(stage.tier !== undefined ? { tier: stage.tier } : {}),
    ...(stage.thinking !== undefined ? { thinking: stage.thinking } : {}),
    ...(stage.reviewOf !== undefined ? { reviewOf: stage.reviewOf } : {}),
  };
  if (stage.onFail === undefined) {
    return { id: stage.id, name: stage.name, role: stage.role, exit, ...extras };
  }
  if (stage.onFail.goto === undefined || stage.onFail.maxAttempts === undefined) return undefined;
  return { id: stage.id, name: stage.name, role: stage.role, exit, onFail: { goto: stage.onFail.goto, maxAttempts: stage.onFail.maxAttempts }, ...extras };
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

const buildEnvironmentDef = (draft: EnvironmentDraft): EnvironmentDef | undefined => {
  if (
    draft.id === undefined ||
    draft.name === undefined ||
    draft.order === undefined ||
    draft.deploy === undefined ||
    draft.env === undefined ||
    draft.protected === undefined
  ) {
    return undefined;
  }
  return {
    id: draft.id,
    name: draft.name,
    order: draft.order,
    deploy: draft.deploy,
    ...(draft.verify !== undefined ? { verify: draft.verify } : {}),
    env: draft.env,
    protected: draft.protected,
    ...(draft.promoteFrom !== undefined ? { promoteFrom: draft.promoteFrom } : {}),
  };
};

const buildRepoDef = (repo: RepoDraft): RepoDef | undefined => {
  if (
    repo.id === undefined ||
    repo.name === undefined ||
    repo.flowSlots === undefined ||
    repo.defaultFlow === undefined ||
    repo.commandSets === undefined ||
    repo.roleOverrides === undefined ||
    repo.docsRoot === undefined ||
    repo.testGlobs === undefined
  ) {
    return undefined;
  }
  let environments: readonly EnvironmentDef[] | undefined;
  if (repo.environments !== undefined) {
    const list: EnvironmentDef[] = [];
    for (const draft of repo.environments) {
      if (draft === undefined) return undefined;
      const built = buildEnvironmentDef(draft);
      if (built === undefined) return undefined;
      list.push(built);
    }
    environments = list;
  }
  return {
    id: repo.id,
    name: repo.name,
    flows: repo.flowSlots.filter((slot): slot is FlowSlug => slot !== undefined),
    defaultFlow: repo.defaultFlow,
    commandSets: repo.commandSets,
    roleOverrides: repo.roleOverrides,
    docsRoot: repo.docsRoot,
    testGlobs: repo.testGlobs,
    ...(environments !== undefined ? { environments } : {}),
    ...(repo.budget !== undefined ? { budget: repo.budget } : {}),
  };
};

const buildProjectDef = (project: ProjectDraft): ProjectDef | undefined => {
  if (project.id === undefined || project.name === undefined || project.mainRepo === undefined || project.repoSlots === undefined) {
    return undefined;
  }
  const repos = project.repoSlots.filter((slot): slot is RepoSlug => slot !== undefined);
  return project.budget === undefined
    ? { id: project.id, name: project.name, mainRepo: project.mainRepo, repos }
    : { id: project.id, name: project.name, mainRepo: project.mainRepo, repos, budget: project.budget };
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

  const repoRaw: unknown = input['repo'];
  let repo: RepoDraft | undefined;
  if (repoRaw === undefined) {
    repo = undefined;
  } else if (!isRecord(repoRaw)) {
    addIssue(issues, 'repo', 'wrong_type', 'repo must be an object');
    repo = undefined;
  } else {
    repo = parseRepo(issues, repoRaw);
  }

  const projectRaw: unknown = input['project'];
  let project: ProjectDraft | undefined;
  if (projectRaw === undefined) {
    project = undefined;
  } else if (!isRecord(projectRaw)) {
    addIssue(issues, 'project', 'wrong_type', 'project must be an object');
    project = undefined;
  } else {
    project = parseProject(issues, projectRaw);
  }

  crossCheck(issues, roleDrafts, capabilityDrafts, flowDrafts, repo, project);

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

  const base: Omit<Definitions, 'repo' | 'project'> = {
    roles,
    flows,
    capabilities: capabilityDrafts.filter((draft): draft is CapabilityDef => draft !== undefined),
  };

  const repoDef = repo === undefined ? undefined : buildRepoDef(repo);
  const projectDef = project === undefined ? undefined : buildProjectDef(project);
  return ok({
    ...base,
    ...(repoDef !== undefined ? { repo: repoDef } : {}),
    ...(projectDef !== undefined ? { project: projectDef } : {}),
  });
}
