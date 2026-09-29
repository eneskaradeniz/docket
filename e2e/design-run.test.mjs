// e2e/design-run.test.mjs — the pure parts of `npm run design`: flag parsing and child env
// assembly (node:test; vitest covers src/ only). Run: node --test e2e/design-run.test.mjs
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { designRunEnv, parseDesignRunArgs } from './design-run.mjs';

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
