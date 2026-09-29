// e2e/design-run.test.mjs — the pure parts of `npm run design`: flag parsing, child env
// assembly and the progress-line labels (node:test; vitest covers src/ only).
// Run: node --test e2e/design-run.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { designPhaseLine, designRunEnv, parseDesignRunArgs } from './design-run.mjs';

test('no flags means build, --no-build skips it', () => {
  assert.deepEqual(parseDesignRunArgs([]), { noBuild: false });
  assert.deepEqual(parseDesignRunArgs(['--no-build']), { noBuild: true });
});

test('an unknown argument is an error, not a silent rebuild', () => {
  assert.throws(() => parseDesignRunArgs(['--skip-build']), /unknown argument: --skip-build/);
  assert.throws(() => parseDesignRunArgs(['--no-build', 'extra']), /unknown argument: extra/);
});

test('the child env carries exactly the two seed vars the harness uses', () => {
  const env = designRunEnv({ PATH: '/bin', DOCKET_DATA_DIR: '/stale' }, {
    dataDir: '/tmp/seed-home/.docket',
    agentBin: '/tmp/seed-home/bin/design-agent',
  });
  assert.equal(env.DOCKET_DATA_DIR, '/tmp/seed-home/.docket');
  assert.equal(env.DOCKET_OPENCODE_BIN, '/tmp/seed-home/bin/design-agent');
  assert.equal(env.PATH, '/bin');
});

test('each phase has a progress line printed before the phase starts', () => {
  assert.equal(designPhaseLine('build'), '[design] building…');
  assert.equal(designPhaseLine('skip-build'), '[design] skipping build');
  assert.equal(designPhaseLine('seed'), '[design] seeding…');
  assert.equal(
    designPhaseLine('launch'),
    '[design] launching the app — close the window to end this command',
  );
});

test('a failed phase prints `[design] <phase> failed: <message>`', () => {
  assert.equal(
    designPhaseLine('seed', 'the design seed printed no SEED= line'),
    '[design] seed failed: the design seed printed no SEED= line',
  );
});

test('an unknown phase name is an error, not a silent empty line', () => {
  assert.throws(() => designPhaseLine('bild'), /unknown design phase: bild/);
});
