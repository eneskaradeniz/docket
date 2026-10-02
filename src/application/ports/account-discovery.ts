// Account discovery port — proposes accounts found in the user's local config directories.
// A candidate never carries a value other than the endpoint host; adopting one is a separate,
// explicit step.
export interface AccountCandidate {
  readonly sourcePath: string; // absolute path of the config directory
  readonly displayPath: string; // the same path shortened for display
  readonly kind: 'subscription' | 'compatible_endpoint';
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
