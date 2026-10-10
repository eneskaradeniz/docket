// Read-only access to the text files of a REGISTERED repo's main checkout, for the assistant's
// `docket_read_file` tool. The repo is named by slug (never by a path), the path is repo-relative,
// and an implementation answers lines only: the slice asked for, already redacted.
import type { RepoSlug, Result } from '../../domain/index';

export interface RepoFileReadOptions {
  /** 1-based line to start at. */
  readonly from: number;
  readonly maxLines: number;
  readonly maxBytes: number;
}

export interface RepoFileSlice {
  readonly lines: readonly string[];
  /** More lines follow the returned ones. */
  readonly truncated: boolean;
  /** The 1-based line to ask for next; present exactly when `truncated`. */
  readonly nextFrom?: number;
}

export type RepoFileError = 'not_found' | 'outside_repo' | 'too_large' | 'not_text' | 'repo_unknown';

export interface RepoFileReader {
  read(repo: RepoSlug, path: string, options: RepoFileReadOptions): Promise<Result<RepoFileSlice, RepoFileError>>;
}

/** The names that carry secrets: refused before any read, whatever the repo or the scope. Checked
 *  case-insensitively on every segment, so `.GIT/config` and `Credentials.JSON` are caught too. */
export const isSecretRepoPath = (path: string): boolean => {
  const segments = path.split(/[/\\]/).map((segment) => segment.toLowerCase());
  if (segments.includes('.git')) return true;
  const name = segments[segments.length - 1] ?? '';
  return (
    name === '.env' ||
    name.startsWith('.env.') ||
    name.endsWith('.pem') ||
    name.endsWith('.key') ||
    name.endsWith('.p12') ||
    name.startsWith('id_rsa') ||
    name.startsWith('id_ed25519') ||
    name.endsWith('.keystore') ||
    name.startsWith('credentials') ||
    name === '.npmrc' ||
    name === '.netrc'
  );
};
