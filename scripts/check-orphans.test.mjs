// check-orphans.test.mjs — the orphan guard's own test (run by check-boundaries.mjs itself, the
// way check-rule-coverage runs its self-test). A fixture tree proves the guard fails on a component
// with no non-test importer — including one only a test imports — and the real tree must pass:
// that second assertion is the guard's whole point, so a wiring regression fails here first. The
// allowlist section proves its three behaviours: a held file passes, a wired or missing entry
// fails, so the list cannot outlive the wiring issue that justified it.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { orphanAllowlistProblems, orphanComponents } from './check-boundaries.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

// The allowlist's exact relative paths, so a fixture holding them exercises the real entries.
const HELD = 'src/presentation/components/past-versions-modal.tsx';
const HELD_TWO = 'src/presentation/components/removal-action-button.tsx';

const fixture = ({ held = true, wireHeld = false } = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'docket-orphans-'));
  const dir = join(root, 'src', 'presentation');
  mkdirSync(join(dir, 'components'), { recursive: true });
  mkdirSync(join(dir, 'screens'), { recursive: true });
  writeFileSync(join(dir, 'components', 'used.tsx'), 'export const Used = 1;\n');
  // No non-test importer anywhere.
  writeFileSync(join(dir, 'components', 'lonely.tsx'), 'export const Lonely = 1;\n');
  // Imported by a test only — a test is never a saviour.
  writeFileSync(join(dir, 'components', 'testonly.tsx'), 'export const TestOnly = 1;\n');
  // A test file of its own does not count either.
  writeFileSync(join(dir, 'components', 'lonely.test.ts'), "import { Lonely } from './lonely';\n");
  writeFileSync(join(dir, 'components', 'testonly.test.ts'), "import { TestOnly } from './testonly';\n");
  writeFileSync(join(dir, 'screens', 'screen.tsx'), "import { Used } from '../components/used';\nexport const Screen = Used;\n");
  writeFileSync(join(dir, 'screens', 'screen.test.ts'), "import { TestOnly } from '../components/testonly';\nexport const T = TestOnly;\n");
  if (held) {
    writeFileSync(join(root, HELD), 'export const Held = 1;\n');
    writeFileSync(join(root, HELD_TWO), 'export const HeldTwo = 1;\n');
    if (wireHeld) writeFileSync(join(dir, 'screens', 'wiring.tsx'), "import { Held } from '../components/past-versions-modal';\nexport const Wiring = Held;\n");
  }
  return root;
};

test('a component with no non-test importer is an orphan; a wired one is not', () => {
  const root = fixture();
  try {
    assert.deepEqual(orphanComponents(root), ['src/presentation/components/lonely.tsx', 'src/presentation/components/testonly.tsx']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an allowlisted component passes while it waits for its wiring issue', () => {
  const root = fixture();
  try {
    assert.deepEqual(orphanComponents(root).filter((name) => name === HELD || name === HELD_TWO), []);
    assert.deepEqual(orphanAllowlistProblems(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an allowlisted component that gains a non-test importer fails the check', () => {
  const root = fixture({ wireHeld: true });
  try {
    const problems = orphanAllowlistProblems(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], new RegExp(`${HELD} is allowlisted \\(#1123\\) but has a non-test importer`));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an allowlist entry whose file does not exist fails the check', () => {
  const root = fixture({ held: false });
  try {
    const problems = orphanAllowlistProblems(root);
    assert.equal(problems.length, 2);
    for (const problem of problems) assert.match(problem, /is allowlisted \(#1123\) but does not exist/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the real tree has no orphan components and a clean allowlist', () => {
  assert.deepEqual(orphanComponents(ROOT), []);
  assert.deepEqual(orphanAllowlistProblems(ROOT), []);
});
