// Route-kind lookups over the capability registry. The registry data is infrastructure, so the
// application sees only two questions: which route kind an account rides, and what that route kind
// fixes. Contract: docs/v2/application.md (A-43, A-44); data: src/infrastructure/providers/registry/.
import type { AuthMode, Billing, ChannelRow, Tier, TranslationRow, VersionRow } from '../../domain/index';

export interface CapabilityCatalog {
  /** The account's route kind: the explicit `routeKind`, else the provider's default for its authMode. */
  routeKindOf(account: { readonly provider: string; readonly authMode: AuthMode; readonly routeKind?: string }): string | undefined;
  /** The route kind's fixed surface; `undefined` when the registry knows no such kind. */
  routeKind(id: string): {
    readonly id: string;
    /** The provider the kind belongs to; adopting a discovered candidate needs it to name the account's provider. */
    readonly providerId: string;
    readonly authMode: AuthMode;
    readonly endpointHost?: string;
    /** The billing of the CLI's own default model on this kind, when the kind fixes one (P-40). */
    readonly defaultBilling?: Billing;
    /** How the kind's quota is read (P-49): `none` and `rate_limit_events` (pushed by runs) have no poll. */
    readonly quotaProbe?: 'sdk_usage' | 'rate_limit_events' | 'http_monitor' | 'provider_query' | 'none';
    /** The model the kind fixes for each tier; an account's own table wins over it. */
    readonly tierModels?: Readonly<Record<Tier, string>>;
  } | undefined;
  /** Whether the provider's CLI can attach an MCP server (its capability record's `mcp`);
   *  `'unknown'` for a provider the registry does not describe. */
  mcpSupport(providerId: string): boolean | 'unknown';
  /** Whether the provider's transport takes a steering note mid-run (P-61); `'unknown'` for a
   *  provider the registry does not describe. */
  steeringSupport(providerId: string): boolean | 'unknown';
  /** The capability translation and support table (P-57, P-58): data the translator reads. */
  translationTable(): readonly TranslationRow[];
  /** The provider permission-channel table (P-66): data the setup warning's second source reads. */
  permissionChannels(): readonly ChannelRow[];
  /** The provider version table (P-68): the registry's measured-on versions, the installed side
   *  joined where discovery answers are known; an absent side reads `unknown` and never warns. */
  providerVersions(): readonly VersionRow[];
  /** The instruction-file names one provider reads natively, registry order (P-37). */
  nativeInstructionFiles(providerId: string): readonly string[];
  /** The union of known instruction-file names across providers — the candidate list to look for. */
  instructionFileNames(): readonly string[];
}
