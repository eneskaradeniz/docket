// check-orphans.test.mjs — the orphan guard's own test (run by check-boundaries.mjs itself, the
// way check-rule-coverage runs its self-test). A fixture tree proves the guard fails on a component
// with no non-test importer — including one only a test imports — and the real tree must pass:
// that second assertion is the guard's whole point, so a wiring regression fails here first.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { orphanComponents } from './check-boundaries.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

const fixture = () => {
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

test('the real tree has no orphan components', () => {
  assert.deepEqual(orphanComponents(ROOT), []);
});
