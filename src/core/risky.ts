// src/core/risky.ts — the "Riskli hariç" classifier (WO-0031c, operator decisions). Pure.
//
// The per-work-order permission rule `risky_excluded` auto-approves in-scope asks EXCEPT the risky
// set; `isRiskyPermission` is that set. It consumes the same {tool, input} shape the fence and the
// permission_request events carry. The set (operator-locked):
//   file writes → CI (.github/**), lockfiles, agent configuration (CLAUDE.md basename, .claude/**),
//                 sensitive files (.env* / *.pem / *key* / credentials* / secrets* — operator addition)
//   shell       → git push / git remote changes, dependency installation (arbitrary code into the
//                 tree), rm
// Reads are never risky — the fence already allows them. Over-asking is preferred to under-asking:
// an `echo` that mentions "npm install" classifies risky (see the test) and that is accepted.
const RISKY_PATH_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const LOCKFILE_BASENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'cargo.lock',
  'poetry.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
]);

/** Basename patterns for key/certificate/secret material — matched case-insensitively (WO-0031d: all of them). */
const SENSITIVE_BASENAME = [/^\.env(\..+)?$/i, /\.pem$/i, /key$/i, /^credentials/i, /^secrets/i];

/** Shell substrings that make a command risky regardless of position (over-ask by design;
 *  case-blind — a shouted NPM INSTALL is the same risk as a lowercase one, WO-0031d). */
const RISKY_COMMAND_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/i,
  /\bgh\s+pr\s+(create|merge)\b/i, // ADR-0017: the forge's world-writes sit beside push — witnessed
  /\bgit\s+remote\s+(set-url|add|remove|rename)\b/i,
  /\b(npm|pnpm|yarn|bun)\s+(i|install|add)\b/i,
  /\bcargo\s+add\b/i,
  /\bpip\d*\s+install\b/i,
  /\bpoetry\s+add\b/i,
  /\bcomposer\s+require\b/i,
  /\bgo\s+get\b/i,
  /\bbundle\s+(install|add)\b/i,
  /(^|[\s;&|])rm\s/i,
];

function normalizeSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function basename(path: string): string {
  const segs = normalizeSegments(path);
  return segs.length > 0 ? segs[segs.length - 1]! : '';
}

function isRiskyFilePath(path: string): boolean {
  const segs = normalizeSegments(path);
  if (segs.some((s) => s === '.github')) return true; // CI workflows/actions, anywhere in the tree
  if (segs.some((s) => s === '.claude')) return true; // agent config: prompts, hooks, skills
  const base = basename(path);
  if (!base) return false;
  if (LOCKFILE_BASENAMES.has(base.toLowerCase())) return true;
  if (base.toLowerCase() === 'claude.md') return true; // agent config as a repo root/dir file
  return SENSITIVE_BASENAME.some((re) => re.test(base));
}

/** Is this surfaced ask in the risky set? Reads never are; unknown tools default to NOT risky
 *  (the fence still governs scope; this only refines the auto-approve cadence). */
export function isRiskyPermission(tool: string, input: Record<string, unknown>): boolean {
  if (RISKY_PATH_TOOLS.has(tool)) {
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : '';
    return path !== '' && isRiskyFilePath(path);
  }
  if (tool === 'Bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    return command !== '' && RISKY_COMMAND_PATTERNS.some((re) => re.test(command));
  }
  return false;
}
