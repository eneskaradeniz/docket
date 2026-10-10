// In-memory RepoFileReader — files keyed by repo and path, with the port's own rules (secret names
// and escapes refused, binary and oversize files answered as the real reader does).
import { err, ok, type RepoSlug } from '../../../domain/index';

import { isSecretRepoPath, type RepoFileReader } from '../repo-file-reader';

const MAX_FILE_BYTES = 256 * 1024;

export interface FakeRepoFileReader extends RepoFileReader {
  /** Puts a file in a repo, registering the repo as a side effect. */
  put(repo: RepoSlug, path: string, content: string | Uint8Array): void;
  /** Every read call in order, for tests asserting that nothing was read. */
  calls(): readonly { readonly repo: string; readonly path: string }[];
}

export const createFakeRepoFileReader = (options: { readonly redact?: (text: string) => string } = {}): FakeRepoFileReader => {
  const repos = new Set<string>();
  const files = new Map<string, string | Uint8Array>();
  const seen: { readonly repo: string; readonly path: string }[] = [];
  const redact = options.redact ?? ((text: string): string => text);
  const encoder = new TextEncoder();

  return {
    put: (repo, path, content) => {
      repos.add(repo);
      files.set(`${repo}:${path}`, content);
    },
    calls: () => [...seen],
    read: async (repo, path, read) => {
      seen.push({ repo, path });
      if (!repos.has(repo)) return err('repo_unknown');
      if (path.split('/').includes('..') || path.startsWith('/') || isSecretRepoPath(path)) return err('outside_repo');
      const content = files.get(`${repo}:${path}`);
      if (content === undefined) return err('not_found');
      const bytes = typeof content === 'string' ? encoder.encode(content) : content;
      if (bytes.length > MAX_FILE_BYTES) return err('too_large');
      if (bytes.includes(0)) return err('not_text');
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        return err('not_text');
      }
      const body = text.endsWith('\n') ? text.slice(0, -1) : text;
      const all = body === '' ? [] : redact(body).split('\n');
      const start = Math.max(1, read.from) - 1;
      const lines: string[] = [];
      let used = 0;
      for (let i = start; i < all.length && lines.length < read.maxLines; i += 1) {
        const line = all[i] ?? '';
        used += encoder.encode(line).length + 1;
        if (used > read.maxBytes && lines.length > 0) break;
        lines.push(line);
      }
      const end = start + lines.length;
      return end < all.length ? ok({ lines, truncated: true, nextFrom: end + 1 }) : ok({ lines, truncated: false });
    },
  };
};
