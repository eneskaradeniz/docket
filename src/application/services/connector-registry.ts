// ConnectorRegistry — the list/switch/resolution service of the connector model. The connector
// list is injected by the composition root; this module never imports a connector. It owns the
// one settings key (the enabled ids), the readiness cache and the failure boundary that turns a
// thrown connector exception into a typed error, so no caller of a connector ever sees a crash.
// It performs no write of its own and widens no human gate: switching a connector is a settings
// write, and every outward write a connector performs stays behind the existing gates.
import type { Actor, ConnectorId, ConnectorManifest, Result } from '../../domain/index';
import { err, matchConnectorHost, ok, parseSlug, validateConnectorManifest } from '../../domain/index';
import type { ConnectorManifestError } from '../../domain/index';

import type { AppSettingsRepo } from '../ports/app-settings-repo';
import type { ConnectorContext, ConnectorReadiness } from '../ports/connector-context';
import type { ConnectorModule } from '../ports/connector-module';
import type { Forge, ForgeError } from '../ports/forge';
import type { IssueTracker, TrackerError } from '../ports/issue-tracker';

/** The one settings key of the connector model: a JSON array of the enabled connector ids. */
export const CONNECTORS_ENABLED_KEY = 'connectors.enabled';

export type ConnectorHealth = 'ready' | 'needs_account' | 'needs_cli' | 'invalid';

/** A broken module's cause: the manifest law it failed, or a probe that threw. */
export type ConnectorInvalidCause = ConnectorManifestError | 'connector_failed';

export interface ConnectorListEntry {
  readonly manifest: ConnectorManifest;
  readonly enabled: boolean;
  readonly health: ConnectorHealth;
  readonly error?: ConnectorInvalidCause;
}

export type SetConnectorEnabledError = 'user_only' | 'not_found' | 'invalid' | 'invalid_settings';

/** What the registry needs to resolve one repo: the checkout (the probe's cwd and the adapters'
 *  working directory), its git remote (the host-match arm) and the explicit connector kind the
 *  repo names when it names one — the explicit kind alone selects, no host is inferred then. */
export interface ConnectorRepoSelection {
  readonly path: string;
  readonly remote?: string;
  readonly kind?: string;
}

export interface ConnectorRegistry {
  /** Every injected connector with its switch state and health; a corrupt settings store answers
   *  the typed error instead of a silently defaulted list. */
  list(): Promise<Result<readonly ConnectorListEntry[], 'invalid_settings'>>;
  /** Switches one connector; user actor only, and an invalid manifest is never switchable. */
  setEnabled(id: ConnectorId, enabled: boolean, actor: Actor): Promise<Result<void, SetConnectorEnabledError>>;
  /** The first enabled forge connector that matches (or is named) and probes ready, or undefined. */
  forForge(repo: ConnectorRepoSelection): Promise<Forge | undefined>;
  /** The tracker family's twin of forForge. */
  forTracker(repo: ConnectorRepoSelection): Promise<IssueTracker | undefined>;
}

export interface ConnectorRegistryDeps {
  readonly connectors: readonly ConnectorModule[];
  /** The set the app shipped enabled before the registry existed; it applies while the settings
   *  key is absent, so the registry's arrival changes no behaviour. */
  readonly defaultEnabled: readonly ConnectorId[];
  readonly settings: AppSettingsRepo;
  /** Builds the context of one manifest — the only capabilities the connector then receives. */
  readonly createContext: (manifest: ConnectorManifest) => ConnectorContext;
}

/** The one parse of the enabled set (the settings-key law): absent stays absent (the default set
 *  belongs to the caller, not the parse), an array of connector slugs is the set, and anything
 *  else — a non-array, a non-string or a non-slug entry — is the typed corruption, never a
 *  silent default. */
const parseEnabledConnectors = (raw: unknown): Result<readonly ConnectorId[] | undefined, 'invalid_settings'> => {
  if (raw === undefined) return ok(undefined);
  if (!Array.isArray(raw)) return err('invalid_settings');
  const ids: ConnectorId[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') return err('invalid_settings');
    const parsed = parseSlug<'connector'>(entry);
    if (!parsed.ok) return err('invalid_settings');
    ids.push(parsed.value);
  }
  return ok(ids);
};

/** Creates the registry. The readiness probe runs once per connector and the answer (or its
 *  failure) is cached for the registry's life — a probe cannot flip mid-process, exactly like
 *  the per-process probe caches of the resolvers this model replaces. */
export function createConnectorRegistry(deps: ConnectorRegistryDeps): ConnectorRegistry {
  // The probe cache: a readiness answer, or the broken-module failure of a probe that threw.
  const readiness = new Map<ConnectorId, ConnectorReadiness | 'connector_failed'>();

  const enabledIdsOf = async (): Promise<Result<readonly ConnectorId[] | undefined, 'invalid_settings'>> =>
    parseEnabledConnectors(await deps.settings.get(CONNECTORS_ENABLED_KEY));

  const probeReady = async (module: ConnectorModule, cwd: string): Promise<ConnectorReadiness | 'connector_failed'> => {
    const cached = readiness.get(module.manifest.id);
    if (cached !== undefined) return cached;
    let answer: ConnectorReadiness | 'connector_failed';
    try {
      answer = await module.probe(deps.createContext(module.manifest), cwd);
    } catch {
      answer = 'connector_failed';
    }
    readiness.set(module.manifest.id, answer);
    return answer;
  };

  const list = async (): Promise<Result<readonly ConnectorListEntry[], 'invalid_settings'>> => {
    const enabledIds = await enabledIdsOf();
    if (!enabledIds.ok) return enabledIds;
    const enabled = new Set(enabledIds.value ?? deps.defaultEnabled);
    const entries: ConnectorListEntry[] = [];
    for (const module of deps.connectors) {
      const validated = validateConnectorManifest(module.manifest);
      if (!validated.ok) {
        // A manifest that fails its law is listed invalid with the failure and never enabled.
        entries.push({ manifest: module.manifest, enabled: false, health: 'invalid', error: validated.error });
        continue;
      }
      const probed = await probeReady(module, '');
      entries.push({
        manifest: module.manifest,
        enabled: enabled.has(module.manifest.id),
        health: probed === 'connector_failed' ? 'invalid' : probed,
        ...(probed === 'connector_failed' ? { error: probed } : {}),
      });
    }
    return ok(entries);
  };

  const setEnabled = async (
    id: ConnectorId,
    value: boolean,
    actor: Actor,
  ): Promise<Result<void, SetConnectorEnabledError>> => {
    // The pinned order: the actor gate, then the store's health, then the id, then the manifest.
    if (actor.kind !== 'user') return err('user_only');
    const enabledIds = await enabledIdsOf();
    if (!enabledIds.ok) return enabledIds;
    const module = deps.connectors.find((row) => row.manifest.id === id);
    if (module === undefined) return err('not_found');
    if (!validateConnectorManifest(module.manifest).ok) return err('invalid');
    const current = new Set((enabledIds.value ?? deps.defaultEnabled).filter((one) => one !== id));
    if (value) current.add(id);
    // The written array follows the injected list's order, so the stored set is deterministic.
    const next = deps.connectors.filter((row) => current.has(row.manifest.id)).map((row) => row.manifest.id);
    await deps.settings.set(CONNECTORS_ENABLED_KEY, next);
    return ok(undefined);
  };

  /** Resolution's shared law, over either family: the explicit kind names the connector (no
   *  host is inferred then); otherwise the remote's host must match. The first enabled,
   *  manifest-valid candidate whose probe says ready wins, and its port object is wrapped in the
   *  failure boundary. */
  const resolve = async <T>(
    repo: ConnectorRepoSelection,
    family: 'forge' | 'tracker',
    build: (module: ConnectorModule) => Promise<T>,
    wrap: (built: T) => T,
  ): Promise<T | undefined> => {
    const enabledIds = await enabledIdsOf();
    // A corrupt store fails closed: resolution quietly answers undefined rather than operating
    // on a silently defaulted set — the same never-a-silent-default law as list().
    if (!enabledIds.ok) return undefined;
    const enabled = new Set(enabledIds.value ?? deps.defaultEnabled);
    for (const module of deps.connectors) {
      if (!enabled.has(module.manifest.id)) continue;
      if (!module.manifest.provides.includes(family)) continue;
      if (!validateConnectorManifest(module.manifest).ok) continue;
      const selected =
        repo.kind !== undefined ? repo.kind === module.manifest.id : matchConnectorHost(module.manifest, repo.remote ?? '');
      if (!selected) continue;
      if ((await probeReady(module, repo.path)) !== 'ready') continue;
      try {
        return wrap(await build(module));
      } catch {
        // A connector that throws while being built is indistinguishable from an absent one at
        // this seam — the use case's own typed unavailable error is what the caller then sees.
        return undefined;
      }
    }
    return undefined;
  };

  // The failure boundary on every member the registry hands out: a thrown exception becomes the
  // typed connector_failed — the connector stays identified by the port object's kind, and the
  // code carries neither a stack nor any text a secret could hide in. Members already answer
  // Results, so the guard passes a typed failure through and only replaces a throw.
  const wrapForge = (forge: Forge): Forge => {
    const guarded = async <T>(work: Promise<Result<T, ForgeError>>): Promise<Result<T, ForgeError>> => {
      try {
        return await work;
      } catch {
        return err('connector_failed');
      }
    };
    return {
      kind: forge.kind,
      capabilities: forge.capabilities,
      pushBranch: (repo, branch) => guarded(forge.pushBranch(repo, branch)),
      openPullRequest: (repo, input) => guarded(forge.openPullRequest(repo, input)),
      pullRequest: (repo, number) => guarded(forge.pullRequest(repo, number)),
      checks: (repo, ref) => guarded(forge.checks(repo, ref)),
      defaultBranch: (repo) => guarded(forge.defaultBranch(repo)),
      mergePullRequest: (repo, number) => guarded(forge.mergePullRequest(repo, number)),
    };
  };

  const wrapTracker = (tracker: IssueTracker): IssueTracker => {
    const guarded = async <T>(work: Promise<Result<T, TrackerError>>): Promise<Result<T, TrackerError>> => {
      try {
        return await work;
      } catch {
        return err('connector_failed');
      }
    };
    const { createIssue, updateIssue } = tracker;
    return {
      kind: tracker.kind,
      search: (query, limit) => guarded(tracker.search(query, limit)),
      get: (key) => guarded(tracker.get(key)),
      comment: (key, text) => guarded(tracker.comment(key, text)),
      transition: (key, status) => guarded(tracker.transition(key, status)),
      probePermissions: (scope) => guarded(tracker.probePermissions(scope)),
      listMilestones: (scope, cursor) => guarded(tracker.listMilestones(scope, cursor)),
      listIssues: (scope, opts) => guarded(tracker.listIssues(scope, opts)),
      ...(createIssue === undefined ? {} : { createIssue: (scope: string, item: unknown) => guarded(createIssue(scope, item)) }),
      ...(updateIssue === undefined
        ? {}
        : { updateIssue: (scope: string, key: string, patch: unknown) => guarded(updateIssue(scope, key, patch)) }),
    };
  };

  return {
    list,
    setEnabled,
    forForge: (repo) =>
      resolve(
        repo,
        'forge',
        (module) =>
          module.createForge === undefined
            ? Promise.reject(new Error('provides forge but has no factory'))
            : module.createForge(repo.path, deps.createContext(module.manifest)),
        wrapForge,
      ),
    forTracker: (repo) =>
      resolve(
        repo,
        'tracker',
        (module) =>
          module.createTracker === undefined
            ? Promise.reject(new Error('provides tracker but has no factory'))
            : Promise.resolve(module.createTracker(repo.path, deps.createContext(module.manifest))),
        wrapTracker,
      ),
  };
}
