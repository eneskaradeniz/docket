// Account discovery port — proposes accounts found in the user's local config directories.
// A candidate never carries a value other than the endpoint host; adopting one is a separate,
// explicit step.
export interface AccountCandidate {
  /** Absolute path of the config directory; for `machine_login` an opaque key (`machine-login:<defId>`), not a path. */
  readonly sourcePath: string;
  readonly displayPath: string; // the same path shortened for display; for `machine_login` a documented home hint or the provider's name
  readonly kind: 'subscription' | 'compatible_endpoint' | 'machine_login';
  readonly provider: string; // the def id the candidate belongs to
  readonly routeKind: string; // route kind id from the capability registry
  readonly endpointHost?: string;
  readonly hasOauthLogin: boolean;
  readonly envOverrides: readonly ('endpoint' | 'token' | 'model')[];
  readonly warnings: readonly ('env_overrides_login' | 'unreadable')[];
  readonly alreadyAdded: boolean;
}

export interface AccountDiscovery {
  scan(): Promise<readonly AccountCandidate[]>;
}
