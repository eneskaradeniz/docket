// definitions/validate.ts — narrows untyped (parsed YAML/JSON) input into typed Definitions.
// Field-by-field narrowing only; every issue is collected before deciding (all-or-nothing).
import type { SpendCap } from '../budget';
import { commandPlaceholders } from './command-template';
import type { AccountRoute, LimitPolicy } from '../quota';
import { err, ok, parseAutonomyLevel, parseSlug, parseUlid, type Result, type Slug, type AutonomyLevel, type CapabilitySlug, type EnvSlug, type FlowSlug, type ProjectSlug, type RepoSlug, type RoleSlug, type StageSlug, type EffortLevel, type ThinkingChoice, type Tier } from '../shared';
import type {
  CapabilityDef,
  CapabilityKind,
  PluginSource,
  DefinitionIssue,
  DefinitionIssueCode,
  Definitions,
  EnvironmentDef,
  EnvValue,
  FlowDef,
  GateDef,
  HookEvent,
  ProjectDef,
  RoleDef,
  StageDef,
  RepoDef,
  WriteScope,
} from './types';
import type { RepoFlow, RoleOverlay, RoleRef, StageBinding, VersionRecord } from './repo-flow';
import { effectiveRoles } from './repo-flow';

type UnknownRecord = Readonly<Record<string, unknown>>;

const SECRET_KEY_RE = /(KEY|TOKEN|SECRET|PASSWORD)/i;

type GateKind = 'human' | 'command' | 'changes' | 'agent_verdict' | 'secret_scan' | 'page_approval' | 'deploy' | 'remote_checks';
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
  readonly docketTools: boolean | undefined;
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
  readonly autonomy: AutonomyLevel | undefined;
}

interface FlowDraft {
  readonly id: FlowSlug;
  readonly name: string;
  readonly autonomy: AutonomyLevel | undefined;
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

interface RoleOverlayDraft {
  readonly name?: string;
  readonly instructions?: string;
  readonly writeScope?: WriteScope;
  readonly capabilities?: readonly CapabilitySlug[];
  readonly docketTools?: boolean;
}

interface RoleRefDraft {
  readonly roleId: RoleSlug | undefined;
  readonly version: number | undefined;
  readonly overlay: RoleOverlayDraft | undefined;
  readonly detached: RoleDef | undefined;
}

interface BindingDraft {
  readonly stage: StageSlug | undefined;
  readonly role: RoleRefDraft | undefined;
  readonly accounts: readonly AccountRoute[] | undefined;
  readonly limitPolicy: LimitPolicy | undefined;
}

interface RepoFlowDraft {
  readonly flowId: FlowSlug | undefined;
  readonly version: number | undefined;
  readonly autonomy: AutonomyLevel | undefined;
  readonly stages: readonly (StageDraft | undefined)[] | undefined;
  readonly bindings: readonly (BindingDraft | undefined)[] | undefined;
}

interface RepoDraft {
  readonly id: RepoSlug | undefined;
  readonly name: string | undefined;
  readonly budget: SpendCap | undefined;
  readonly autonomy: AutonomyLevel | undefined;
  readonly maxLevel: AutonomyLevel | undefined;
  readonly flow: RepoFlowDraft | undefined;
  readonly defaultLimitPolicy: LimitPolicy | undefined;
  readonly commandSets: Readonly<Record<string, readonly string[]>> | undefined;
  readonly docsRoot: string | undefined;
  readonly testGlobs: readonly string[] | undefined;
  readonly environments: readonly (EnvironmentDraft | undefined)[] | undefined;
}

interface ProjectDraft {
  readonly id: ProjectSlug | undefined;
  readonly name: string | undefined;
  readonly repoSlots: readonly (RepoSlug | undefined)[] | undefined;
  readonly budget: SpendCap | undefined;
  readonly autonomy: AutonomyLevel | undefined;
}

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isGateKind = (value: unknown): value is GateKind =>
  value === 'human' || value === 'command' || value === 'changes' || value === 'agent_verdict' || value === 'secret_scan' || value === 'page_approval' || value === 'deploy' || value === 'remote_checks';

const isCapabilityKind = (value: unknown): value is CapabilityKind =>
  value === 'mcp' || value === 'skill' || value === 'hook' || value === 'context' || value === 'plugin' || value === 'command';

const isSimpleWriteScopeKind = (value: unknown): value is SimpleWriteScopeKind =>
  value === 'none' || value === 'docs' || value === 'tests' || value === 'repo';

const isHookEvent = (value: unknown): value is HookEvent =>
  value === 'before_tool' || value === 'after_tool' || value === 'after_write' || value === 'run_end';

const addIssue = (issues: DefinitionIssue[], path: string, code: DefinitionIssueCode, message: string): void => {
  issues.push({ path, code, message });
};

// The fixed shapes (repo, project, flow, binding, role ref, overlay) reject keys they do not
// carry — a legacy field is refused the same way as any stray key, never silently ignored.
const REPO_KEYS: readonly string[] = ['id', 'name', 'flow', 'defaultLimitPolicy', 'commandSets', 'docsRoot', 'testGlobs', 'environments', 'budget', 'autonomy', 'maxLevel'];
const PROJECT_KEYS: readonly string[] = ['id', 'name', 'repos', 'budget', 'autonomy'];
const REPO_FLOW_KEYS: readonly string[] = ['flowId', 'version', 'autonomy', 'stages', 'bindings'];
const BINDING_KEYS: readonly string[] = ['stage', 'role', 'accounts', 'limitPolicy'];
const ROLE_REF_KEYS: readonly string[] = ['roleId', 'version', 'overlay', 'detached'];
const OVERLAY_KEYS: readonly string[] = ['name', 'instructions', 'writeScope', 'capabilities', 'docketTools'];
const ACCOUNT_KEYS: readonly string[] = ['accountId', 'model'];

const checkUnknownKeys = (issues: DefinitionIssue[], container: UnknownRecord, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(container)) {
    if (!allowed.includes(key)) {
      addIssue(issues, `${path}.${key}`, 'unknown_field', `${path}.${key} is not a field of ${path}`);
    }
  }
};

const LIMIT_POLICIES: readonly string[] = ['wait_resume', 'switch_pool', 'fallback_account', 'ask'];

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

const parsePluginSource = (issues: DefinitionIssue[], value: unknown, path: string): PluginSource | undefined => {
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (!isRecord(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an object`);
    return undefined;
  }
  const kind: unknown = value['kind'];
  if (kind === 'path') {
    const sourcePath = readStringField(issues, value, 'path', `${path}.path`);
    return sourcePath === undefined ? undefined : { kind, path: sourcePath };
  }
  if (kind === 'marketplace') {
    const marketplace = readStringField(issues, value, 'marketplace', `${path}.marketplace`);
    const name = readStringField(issues, value, 'name', `${path}.name`);
    return marketplace === undefined || name === undefined ? undefined : { kind, marketplace, name };
  }
  addIssue(issues, `${path}.kind`, kind === undefined ? 'missing_field' : 'wrong_type', `${path}.kind must be path or marketplace`);
  return undefined;
};

const parseCommandArguments = (
  issues: DefinitionIssue[],
  value: unknown,
  path: string,
): readonly { readonly name: string; readonly required: boolean }[] | undefined => {
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (!Array.isArray(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an array`);
    return undefined;
  }
  const out: { readonly name: string; readonly required: boolean }[] = [];
  let valid = true;
  value.forEach((item: unknown, index: number) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(item)) {
      addIssue(issues, itemPath, 'wrong_type', `${itemPath} must be an object`);
      valid = false;
      return;
    }
    const name = readStringField(issues, item, 'name', `${itemPath}.name`);
    const required = readBooleanField(issues, item, 'required', `${itemPath}.required`);
    if (name === undefined || required === undefined) valid = false;
    else out.push({ name, required });
  });
  return valid ? out : undefined;
};

const parseCapability = (issues: DefinitionIssue[], container: UnknownRecord, path: string): CapabilityDef | undefined => {
  const kind: unknown = container['kind'];
  if (kind === undefined) {
    addIssue(issues, `${path}.kind`, 'missing_field', `${path}.kind is required`);
    return undefined;
  }
  if (!isCapabilityKind(kind)) {
    addIssue(issues, `${path}.kind`, 'wrong_type', `${path}.kind must be one of mcp, skill, hook, context, plugin, command`);
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
    case 'plugin': {
      const source = parsePluginSource(issues, container['source'], `${path}.source`);
      const version = readOptionalStringField(issues, container, 'version', `${path}.version`);
      const includes = readSlugSlots<'capability'>(issues, container['includes'], `${path}.includes`);
      if (source === undefined || includes === undefined || includes.includes(undefined)) return undefined;
      const slugs = includes.filter((slug): slug is CapabilitySlug => slug !== undefined);
      return { kind, id, name, source, ...(version !== undefined ? { version } : {}), includes: slugs };
    }
    case 'command': {
      const template = readStringField(issues, container, 'template', `${path}.template`);
      const args = parseCommandArguments(issues, container['arguments'], `${path}.arguments`);
      if (template === undefined || args === undefined) return undefined;
      const declared = new Set(args.map((arg) => arg.name));
      let complete = true;
      for (const placeholder of commandPlaceholders(template)) {
        if (!declared.has(placeholder)) {
          addIssue(issues, `${path}.template`, 'unknown_argument', `${path}.template uses {{${placeholder}}} which is not declared in arguments`);
          complete = false;
        }
      }
      return complete ? { kind, id, name, template, arguments: args } : undefined;
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
  const autonomy = parseAutonomyField(issues, container['autonomy'], `${path}.autonomy`);

  if (id === undefined || name === undefined || role === undefined || exit === undefined) return undefined;
  return { id, name, role, exit, onFail, tier, thinking, reviewOf, autonomy };
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

  const docketTools = readOptionalBooleanField(issues, container, 'docketTools', `${path}.docketTools`);

  return { id, name, instructions, writeScope, capabilitySlots, active, docketTools };
};

/** A binding overlay: the fields an overlay may set (never `id`, never `active`). */
const parseRoleOverlay = (issues: DefinitionIssue[], container: UnknownRecord, path: string): RoleOverlayDraft | undefined => {
  checkUnknownKeys(issues, container, OVERLAY_KEYS, path);
  const parts: {
    name?: string;
    instructions?: string;
    writeScope?: WriteScope;
    capabilities?: readonly CapabilitySlug[];
    docketTools?: boolean;
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
  const docketTools = readOptionalBooleanField(issues, container, 'docketTools', `${path}.docketTools`);
  if (docketTools !== undefined) parts.docketTools = docketTools;
  return Object.keys(parts).length === 0 ? undefined : parts;
};

/** The overlay as the typed `RoleOverlay` — a fresh object with only the set fields. */
const buildRoleOverlay = (draft: RoleOverlayDraft): RoleOverlay => ({
  ...(draft.name !== undefined ? { name: draft.name } : {}),
  ...(draft.instructions !== undefined ? { instructions: draft.instructions } : {}),
  ...(draft.writeScope !== undefined ? { writeScope: draft.writeScope } : {}),
  ...(draft.capabilities !== undefined ? { capabilities: [...draft.capabilities] } : {}),
  ...(draft.docketTools !== undefined ? { docketTools: draft.docketTools } : {}),
});

/** `roleId`@`version` with an optional overlay or detached copy. */
const parseRoleRef = (issues: DefinitionIssue[], container: UnknownRecord, path: string): RoleRefDraft | undefined => {
  checkUnknownKeys(issues, container, ROLE_REF_KEYS, path);
  const roleId = readSlugField<'role'>(issues, container, 'roleId', `${path}.roleId`);
  const version = readVersionField(issues, container, `${path}.version`);
  const overlayRaw: unknown = container['overlay'];
  let overlay: RoleOverlayDraft | undefined;
  if (overlayRaw !== undefined) {
    overlay = isRecord(overlayRaw) ? parseRoleOverlay(issues, overlayRaw, `${path}.overlay`) : undefined;
    if (!isRecord(overlayRaw)) addIssue(issues, `${path}.overlay`, 'wrong_type', `${path}.overlay must be an object`);
  }
  const detachedRaw: unknown = container['detached'];
  let detached: RoleDef | undefined;
  if (detachedRaw !== undefined) {
    if (!isRecord(detachedRaw)) {
      addIssue(issues, `${path}.detached`, 'wrong_type', `${path}.detached must be a role body`);
    } else {
      const draft = parseRole(issues, detachedRaw, `${path}.detached`);
      detached = draft === undefined ? undefined : buildRoleDef(draft);
    }
  }
  if (roleId === undefined || version === undefined) return undefined;
  return { roleId, version, overlay, detached };
};

const buildRoleRef = (draft: RoleRefDraft): RoleRef | undefined => {
  if (draft.roleId === undefined || draft.version === undefined) return undefined;
  return {
    roleId: draft.roleId,
    version: draft.version,
    ...(draft.overlay !== undefined ? { overlay: buildRoleOverlay(draft.overlay) } : {}),
    ...(draft.detached !== undefined ? { detached: { ...draft.detached } } : {}),
  };
};

/** One account of a binding's chain: a ULID plus an optional model pin. */
const parseAccountRoute = (issues: DefinitionIssue[], value: unknown, path: string): AccountRoute | undefined => {
  if (!isRecord(value)) {
    addIssue(issues, path, 'wrong_type', `${path} must be an object`);
    return undefined;
  }
  checkUnknownKeys(issues, value, ACCOUNT_KEYS, path);
  const accountIdRaw: unknown = value['accountId'];
  if (typeof accountIdRaw !== 'string') {
    addIssue(issues, `${path}.accountId`, 'wrong_type', `${path}.accountId must be a ULID string`);
    return undefined;
  }
  const accountId = parseUlid<'account'>(accountIdRaw);
  if (!accountId.ok) {
    addIssue(issues, `${path}.accountId`, 'wrong_type', `${path}.accountId "${accountIdRaw}" is not a ULID`);
    return undefined;
  }
  const model = readOptionalStringField(issues, value, 'model', `${path}.model`);
  return model === undefined ? { accountId: accountId.value } : { accountId: accountId.value, model };
};

/** A version number: an integer >= 1. */
const readVersionField = (issues: DefinitionIssue[], container: UnknownRecord, path: string): number | undefined => {
  const value: unknown = container['version'];
  if (value === undefined) {
    addIssue(issues, path, 'missing_field', `${path} is required`);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    addIssue(issues, path, 'wrong_type', `${path} must be an integer >= 1`);
    return undefined;
  }
  return value;
};

/** One stage binding: the stage, its role ref and its ordered account chain. */
const parseBinding = (issues: DefinitionIssue[], container: UnknownRecord, path: string): BindingDraft | undefined => {
  checkUnknownKeys(issues, container, BINDING_KEYS, path);
  const stage = readSlugField<'stage'>(issues, container, 'stage', `${path}.stage`);
  const roleRaw: unknown = container['role'];
  let role: RoleRefDraft | undefined;
  if (roleRaw !== undefined) {
    if (!isRecord(roleRaw)) {
      addIssue(issues, `${path}.role`, 'wrong_type', `${path}.role must be an object`);
    } else {
      role = parseRoleRef(issues, roleRaw, `${path}.role`);
    }
  }
  const accountsRaw: unknown = container['accounts'];
  let accounts: readonly AccountRoute[] | undefined;
  if (accountsRaw === undefined) {
    addIssue(issues, `${path}.accounts`, 'missing_field', `${path}.accounts is required`);
  } else if (!Array.isArray(accountsRaw)) {
    addIssue(issues, `${path}.accounts`, 'wrong_type', `${path}.accounts must be an array`);
  } else {
    const list: AccountRoute[] = [];
    let valid = true;
    accountsRaw.forEach((route: unknown, index: number) => {
      const parsed = parseAccountRoute(issues, route, `${path}.accounts[${index}]`);
      if (parsed === undefined) valid = false;
      else list.push(parsed);
    });
    if (valid) accounts = list;
  }
  const limitPolicyRaw: unknown = container['limitPolicy'];
  let limitPolicy: LimitPolicy | undefined;
  if (limitPolicyRaw !== undefined) {
    if (typeof limitPolicyRaw !== 'string' || !LIMIT_POLICIES.includes(limitPolicyRaw)) {
      addIssue(issues, `${path}.limitPolicy`, 'wrong_type', `${path}.limitPolicy must be one of wait_resume, switch_pool, fallback_account, ask`);
    } else {
      limitPolicy = limitPolicyRaw as LimitPolicy;
    }
  }
  if (stage === undefined || accounts === undefined) return undefined;
  return { stage, role, accounts, limitPolicy };
};

const buildBinding = (draft: BindingDraft): StageBinding | undefined => {
  if (draft.stage === undefined || draft.accounts === undefined) return undefined;
  const role = draft.role === undefined ? undefined : buildRoleRef(draft.role);
  if (draft.role !== undefined && role === undefined) return undefined;
  return {
    stage: draft.stage,
    ...(role === undefined ? {} : { role }),
    accounts: [...draft.accounts],
    ...(draft.limitPolicy === undefined ? {} : { limitPolicy: draft.limitPolicy }),
  };
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

/** The repo's own flow copy: stages plus exactly one binding per stage (R-127). */
const parseRepoFlow = (issues: DefinitionIssue[], container: UnknownRecord): RepoFlowDraft | undefined => {
  checkUnknownKeys(issues, container, REPO_FLOW_KEYS, 'repo.flow');
  const flowId = readSlugField<'flow'>(issues, container, 'flowId', 'repo.flow.flowId');
  const version = readVersionField(issues, container, 'repo.flow.version');
  const autonomy = parseAutonomyField(issues, container['autonomy'], 'repo.flow.autonomy');

  const stagesRaw: unknown = container['stages'];
  let stages: readonly (StageDraft | undefined)[] | undefined;
  if (stagesRaw === undefined) {
    addIssue(issues, 'repo.flow.stages', 'missing_field', 'repo.flow.stages is required');
  } else if (!Array.isArray(stagesRaw)) {
    addIssue(issues, 'repo.flow.stages', 'wrong_type', 'repo.flow.stages must be an array');
  } else {
    if (stagesRaw.length === 0) addIssue(issues, 'repo.flow.stages', 'empty_flow', 'repo.flow.stages must have at least one stage');
    stages = stagesRaw.map((stage: unknown, stageIndex: number) => {
      const stagePath = `repo.flow.stages[${stageIndex}]`;
      if (!isRecord(stage)) {
        addIssue(issues, stagePath, 'wrong_type', `${stagePath} must be an object`);
        return undefined;
      }
      return parseStage(issues, stage, stagePath);
    });
  }

  const bindingsRaw: unknown = container['bindings'];
  let bindings: readonly (BindingDraft | undefined)[] | undefined;
  if (bindingsRaw === undefined) {
    addIssue(issues, 'repo.flow.bindings', 'missing_field', 'repo.flow.bindings is required');
  } else if (!Array.isArray(bindingsRaw)) {
    addIssue(issues, 'repo.flow.bindings', 'wrong_type', 'repo.flow.bindings must be an array');
  } else {
    bindings = bindingsRaw.map((binding: unknown, bindingIndex: number) => {
      const bindingPath = `repo.flow.bindings[${bindingIndex}]`;
      if (!isRecord(binding)) {
        addIssue(issues, bindingPath, 'wrong_type', `${bindingPath} must be an object`);
        return undefined;
      }
      return parseBinding(issues, binding, bindingPath);
    });
  }

  return { flowId, version, autonomy, stages, bindings };
};

const parseRepo = (issues: DefinitionIssue[], container: UnknownRecord): RepoDraft | undefined => {
  checkUnknownKeys(issues, container, REPO_KEYS, 'repo');
  const id = readSlugField<'repo'>(issues, container, 'id', 'repo.id');
  const name = readStringField(issues, container, 'name', 'repo.name');
  const docsRoot = readStringField(issues, container, 'docsRoot', 'repo.docsRoot');
  const testGlobs = readStringArrayField(issues, container, 'testGlobs', 'repo.testGlobs');

  const flowRaw: unknown = container['flow'];
  let flow: RepoFlowDraft | undefined;
  if (flowRaw === undefined) {
    addIssue(issues, 'repo.flow', 'missing_field', 'repo.flow is required');
  } else if (!isRecord(flowRaw)) {
    addIssue(issues, 'repo.flow', 'wrong_type', 'repo.flow must be an object');
  } else {
    flow = parseRepoFlow(issues, flowRaw);
  }

  const limitPolicyRaw: unknown = container['defaultLimitPolicy'];
  let defaultLimitPolicy: LimitPolicy | undefined;
  if (limitPolicyRaw === undefined) {
    addIssue(issues, 'repo.defaultLimitPolicy', 'missing_field', 'repo.defaultLimitPolicy is required');
  } else if (typeof limitPolicyRaw !== 'string' || !LIMIT_POLICIES.includes(limitPolicyRaw)) {
    addIssue(issues, 'repo.defaultLimitPolicy', 'wrong_type', 'repo.defaultLimitPolicy must be one of wait_resume, switch_pool, fallback_account, ask');
  } else {
    defaultLimitPolicy = limitPolicyRaw as LimitPolicy;
  }

  const budgetRaw: unknown = container['budget'];
  const budget = budgetRaw === undefined ? undefined : parseSpendCap(issues, budgetRaw, 'repo.budget');
  const autonomy = parseAutonomyField(issues, container['autonomy'], 'repo.autonomy');
  const maxLevel = parseAutonomyField(issues, container['maxLevel'], 'repo.maxLevel');

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

  return { id, name, budget, autonomy, maxLevel, flow, defaultLimitPolicy, commandSets, docsRoot, testGlobs, environments: parseEnvironments(issues, container) };
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
  checkUnknownKeys(issues, container, PROJECT_KEYS, 'project');
  const id = readSlugField<'project'>(issues, container, 'id', 'project.id');
  const name = readStringField(issues, container, 'name', 'project.name');
  const repoSlots = readSlugSlots<'repo'>(issues, container['repos'], 'project.repos');
  const budgetRaw: unknown = container['budget'];
  const budget = budgetRaw === undefined ? undefined : parseSpendCap(issues, budgetRaw, 'project.budget');
  const autonomy = parseAutonomyField(issues, container['autonomy'], 'project.autonomy');
  return { id, name, repoSlots, budget, autonomy };
};

/** The autonomy level of a definition: absent inherits down the chain, a present value outside
 *  AUTONOMY_LEVELS is wrong_type — never silently dropped, never read as `manual` (R-171). The
 *  membership read rides the one shared parse so the adapters and the validator never disagree. */
const parseAutonomyField = (
  issues: DefinitionIssue[],
  value: unknown,
  path: string,
): AutonomyLevel | undefined => {
  if (value === undefined) return undefined;
  const parsed = parseAutonomyLevel(value);
  if (!parsed.ok) {
    addIssue(issues, path, 'wrong_type', `${path} must be one of manual, balanced, auto`);
    return undefined;
  }
  return parsed.value;
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
    const autonomy = parseAutonomyField(issues, item['autonomy'], `${path}.autonomy`);
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
    return { id, name, autonomy, stages };
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

/** How a stage list checks its `role` references: library flows read the roles list (with the
 *  active rule); the repo's own flow reads the roles list plus what its bindings carry — the
 *  binding, not the library, is the role source there (R-128). */
interface RoleSource {
  readonly extraIds?: ReadonlySet<string>;
  readonly checkActive: boolean;
}

const crossCheckStages = (
  issues: DefinitionIssue[],
  roleDrafts: readonly (RoleDraft | undefined)[],
  envIds: ReadonlySet<string>,
  repo: RepoDraft | undefined,
  stages: readonly (StageDraft | undefined)[],
  pathOf: (stageIndex: number) => string,
  roleSource: RoleSource,
): void => {
  const roleById = new Map<string, RoleDraft>();
  roleDrafts.forEach((draft) => {
    if (draft === undefined || draft.id === undefined) return;
    if (!roleById.has(draft.id)) roleById.set(draft.id, draft);
  });
  const hasRole = (roleId: string): boolean =>
    roleById.has(roleId) || (roleSource.extraIds?.has(roleId) ?? false);

  const stageIdsAtIndex = stages.map((stage) => stage?.id);
  const seenStageIds = new Set<string>();
  stages.forEach((stage, stageIndex) => {
    if (stage === undefined) return;
    const stagePath = pathOf(stageIndex);
    if (seenStageIds.has(stage.id)) {
      addIssue(issues, `${stagePath}.id`, 'duplicate_id', `${stagePath}.id "${stage.id}" duplicates an earlier stage id in this flow`);
    } else {
      seenStageIds.add(stage.id);
    }
    if (stage.role !== null) {
      if (!hasRole(stage.role)) {
        addIssue(issues, `${stagePath}.role`, 'unknown_role', `"${stage.role}" is not a defined role`);
      } else if (roleSource.checkActive && roleById.get(stage.role)?.active === false) {
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
      if (gate.kind === 'agent_verdict' && !hasRole(gate.role)) {
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
      const targetRole = target === -1 ? undefined : stages[target]?.role;
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
};

const crossCheck = (
  issues: DefinitionIssue[],
  roleDrafts: readonly (RoleDraft | undefined)[],
  capabilityDrafts: readonly (CapabilityDef | undefined)[],
  flowDrafts: readonly (FlowDraft | undefined)[],
  repo: RepoDraft | undefined,
  project: ProjectDraft | undefined,
  roleHistories: readonly VersionRecord<RoleDef>[] | undefined,
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

  // R-140: a plugin's includes must name existing capabilities and never lead back to the plugin.
  const includesById = new Map<string, readonly string[]>();
  capabilityDrafts.forEach((draft) => {
    if (draft?.kind === 'plugin' && !includesById.has(draft.id)) includesById.set(draft.id, draft.includes);
  });
  const reaches = (from: string, target: string, seen: Set<string>): boolean => {
    for (const next of includesById.get(from) ?? []) {
      if (next === target) return true;
      if (!seen.has(next)) {
        seen.add(next);
        if (reaches(next, target, seen)) return true;
      }
    }
    return false;
  };
  capabilityDrafts.forEach((draft, index) => {
    if (draft?.kind !== 'plugin') return;
    draft.includes.forEach((included, includeIndex) => {
      if (!capabilityIds.has(included)) {
        addIssue(issues, `capabilities[${index}].includes[${includeIndex}]`, 'unknown_capability', `"${included}" is not a defined capability`);
      }
    });
    if (reaches(draft.id, draft.id, new Set())) {
      addIssue(issues, `capabilities[${index}].includes`, 'plugin_cycle', `plugin "${draft.id}" includes itself, directly or through other plugins`);
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
    crossCheckStages(
      issues, roleDrafts, envIds, repo, draft.stages,
      (stageIndex) => `flows[${flowIndex}].stages[${stageIndex}]`,
      { checkActive: true },
    );
  });

  if (repo !== undefined) {
    const flow = repo.flow;
    if (flow !== undefined && flow.stages !== undefined) {
      // The roles the bindings carry join the library roles as legal stage references.
      const bindingRoleIds = new Set<string>();
      flow.bindings?.forEach((binding) => {
        if (binding?.role === undefined) return;
        if (binding.role.roleId !== undefined) bindingRoleIds.add(binding.role.roleId);
        if (binding.role.detached?.id !== undefined) bindingRoleIds.add(binding.role.detached.id);
      });
      crossCheckStages(
        issues, roleDrafts, envIds, repo, flow.stages,
        (stageIndex) => `repo.flow.stages[${stageIndex}]`,
        { extraIds: bindingRoleIds, checkActive: false },
      );
    }

    const flowStages = flow?.stages;
    const flowBindings = flow?.bindings;
    if (flowStages !== undefined && flowBindings !== undefined) {
      // R-127: exactly one binding per stage, in stage order; two for one stage duplicate_binding.
      const seenStages = new Set<string>();
      flowBindings.forEach((binding, index) => {
        if (binding === undefined || binding.stage === undefined) return;
        const path = `repo.flow.bindings[${index}].stage`;
        if (seenStages.has(binding.stage)) {
          addIssue(issues, path, 'duplicate_binding', `stage "${binding.stage}" has more than one binding`);
          return;
        }
        seenStages.add(binding.stage);
        const stageId = flowStages[index]?.id;
        if (stageId !== binding.stage) {
          addIssue(issues, path, 'binding_stage_mismatch', `binding ${index} names stage "${binding.stage}", but the flow's stage ${index} is "${stageId ?? 'absent'}"`);
        }
      });
      if (flowBindings.length < flowStages.length) {
        addIssue(issues, 'repo.flow.bindings', 'binding_stage_mismatch', 'the flow has stages without a binding');
      }

      // R-128: role presence per stage (paired by stage id, never by position), and the library
      // version a non-detached ref names.
      flowStages.forEach((stage) => {
        if (stage === undefined) return;
        const index = flowBindings.findIndex((binding) => binding?.stage === stage.id);
        if (index === -1) return;
        const binding = flowBindings[index];
        if (binding === undefined) return;
        const rolePath = `repo.flow.bindings[${index}].role`;
        if (stage.role === null) {
          if (binding.role !== undefined) {
            addIssue(issues, rolePath, 'role_forbidden', `stage "${stage.id}" has no role, so its binding cannot carry one`);
          }
        } else if (binding.role === undefined) {
          addIssue(issues, rolePath, 'role_required', `stage "${stage.id}" has a role, so its binding must carry one`);
        } else if (
          binding.role.detached === undefined &&
          roleHistories !== undefined &&
          !roleHistories.some((record) => record.definitionId === binding.role?.roleId && record.version === binding.role?.version)
        ) {
          addIssue(issues, `${rolePath}.version`, 'unknown_role_version', `binding ${index} names ${binding.role.roleId}@${binding.role.version}, which the library does not carry`);
        }
      });

      // Overlay and detached bodies live under the same capability law as role bodies.
      flowBindings.forEach((binding, index) => {
        const ref = binding?.role;
        if (ref === undefined) return;
        const overlaySlots = ref.overlay?.capabilities;
        overlaySlots?.forEach((slot, slotIndex) => {
          if (!capabilityIds.has(slot)) {
            addIssue(issues, `repo.flow.bindings[${index}].role.overlay.capabilities[${slotIndex}]`, 'unknown_capability', `"${slot}" is not a defined capability`);
          }
        });
        ref.detached?.capabilities.forEach((slot, slotIndex) => {
          if (!capabilityIds.has(slot)) {
            addIssue(issues, `repo.flow.bindings[${index}].role.detached.capabilities[${slotIndex}]`, 'unknown_capability', `"${slot}" is not a defined capability`);
          }
        });
      });
    }

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
      addIssue(issues, 'project.repos', 'empty_repos', 'project.repos must list at least one repo');
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
  }
};

const buildStageDef = (stage: StageDraft): StageDef | undefined => {
  const exit = stage.exit.filter((gate): gate is GateDef => gate !== undefined);
  const extras = {
    ...(stage.tier !== undefined ? { tier: stage.tier } : {}),
    ...(stage.thinking !== undefined ? { thinking: stage.thinking } : {}),
    ...(stage.reviewOf !== undefined ? { reviewOf: stage.reviewOf } : {}),
    ...(stage.autonomy !== undefined ? { autonomy: stage.autonomy } : {}),
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
  return {
    id: flow.id,
    name: flow.name,
    ...(flow.autonomy !== undefined ? { autonomy: flow.autonomy } : {}),
    stages,
  };
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

const buildRoleDef = (draft: RoleDraft): RoleDef | undefined => {
  if (
    draft.id === undefined ||
    draft.name === undefined ||
    draft.instructions === undefined ||
    draft.writeScope === undefined ||
    draft.capabilitySlots === undefined ||
    draft.active === undefined
  ) {
    return undefined;
  }
  return {
    id: draft.id,
    name: draft.name,
    instructions: draft.instructions,
    writeScope: draft.writeScope,
    capabilities: draft.capabilitySlots.filter((slot): slot is CapabilitySlug => slot !== undefined),
    active: draft.active,
    ...(draft.docketTools === undefined ? {} : { docketTools: draft.docketTools }),
  };
};

const buildRepoFlow = (draft: RepoFlowDraft): RepoFlow | undefined => {
  if (draft.flowId === undefined || draft.version === undefined || draft.stages === undefined || draft.bindings === undefined) {
    return undefined;
  }
  const stages: StageDef[] = [];
  for (const stage of draft.stages) {
    if (stage === undefined) return undefined;
    const built = buildStageDef(stage);
    if (built === undefined) return undefined;
    stages.push(built);
  }
  const bindings: StageBinding[] = [];
  for (const binding of draft.bindings) {
    if (binding === undefined) return undefined;
    const built = buildBinding(binding);
    if (built === undefined) return undefined;
    bindings.push(built);
  }
  return {
    flowId: draft.flowId,
    version: draft.version,
    ...(draft.autonomy !== undefined ? { autonomy: draft.autonomy } : {}),
    stages,
    bindings,
  };
};

const buildRepoDef = (repo: RepoDraft): RepoDef | undefined => {
  if (
    repo.id === undefined ||
    repo.name === undefined ||
    repo.flow === undefined ||
    repo.defaultLimitPolicy === undefined ||
    repo.commandSets === undefined ||
    repo.docsRoot === undefined ||
    repo.testGlobs === undefined
  ) {
    return undefined;
  }
  const flow = buildRepoFlow(repo.flow);
  if (flow === undefined) return undefined;
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
    flow,
    defaultLimitPolicy: repo.defaultLimitPolicy,
    commandSets: repo.commandSets,
    docsRoot: repo.docsRoot,
    testGlobs: repo.testGlobs,
    ...(environments !== undefined ? { environments } : {}),
    ...(repo.budget !== undefined ? { budget: repo.budget } : {}),
    ...(repo.autonomy !== undefined ? { autonomy: repo.autonomy } : {}),
    ...(repo.maxLevel !== undefined ? { maxLevel: repo.maxLevel } : {}),
  };
};

const buildProjectDef = (project: ProjectDraft): ProjectDef | undefined => {
  if (project.id === undefined || project.name === undefined || project.repoSlots === undefined) {
    return undefined;
  }
  const repos = project.repoSlots.filter((slot): slot is RepoSlug => slot !== undefined);
  return {
    id: project.id,
    name: project.name,
    repos,
    ...(project.budget !== undefined ? { budget: project.budget } : {}),
    ...(project.autonomy !== undefined ? { autonomy: project.autonomy } : {}),
  };
};

/** Narrows a library history body into a RoleDef; a body that fails is simply not resolvable, so
 *  a binding naming its version reports `unknown_role_version` — a broken old version never fails
 *  the whole load. */
const narrowRoleHistory = (record: VersionRecord<unknown>): VersionRecord<RoleDef> | undefined => {
  if (!isRecord(record.body)) return undefined;
  const scratch: DefinitionIssue[] = [];
  const draft = parseRole(scratch, record.body, 'library.role');
  if (draft === undefined || scratch.length > 0) return undefined;
  const body = buildRoleDef(draft);
  return body === undefined ? undefined : { ...record, body };
};

/** Validates untyped input (parsed YAML/JSON). All-or-nothing: any issue → err with ALL issues.
 *  `library.roles`, when given, is the store's version history of the role library: the R-128
 *  version check runs against it and the answer's roles become the repo flow's effective roles
 *  (R-130). Absent, the check is skipped — never guessed — and the parsed library roles stand. */
export function validateDefinitions(
  input: unknown,
  library?: { readonly roles?: readonly VersionRecord<unknown>[] },
): Result<Definitions, readonly DefinitionIssue[]> {
  const issues: DefinitionIssue[] = [];

  if (!isRecord(input)) {
    return err([{ path: '', code: 'wrong_type', message: 'definitions must be an object' }]);
  }

  const roleHistories =
    library?.roles === undefined
      ? undefined
      : library.roles.flatMap(narrowRoleHistory).filter((record): record is VersionRecord<RoleDef> => record !== undefined);

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

  crossCheck(issues, roleDrafts, capabilityDrafts, flowDrafts, repo, project, roleHistories);

  if (issues.length > 0) return err(issues);

  const flows: FlowDef[] = [];
  for (const flow of flowDrafts) {
    if (flow === undefined) continue;
    const built = buildFlowDef(flow);
    if (built !== undefined) flows.push(built);
  }

  const roles: RoleDef[] = [];
  for (const draft of roleDrafts) {
    const built = draft === undefined ? undefined : buildRoleDef(draft);
    if (built !== undefined) roles.push(built);
  }

  const base: Omit<Definitions, 'repo' | 'project'> = {
    roles,
    flows,
    capabilities: capabilityDrafts.filter((draft): draft is CapabilityDef => draft !== undefined),
  };

  const repoDef = repo === undefined ? undefined : buildRepoDef(repo);
  const projectDef = project === undefined ? undefined : buildProjectDef(project);

  // The repo-owned view (R-130): with histories the answer carries each binding's effective role,
  // and the repo's own flow copy under its id replaces the library entry.
  if (repoDef !== undefined && roleHistories !== undefined) {
    const effectiveFlows = [...base.flows];
    const ownIndex = effectiveFlows.findIndex((flow) => flow.id === repoDef.flow.flowId);
    const name = ownIndex === -1 ? repoDef.flow.flowId : effectiveFlows[ownIndex]?.name ?? repoDef.flow.flowId;
    const own: FlowDef = {
      id: repoDef.flow.flowId,
      name,
      ...(repoDef.flow.autonomy !== undefined ? { autonomy: repoDef.flow.autonomy } : {}),
      stages: repoDef.flow.stages,
    };
    if (ownIndex === -1) effectiveFlows.push(own);
    else effectiveFlows[ownIndex] = own;
    return ok({
      ...base,
      roles: effectiveRoles(repoDef.flow, roleHistories),
      flows: effectiveFlows,
      repo: repoDef,
      ...(projectDef !== undefined ? { project: projectDef } : {}),
    });
  }

  return ok({
    ...base,
    ...(repoDef !== undefined ? { repo: repoDef } : {}),
    ...(projectDef !== undefined ? { project: projectDef } : {}),
  });
}

/** Narrows one repo flow body — the same law the `repo.flow` file field validates under. The
 *  api edge applies it to a `repo.saveFlow` payload; the cross-reference rules (R-127/R-128's
 *  stage pairing, the library version check) need the merged view and stay with the caller. */
export function parseRepoFlowValue(value: unknown): Result<RepoFlow, readonly DefinitionIssue[]> {
  const issues: DefinitionIssue[] = [];
  if (!isRecord(value)) {
    return err([{ path: 'repo.flow', code: 'wrong_type', message: 'flow must be an object' }]);
  }
  const draft = parseRepoFlow(issues, value);
  const built = draft === undefined ? undefined : buildRepoFlow(draft);
  if (issues.length > 0) return err(issues);
  if (built === undefined) {
    return err([{ path: 'repo.flow', code: 'wrong_type', message: 'flow is not a valid repo flow' }]);
  }
  return ok(built);
}
