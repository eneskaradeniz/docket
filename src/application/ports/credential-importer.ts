// Credential importer port — the one place a discovered account's token may be read back, and only
// for an import the user consented to. The value flows into the SecretVault and nowhere else.
export interface CredentialImporter {
  /** The endpoint token of the config directory, or `undefined` when it holds none or cannot be read. */
  readEndpointToken(sourcePath: string): Promise<string | undefined>;
}
