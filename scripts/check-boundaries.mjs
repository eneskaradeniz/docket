#!/usr/bin/env node
// Boundary checks for the Electron shell and the presentation tree. The v2 layer rules (src/domain,
// application, api, infrastructure, presentation) live in scripts/check-layers.mjs; electron/ sits
// outside those layers, so the one rule that still has to reach it is kept here: no agent-vendor
// name outside the provider layer (a hit is a stop-and-ask report, not a reason to narrow the
// list). The second rule guards the components directory: a non-test component no other non-test
// presentation file imports is dead UI — #1024 built components no screen rendered, and this check
// turns that into a build failure instead of a later wiring issue. Runs as part of
// `npm run check:boundaries`; its own fixture self-test is scripts/check-orphans.test.mjs.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const VENDOR_RE = /\b(claude|anthropic|codex|openai|gpt|gemini|antigravity|cursor|copilot)\b/i;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.[tj]sx?$/.test(name)) acc.push(p);
  }
  return acc;
}

const agentVendorViolations = (root = ROOT) => {
  const violations = [];
  for (const f of walk(join(root, 'electron'))) {
    readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
      // `CLAUDE.md` and `.claude/` name the agent-configuration surface, not the vendor's product.
      const stripped = ln.replace(/claude\.md/gi, '').replace(/\.claude/g, '');
      const m = VENDOR_RE.exec(stripped);
      if (m) violations.push(`${relative(root, f)}:${i + 1}  agent-vendor name "${m[1].toLowerCase()}"`);
    });
  }
  return violations;
};

const isTestFile = (name) => /\.test\.tsx?$/.test(name);
const isSourceFile = (name) => /\.(ts|tsx)$/.test(name);

// Components built ahead of their wiring, held by name so the guard stays honest while they wait.
// The list must be empty when the phase closes; #1123 wires these two and empties it — an entry
// whose file gains a non-test importer or stops existing fails the check so it cannot go stale.
export const ORPHAN_ALLOWLIST = new Map([]);

/** The relative module specifiers one source file imports (`./x`, `../y`); package imports and
 *  type-only syntax carry no path to resolve. */
const relativeImportsOf = (text) =>
  [...text.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);

/** Every non-test file under `src/presentation` that some other non-test file under
 *  `src/presentation` imports through a relative specifier. Extensionless specifiers resolve the
 *  way the bundler does (.ts, .tsx, /index.ts); a test-only importer does not count. */
const importedPresentationFiles = (root) => {
  const presentation = join(root, 'src', 'presentation');
  const files = walk(presentation).filter((f) => isSourceFile(basename(f)) && !isTestFile(basename(f)));
  const imported = new Set();
  for (const file of files) {
    for (const spec of relativeImportsOf(readFileSync(file, 'utf8'))) {
      const base = resolve(dirname(file), spec);
      for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
        if (statOrNull(candidate)?.isFile()) imported.add(candidate);
      }
    }
  }
  return imported;
};

const statOrNull = (p) => {
  try {
    return statSync(p);
  } catch {
    return null;
  }
};

/** Component files no non-test presentation file imports — the orphan guard's answer, as paths
 *  relative to the root. A non-test file under src/presentation/components/ that nothing renders
 *  belongs to no screen and fails the check; tests are free importers, never saviours. Files the
 *  allowlist holds by name pass while their wiring issue stays open. */
export const orphanComponents = (root = ROOT) => {
  const componentsDir = join(root, 'src', 'presentation', 'components');
  const imported = importedPresentationFiles(root);
  return readdirSync(componentsDir)
    .filter((name) => isSourceFile(name) && !isTestFile(name))
    .map((name) => join(componentsDir, name))
    .filter((file) => !imported.has(file) && !ORPHAN_ALLOWLIST.has(relative(root, file)))
    .map((file) => relative(root, file))
    .sort();
};

/** The allowlist's own honesty: an entry passes only while its file exists AND still has no
 *  non-test importer — a wired component must shed its entry in the same PR, and a renamed or
 *  deleted one must not leave a stale name behind. */
export const orphanAllowlistProblems = (root = ROOT) => {
  const imported = importedPresentationFiles(root);
  const problems = [];
  for (const [rel, issue] of ORPHAN_ALLOWLIST) {
    const file = join(root, rel);
    if (!statOrNull(file)?.isFile()) problems.push(`${rel} is allowlisted (${issue}) but does not exist — fix ORPHAN_ALLOWLIST`);
    else if (imported.has(file)) problems.push(`${rel} is allowlisted (${issue}) but has a non-test importer — remove it from ORPHAN_ALLOWLIST`);
  }
  return problems;
};

const isMain = process.argv[1] && SELF === process.argv[1];
if (isMain) {
  const selfTest = spawnSync(process.execPath, ['--test', join(ROOT, 'scripts/check-orphans.test.mjs')], {
    stdio: 'inherit',
  });
  if (selfTest.status !== 0) process.exit(selfTest.status ?? 1);

  const violations = agentVendorViolations();
  if (violations.length) {
    console.log('[FAIL] agent-vendor names in electron/');
    for (const v of violations) console.log(`  ${v}`);
    console.log(`\n${violations.length} boundary violation(s)`);
    process.exit(1);
  }
  console.log('[ ok ] agent-vendor names in electron/');

  const orphans = orphanComponents();
  if (orphans.length) {
    console.log('[FAIL] orphan components — no non-test presentation file imports them:');
    for (const name of orphans) console.log(`  ${name}`);
    console.log('\nwire them into a screen, or delete the component and its tests');
    process.exit(1);
  }
  const allowlistProblems = orphanAllowlistProblems();
  if (allowlistProblems.length) {
    console.log('[FAIL] orphan allowlist is stale:');
    for (const problem of allowlistProblems) console.log(`  ${problem}`);
    process.exit(1);
  }
  console.log(`[ ok ] no orphan components under src/presentation/components/ (${ORPHAN_ALLOWLIST.size} allowlisted, must be empty when the phase closes)`);
  console.log('boundary checks clean');
}
