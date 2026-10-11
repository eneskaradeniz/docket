// R-119: counts added and removed lines per file in a unified patch. Line text is never part of the
// result, so a secret that arrived inside a hunk cannot leave through this function.

export interface DiffFileStat {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
}

interface OpenFile {
  path: string;
  added: number;
  removed: number;
  binary: boolean;
}

/** A quoted diff path, with the usual backslash escapes undone. `next` is the index after the close. */
const readQuoted = (text: string, at: number): { readonly raw: string; readonly next: number } | undefined => {
  if (text[at] !== '"') return undefined;
  let raw = '';
  let i = at + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\' && i + 1 < text.length) {
      const escaped = text[i + 1];
      raw += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
      i += 2;
      continue;
    }
    if (ch === '"') return { raw, next: i + 1 };
    raw += ch ?? '';
    i += 1;
  }
  return undefined;
};

/** Drops the `a/` or `b/` prefix git puts on header paths. `/dev/null` has neither. */
const stripSide = (path: string): string => (path.startsWith('a/') || path.startsWith('b/') ? path.slice(2) : path);

const headerPaths = (line: string): { readonly a: string; readonly b: string } | undefined => {
  const prefix = 'diff --git ';
  if (!line.startsWith(prefix)) return undefined;
  const rest = line.slice(prefix.length);
  if (rest.startsWith('"')) {
    const a = readQuoted(rest, 0);
    if (a === undefined) return undefined;
    const b = readQuoted(rest, a.next + (rest[a.next] === ' ' ? 1 : 0));
    if (b === undefined) return undefined;
    return { a: stripSide(a.raw), b: stripSide(b.raw) };
  }
  if (!rest.startsWith('a/')) return undefined;
  // Unquoted paths contain no spaces, so the first ` b/` is the side separator, not part of a path.
  const sep = rest.indexOf(' b/');
  if (sep < 0) return undefined;
  return { a: rest.slice(2, sep), b: rest.slice(sep + ' b/'.length) };
};

const labelledPath = (line: string, label: string): string | undefined => {
  if (!line.startsWith(label)) return undefined;
  const rest = line.slice(label.length);
  if (!rest.startsWith('"')) return rest;
  return readQuoted(rest, 0)?.raw;
};

export function diffStatOf(patch: string): readonly DiffFileStat[] {
  const files: DiffFileStat[] = [];
  let current: OpenFile | undefined;
  // `+++` / `---` before the first hunk are headers. After `@@` the same characters are content
  // (the hunk prefix plus a line that itself began with `++` or `--`).
  let inHunk = false;

  const finish = (): void => {
    if (current === undefined) return;
    files.push({ path: current.path, added: current.added, removed: current.removed, binary: current.binary });
    current = undefined;
    inHunk = false;
  };

  for (const raw of patch.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const header = headerPaths(line);
    if (header !== undefined) {
      finish();
      current = { path: header.b === '/dev/null' ? header.a : header.b, added: 0, removed: 0, binary: false };
      continue;
    }
    if (current === undefined) continue;

    const renamed = labelledPath(line, 'rename to ');
    if (renamed !== undefined) {
      current.path = renamed;
      continue;
    }
    // A binary body is full of lines that look like additions. They are not source lines.
    if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true;
      current.added = 0;
      current.removed = 0;
      continue;
    }
    if (current.binary) continue;
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;
    if (line.startsWith('+')) current.added += 1;
    else if (line.startsWith('-')) current.removed += 1;
  }
  finish();
  return files;
}
