// src/core/app-settings.ts — the operator-preferences PORT (WO-0025 / B1).
//
// Operator preferences live in the shared DB so BOTH hosts see them (the Electron GUI and
// the CLI open the same docket.db); theme stays renderer-local localStorage because it is presentation only.
// ADR-0010's observed|owned split gains a third, tiny category here: an operator preference is neither a
// git-observed fact nor a decision about work — it is machine-local app configuration.
// WO-0059 rev 4: the stored provider API key RETIRED (port methods, spawn-env injection, the stored
// row) — the CLI's own login + the operator's setup are the identity; only checkProvider survived.
import type { ProviderErrorCode } from './runner';
import type { PermissionRule } from './source';
import type { SessionRole, WorkspaceId } from './types';
import type { BudgetThreshold } from './budget';

/** Vendor-neutral provider readiness: the happy path names the auth SOURCE (e.g. 'oauth', 'env'); the
 *  failure path carries the classification + the raw message (shown only as a fallback). */
export type ProviderStatus =
  | { ok: true; source: string }
  | { ok: false; code: ProviderErrorCode; message: string };

/** The per-role model preference (WO-0059 rev 2, the operator's correction): the PLAN rides the
 *  best model while implementation rides a simpler one — the axis is the SESSION ROLE, not one
 *  global value. A role absent from the map = the provider's own default for it. Ids are DATA,
 *  carried verbatim; core never validates or names a value (ADR-0006's WO-0052 carve-out). */
export type RoleModels = Partial<Record<SessionRole, string>>;

/** The UI locale (WO-0035 / ADR-0007): a pure union carrying no display strings — the words live in the
 *  per-locale bundles in src/ui/data/labels/, keyed by this type. */
export type Locale = 'tr' | 'en';

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
  /** The per-role model preference (WO-0059 rev 2): one map, three roles; an absent role = the
   *  provider's own default. undefined = nothing stored. The composition root reads it at SPAWN
   *  time and picks the drive's role row, so a change hits the next drive, never a running one. */
  getModels(): Promise<RoleModels | undefined>;
  /** Store (or clear, on undefined/empty) the per-role preference. The ids ride verbatim; the
   *  store normalizes shape (unknown role keys and blanks dropped), never values. */
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
   *  place). [] → the UI's preset chips render ABSENT (ADR-0001); the free-text field is
   *  unaffected. */
  modelOptions(): Promise<string[]>;
  /** The provider's DISPLAY NAME for the status line (WO-0059 rev 4) — provider vocabulary minted
   *  adapter-side, crossing as DATA (the modelOptions posture); the UI renders it verbatim. */
  providerName(): Promise<string>;
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
   *  state; the UI speaks it as one line (the name is adapter DATA — providerName). */
  checkProvider(): Promise<ProviderStatus>;
}
