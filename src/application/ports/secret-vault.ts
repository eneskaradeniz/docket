// Secret port — values never leave this port except to a transport's environment.
export interface SecretVault {
  put(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  remove(ref: string): Promise<void>;
}
