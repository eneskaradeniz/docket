// Provider discovery port — what the composition root runs once to find the installed agent CLIs.
export interface DiscoveredProvider {
  readonly defId: string;
  readonly binPath: string | null; // null = not found on this machine
  readonly version: string | null; // null = probe failed or not defined
  readonly loggedIn: boolean | null; // null = no auth probe defined
  readonly optionalFlags: readonly string[]; // only the ones the help output lists
}

export interface ProviderDiscovery {
  discover(onResult: (r: DiscoveredProvider) => void): Promise<void>;
}
