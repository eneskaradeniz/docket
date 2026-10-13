// The "every spawn is registered" check (I-103): no production file under src/ or electron/ may
// start a child process on its own — node:child_process is imported (for values) only by
// system/process-registry.ts, and no raw spawn/execFile/exec/fork call survives outside it, the
// test fixtures and the tests themselves. A new spawn site goes through `registeredSpawn` /
// `registeredExecFile`, which is what makes the managed quit and the orphan reaper complete.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

// The one module allowed to touch node:child_process for real, the fixture harnesses (test-only
// code under a fixtures/ folder), and every test file are outside the rule.
const ALLOWED_FILES = new Set(['src/infrastructure/system/process-registry.ts']);
const isExcluded = (rel: string): boolean =>
  ALLOWED_FILES.has(rel) ||
  rel.endsWith('.test.ts') ||
  rel.split('/').includes('fixtures') ||
  rel.split('/').includes('conformance');

const walk = (dir: string, acc: string[] = []): string[] => {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, acc);
    else if (/\.tsx?$/.test(name)) acc.push(path);
  }
  return acc;
};

const isComment = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
};

describe('spawn registration coverage', () => {
  it('I-103: node:child_process is unreachable outside the registry — every other reference is a type-only import', () => {
    const offenders: string[] = [];
    for (const base of ['src', 'electron']) {
      for (const file of walk(join(ROOT, base))) {
        const rel = relative(ROOT, file);
        if (isExcluded(rel)) continue;
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (isComment(line) || !/(?:node:)?child_process/.test(line)) continue;
          // `import type …` and `import { type X }` carry no runtime spawn surface; anything else
          // (a value import, a require, a dynamic import) could start a process, and a process
          // started there would be invisible to the managed quit and the orphan reaper.
          if (/^import\s+type\s/.test(line.trimStart()) || /^\s*import\s*\{[^}]*\btype\b/.test(line)) continue;
          offenders.push(`${rel}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toStrictEqual([]);
  });

  it('I-103: every production spawn seam routes its default through the registry — no file keeps a private real-spawn fallback', () => {
    // The seams that take an injected spawn (discovery, quota probes, the model catalog, the
    // control connections) call a bare `spawn(` on their parameter. Hermetic in tests is fine;
    // what must never reappear is a default defined against node's own spawn. With the module
    // unreachable (the rule above), such a default can only be written by importing it — so the
    // guard here is that each seam file still names its parameter spawn and the value-import rule
    // above is the teeth. This test pins the seam files themselves, so a new seam cannot appear
    // silently: it must be added here in the same PR that introduces it.
    const seams = [
      'src/infrastructure/providers/discovery/path-discovery.ts',
      'src/infrastructure/providers/quota/probe-resolver.ts',
      'src/infrastructure/providers/quota/agy/usage-probe.ts',
      'src/infrastructure/providers/quota/codex/codex-probe.ts',
      'src/infrastructure/providers/catalog/cli-command-catalog.ts',
      'src/infrastructure/providers/transports/acp/connection.ts',
      'src/infrastructure/providers/transports/app-server/connection.ts',
      'electron/main.ts',
    ];
    const offenders: string[] = [];
    for (const rel of seams) {
      if (!existsSync(join(ROOT, rel))) offenders.push(`${rel}: seam file is gone — update this list with the change that moved it`);
    }
    // A seam without the list, or the list without its file, is the failure this reports.
    for (const base of ['src', 'electron']) {
      for (const file of walk(join(ROOT, base))) {
        const rel = relative(ROOT, file);
        if (isExcluded(rel) || seams.includes(rel)) continue;
        const calls = readFileSync(file, 'utf8').split('\n').filter((line) => !isComment(line) && /(?<![.\w])spawn\s*\(/.test(line));
        // A bare `spawn(` with no child_process import means an injected seam parameter.
        const hasModule = readFileSync(file, 'utf8').includes('child_process');
        if (calls.length > 0 && !hasModule) offenders.push(`${rel}: calls an injected spawn — add it to the seam list`);
      }
    }
    expect(offenders).toStrictEqual([]);
  });
});
