// src/core/app-settings.ts — the operator-preferences PORT (WO-0025 / B1).
//
// Operator preferences live in the shared DB so BOTH hosts see them (the Electron GUI and
// the CLI opened the same docket.db); WO-0102 moves THEME into the row store too (ADR-0020 #7)
// so the remote settings surface can read+write it — the desktop renderer keeps its localStorage
// behavior this WO (TD-065), and the remote boot switch (remote:enabled / remote:port) rows join
// the same table.
// ADR-0010's observed|owned split gains a third, tiny category here: an operator preference is neither a
// git-observed fact nor a decision about work — it is machine-local app configuration.
// WO-0059 rev 4: the stored provider API key RETIRED (port methods, spawn-env injection, the stored
// row) — the CLI's own login + the operator's setup are the identity; only checkProvider survived.
import type { ProviderErrorCode } from './runner';
import type { PermissionRule } from './source';
import type { SessionRole, WorkspaceId } from './types';
import type { BudgetThreshold } from './budget';
import type { BackendProfile } from './backend-profile';
import type { RoleRoute } from './driver-route';

/** Vendor-neutral provider readiness: the happy path names the auth SOURCE (e.g. 'oauth', 'env'); the
 *  failure path carries the classification + the raw message (shown only as a fallback). */
export type ProviderStatus =
  | { ok: true; source: string }
  | { ok: false; code: ProviderErrorCode; message: string };

/** The per-role DRIVER ROUTE map (WO-0059 rev 2, widened by WO-0104 / Faz A): the PLAN rides the
 *  best model while implementation rides a simpler one — the axis is the SESSION ROLE, not one
 *  global value — and each role may now name its vendor adapter and backend profile beside the
 *  model. A role absent from the map = the provider's own defaults for it. Every value is DATA,
 *  carried verbatim; core never validates or names a vendor or model (ADR-0006's WO-0052
 *  carve-out). A legacy stored string row (the pre-WO-0104 shape) reads as `{model}` — the
 *  store normalizes shape, never values. */
export type RoleModels = Partial<Record<SessionRole, RoleRoute>>;

/** The UI locale (WO-0035 / ADR-0007): a pure union carrying no display strings — the words live in the
 *  per-locale bundles in src/ui/data/labels/, keyed by this type. */
export type Locale = 'tr' | 'en';

/** WO-0102 (ADR-0020 #7): the theme choice joins locale in app_setting so the remote settings
 *  surface can read+write it. "Sistem" follows each device's own OS at render time regardless of
 *  where the row lives. The port methods land with the device-store commit; the desktop renderer
 *  keeps its localStorage behavior this WO (TD-065). */
export type Theme = 'system' | 'light' | 'dark';

/** WO-0070: the FIVE prompt templates an operator may override wholesale. Four are the role
 *  templates assembled in core (order-md.ts: architect / implementer / verifier / architectReview),
 *  the fifth is the ✦ draft drive's (roadmap-draft.ts). The key names the TEMPLATE, not the text —
 *  the built-in bodies stay core constants (prompt texts are data, not UI copy). */
export type PromptKey = 'architect' | 'implementer' | 'verifier' | 'architectReview' | 'roadmapDraft';

/** WO-0070: the WHOLE-TEXT override map — the operator edits the full text of one named prompt, never
 *  micro-edits into the built-in. A key absent from the map = the built-in stands. An override reaching
 *  an agent goes through the store's assembly fns ONLY (the WO-0070 stop-and-ask gate); core never
 *  validates the content (the operator's text is the operator's text). */
export type PromptOverrides = Partial<Record<PromptKey, string>>;

export interface AppSettings {
  /** The DEFAULT permission rule (WO-0031c): Settings holds only the default — each work order carries
   *  its own rule (order.md front-matter; changeable from the ask card). 'ask'/'auto' legacy values map
   *  to ask_every/risky_excluded at the store. The fence keeps denying out-of-scope writes under every
   *  rule; scope is the boundary, the rule is cadence. */
  getPermissionRule(): Promise<PermissionRule>;
  setPermissionRule(rule: PermissionRule): Promise<void>;
  /** The operator's EXPLICIT UI-locale choice, if any (WO-0035). undefined = no choice made: the
   *  renderer falls back to system-language detection (operator ruling 2026-08-21). Detection is
   *  presentation, so only a deliberate choice is persisted (ADR-0007: a property of the operator,
   *  never of the project — this row, not workspace.yaml). */
  getLocale(): Promise<Locale | undefined>;
  setLocale(locale: Locale): Promise<void>;
  /** WO-0102 (ADR-0020 #7): the theme choice joins locale in the shared row store so the remote
   *  settings surface can read+write it. undefined = nothing stored ('system' is the effective
   *  face). "Sistem" follows each device's own OS at render time regardless of where the row
   *  lives. The desktop renderer KEEPS its localStorage behavior this WO (TD-065) — adoption is
   *  a named debt entry, never smuggled work. */
  getTheme(): Promise<Theme | undefined>;
  setTheme(theme: Theme): Promise<void>;
  /** WO-0102: the remote server's kill-switch (`remote:enabled`, an app_setting row) — default
   *  TRUE (ADR-0020 #2's "the desktop app is open" IS the deployment assumption). The UI that
   *  writes it is WO-0103's; the read gates the boot wiring in the composition root. */
  getRemoteEnabled(): Promise<boolean>;
  setRemoteEnabled(enabled: boolean): Promise<void>;
  /** WO-0102: the listen-port override (`remote:port`). READ-ONLY this WO (architect amendment
   *  3b): the row is the operator's escape hatch — a setter lands with the UI that needs it
   *  (none exists; a ruled silence beats an undecided one). undefined = the fixed default. */
  getRemotePort(): Promise<number | undefined>;
  /** The per-role driver route map (WO-0059 rev 2, widened WO-0104): one map, three roles; an
   *  absent role = the provider's own defaults. undefined = nothing stored. The composition
   *  root reads the MODEL half at spawn time and the pipeline resolves the vendor/profile
   *  halves through the chain — a change hits the next drive, never a running one. */
  getModels(): Promise<RoleModels | undefined>;
  /** Store (or clear, on undefined/empty) the per-role route map. The ids ride verbatim; the
   *  store normalizes shape (unknown role keys, blanks and legacy string entries normalized),
   *  never values. */
  setModels(models: RoleModels | undefined): Promise<void>;
  /** The whole-text prompt-template overrides (WO-0070): one map over the five PromptKeys, an absent
   *  key = the built-in stands. undefined = nothing stored. Read at PROMPT-ASSEMBLY time in the
   *  store's assembly fns, so a change hits the next drive, never a running one (the models posture). */
  getPromptOverrides(): Promise<PromptOverrides | undefined>;
  /** Store (or clear) the override map. undefined CLEARS ALL (the budget-threshold idiom); a
   *  per-key clear sends the object minus that key. The store normalizes shape (unknown keys and
   *  whitespace-only values dropped), never content. */
  setPromptOverrides(overrides: PromptOverrides | undefined): Promise<void>;
  /** The preset model ids the ADAPTER offers (the checkProvider pattern — provider vocabulary is
   *  minted adapter-side and crosses as DATA; ADR-0006 names the provider adapter as the one
   *  place). WO-0104: `vendor` scopes the question to one wired adapter; absent = the built-in.
   *  An unknown vendor id answers [] (honestly absent) — never the built-in's tiers wearing
   *  another vendor's name. [] → the UI's preset chips render ABSENT (ADR-0001). */
  modelOptions(vendor?: string): Promise<string[]>;
  /** The provider's DISPLAY NAME for the status line (WO-0059 rev 4) — provider vocabulary minted
   *  adapter-side, crossing as DATA (the modelOptions posture); the UI renders it verbatim.
   *  WO-0104: `vendor` scopes it the same way; an unknown id answers '' (rendered absent). */
  providerName(vendor?: string): Promise<string>;
  /** The workspace's month-spend threshold (WO-0047): cap + warn percent, ONE atomic pair per
   *  workspace (solo scale — no per-agent or per-project scoping). undefined = none configured:
   *  the gate fails open and the surfaces show nothing. */
  getBudget(workspaceId: WorkspaceId): Promise<BudgetThreshold | undefined>;
  /** Store (or clear, on undefined) the threshold. A PERMANENT write (operator ruling 2026-08-26:
   *  raising the cap is a settings action that re-runs the refused drive — no one-month override
   *  machinery). */
  setBudget(workspaceId: WorkspaceId, threshold: BudgetThreshold | undefined): Promise<void>;
  /** The workspace's structure root (WO-0048, ADR-0016): where roadmap.md and work-orders/ live
   *  inside the decision store. Returns the EFFECTIVE root — the `docs/` default when unset or
   *  corrupt (the budget row's fail-open read) — so callers never repeat the default. Switching
   *  never moves files and never writes .gitignore; both stay the operator's acts. */
  getDocsRoot(workspaceId: WorkspaceId): Promise<string>;
  /** Set (or clear, on undefined) the structure root. THROWS on an invalid root (an operator-
   *  initiated write refuses loudly, unlike the fail-open read). `.docket` is the named
   *  alternative for keeping the documents out of the tree. */
  setDocsRoot(workspaceId: WorkspaceId, root: string | undefined): Promise<void>;
  /** Full provider check (WO-0059 rev 4 — the Sağlayıcı section died, the check stayed): runs the
   *  spawn-free provider handshake (no prompt — zero tokens) against the OPERATOR'S OWN identity
   *  (the CLI's login / the environment — no stored key exists to inject anymore). Reports auth
   *  state; the UI speaks it as one line (the name is adapter DATA — providerName).
   *  WO-0098: `profileName` runs the SAME zero-token handshake under that profile's environment
   *  (the per-profile Test et); absent or `default` = the built-in passthrough. An unknown name
   *  resolves `{ ok: false }` naming it — never a silent check of another environment. */
  checkProvider(profileName?: string): Promise<ProviderStatus>;
  /** WO-0098 — the configured backend profiles, in the operator's order (the built-in passthrough
   *  is NOT in the list: it always exists, first, never stored). Read FAIL-OPEN through core's
   *  normalizeProfiles — a corrupt or secret-carrying entry never comes back. */
  getBackendProfiles(): Promise<BackendProfile[]>;
  /** Replace the whole list (the prompt-overrides write shape; [] clears the row). THROWS when
   *  core's validateProfiles names any issue — a secret-looking key or value never lands (the
   *  operator write refuses loudly; the form places each issue under its field first). */
  setBackendProfiles(profiles: BackendProfile[]): Promise<void>;
  /** WO-0104: the workspace's DEFAULT driver route (`driver:<wsId>`) — the vendor + profile a
   *  drive of this workspace falls to when neither the work order nor the per-role route names
   *  one. undefined = nothing stored (the built-in adapter). A draft rides it; a work order's
   *  order.md `vendor:`/`profile:` win over it. A legacy pre-WO-0104 `profile:<wsId>` raw row
   *  reads as the route's profile half. */
  getWorkspaceDriver(workspaceId: WorkspaceId): Promise<{ vendor?: string; profile?: string } | undefined>;
  /** Set (or clear, on undefined) the workspace default route. THROWS on a profile name no
   *  configured profile carries (`default`, the built-in's key, is always legal); a VENDOR id
   *  is data — the pipeline's wired-set gate refuses a dangling one at spawn time (the store
   *  cannot know what is wired). */
  setWorkspaceDriver(workspaceId: WorkspaceId, route: { vendor?: string; profile?: string } | undefined): Promise<void>;
}
