// setup-permissions.ts — read scope and secret rules for Docket AI project setup (A-334 … A-336).
import { redactSecretShapes } from '../../domain/index';

export type ReadScope = { readonly paths: readonly string[]; readonly sessionOnly: true };

export type ReadDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'ask'; readonly path: string }
  | { readonly kind: 'deny'; readonly reason: 'secret_shaped' | 'outside_scope_denied' | 'not_readable' };

export type ReadContext = { readonly repoFolder: string; readonly docketHome: string };

/** Session-only path grants for setup reads (A-335): memory only, one path each, read-only. */
export class SetupReadGrants {
  private readonly granted = new Set<string>();

  /** Records exactly this path — never a prefix wider than asked. */
  grant(path: string): void {
    this.granted.add(normalizeAbsolutePath(path));
  }

  clear(): void {
    this.granted.clear();
  }

  allows(requested: string): boolean {
    const normalized = normalizeAbsolutePath(requested);
    for (const grant of this.granted) {
      if (normalized === grant || isPathInside(normalized, grant)) return true;
    }
    return false;
  }

  /** For tests: the exact granted paths. */
  list(): readonly string[] {
    return [...this.granted];
  }
}

const SEP = '/';

/** Collapses `.` / `..` on absolute or relative paths without importing Node path. */
export const normalizeAbsolutePath = (path: string): string => {
  const rooted = path.startsWith(SEP) || /^[A-Za-z]:[/\\]/.test(path);
  const drive = /^([A-Za-z]:)[/\\]?/.exec(path)?.[1];
  const tail = drive === undefined ? path : path.slice(drive.length).replace(/^[/\\]/, '');
  const parts = tail.split(/[/\\]+/).filter((segment) => segment !== '' && segment !== '.');
  const out: string[] = [];
  for (const segment of parts) {
    if (segment === '..') {
      if (out.length > 0) out.pop();
      else if (!rooted) out.push('..');
    } else out.push(segment);
  }
  const joined = out.join(SEP);
  if (drive !== undefined) return `${drive}${SEP}${joined}`;
  return rooted ? `${SEP}${joined}` : joined;
};

export const isPathInside = (child: string, parent: string): boolean => {
  const c = normalizeAbsolutePath(child);
  const p = normalizeAbsolutePath(parent);
  return c === p || c.startsWith(`${p}${SEP}`);
};

const expandHome = (path: string, home: string): string => {
  if (path === '~') return normalizeAbsolutePath(home);
  if (path.startsWith('~/') || path.startsWith('~\\')) return normalizeAbsolutePath(`${home}${path.slice(1)}`);
  return normalizeAbsolutePath(path);
};

const fileNameOf = (path: string): string => {
  const normalized = normalizeAbsolutePath(path);
  const parts = normalized.split(SEP);
  return parts[parts.length - 1] ?? '';
};

/** A-336: secret-shaped paths are denied even inside scope or after a grant. */
export const isSecretShapedPath = (requested: string, ctx: ReadContext): boolean => {
  const path = expandHome(requested, ctx.docketHome);
  const name = fileNameOf(path).toLowerCase();
  const home = normalizeAbsolutePath(ctx.docketHome);
  const docketDb = `${home}${SEP}docket.db`;

  if (path === docketDb || isPathInside(path, docketDb)) return true;
  if (isPathInside(path, `${home}${SEP}.ssh`) || isPathInside(path, `${home}${SEP}.aws`) || isPathInside(path, `${home}${SEP}.gnupg`)) {
    return true;
  }
  if (isPathInside(path, `${home}${SEP}Library${SEP}Keychains`)) return true;

  if (name === '.env' || name.startsWith('.env.')) return true;
  if (name.endsWith('.pem') || name.endsWith('.key') || name.endsWith('.p12') || name.endsWith('.keystore')) return true;
  if (name.startsWith('id_rsa') || name.startsWith('id_ed25519')) return true;
  if (name.startsWith('credentials')) return true;
  return false;
};

export const redactSetupContent = (text: string): string => redactSecretShapes(text);

export function decideRead(
  scope: ReadScope,
  requested: string,
  ctx: ReadContext,
  grants: SetupReadGrants,
  resolvedPath?: string,
): ReadDecision {
  const path = resolvedPath ?? expandHome(requested, ctx.docketHome);
  if (isSecretShapedPath(path, ctx)) return { kind: 'deny', reason: 'secret_shaped' };

  const roots = scope.paths.map((entry) => expandHome(entry, ctx.docketHome));
  const inDefault = roots.some((root) => isPathInside(path, root));
  if (inDefault || grants.allows(path)) return { kind: 'allow' };

  return { kind: 'ask', path: normalizeAbsolutePath(path) };
}
