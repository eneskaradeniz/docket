// Credential import for an adopted endpoint account: re-reads the config directory's settings file
// and hands back the endpoint token string, nothing else. The caller moves it straight into the
// vault; this module never logs, stores or wraps it, and a failure carries no file content.
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { CredentialImporter } from '../../../application/index';
import { createNodeAccountScanFs, MAX_READ_BYTES, SETTINGS_FILE, TOKEN_KEY_ORDER, type AccountScanFs } from './account-scan';

export interface CredentialImporterOptions {
  readonly fs: AccountScanFs;
  /** Only directories directly under this one are read; a path elsewhere answers `undefined`. */
  readonly homeDir: string;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const underHome = (homeDir: string, sourcePath: string): boolean => {
  const prefix = join(homeDir, '/');
  const rest = sourcePath.startsWith(prefix) ? sourcePath.slice(prefix.length) : undefined;
  return rest !== undefined && rest !== '' && !rest.includes('/') && !rest.includes('\\') && rest !== '..';
};

export function createCredentialImporter(options: CredentialImporterOptions): CredentialImporter {
  return {
    async readEndpointToken(sourcePath) {
      // The path comes from a fresh scan, but the importer is the one reading a credential file,
      // so it refuses anything that is not a direct child of the home directory on its own.
      if (!underHome(options.homeDir, sourcePath)) return undefined;
      let text: string | undefined;
      try {
        text = await options.fs.readText(join(sourcePath, SETTINGS_FILE), MAX_READ_BYTES);
      } catch {
        return undefined;
      }
      if (text === undefined) return undefined;
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return undefined;
      }
      if (!isRecord(parsed) || !isRecord(parsed.env)) return undefined;
      for (const key of TOKEN_KEY_ORDER) {
        const value = parsed.env[key];
        if (typeof value === 'string' && value !== '') return value;
      }
      return undefined;
    },
  };
}

export function createNodeCredentialImporter(): CredentialImporter {
  return createCredentialImporter({ fs: createNodeAccountScanFs(), homeDir: homedir() });
}
