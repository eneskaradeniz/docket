// e2e/profile.test.mjs — the per-launch profile helper's pure parts: every launch gets its own
// existing throwaway dir, and the isolation guard fails loudly when the app's userData lands
// anywhere else. Run: node --test e2e/profile.test.mjs (node:test; not part of vitest, which
// covers src/ only).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertProfileIsolated, freshProfile } from './profile.mjs';

const makeProfile = () => freshProfile('e2e-profile-test-');
const drop = (...dirs) => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
};

test('freshProfile hands every launch its own existing throwaway dir', () => {
  const a = makeProfile();
  const b = makeProfile();
  try {
    assert.deepEqual(a.args, [`--user-data-dir=${a.dir}`], 'the launch switch is not exactly the dir');
    assert.ok(existsSync(a.dir), 'the profile dir was not created');
    assert.notEqual(a.dir, b.dir, 'two launches share one profile');
    assert.ok(a.dir.startsWith(join(tmpdir(), 'e2e-profile-test-')), `the dir is not under the OS temp root: ${a.dir}`);
  } finally {
    drop(a.dir, b.dir);
  }
});

// A fake ElectronApplication: evaluate runs the page function against a fake electron module the
// way playwright runs it in the main process.
const fakeApp = (userData) => ({
  evaluate: (fn) => Promise.resolve(fn({ app: { getPath: () => userData } })),
});

test('assertProfileIsolated accepts the dir, in either of its path forms', async () => {
  const { dir } = makeProfile();
  try {
    await assertProfileIsolated(fakeApp(dir), dir);
    // darwin hands out /var/… while the app may answer /private/var/… — same directory.
    await assertProfileIsolated(fakeApp(realpathSync(dir)), dir);
  } finally {
    drop(dir);
  }
});

test('assertProfileIsolated fails loudly when the switch is not honoured', async () => {
  const { dir } = makeProfile();
  const elsewhere = mkdtempSync(join(tmpdir(), 'e2e-profile-test-other-'));
  try {
    await assert.rejects(assertProfileIsolated(fakeApp(elsewhere), dir), /profile isolation failed/);
  } finally {
    drop(dir, elsewhere);
  }
});
