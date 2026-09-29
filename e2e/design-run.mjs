// e2e/design-run.mjs — `npm run design`: opens the BUILT app on a fresh design seed for the
// operator's eyes, no Playwright driving it. The seed comes from seedDesign() so the SEED=
// parsing stays in design-app.mjs, and the child gets the same two env vars the E2E harness
// uses. [--no-build] skips the build for a rerun on a fresh seed.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, seedDesign } from './design-app.mjs';

/** Pure: split argv into flags. An unknown word is an error so a typo cannot silently rebuild. */
export function parseDesignRunArgs(argv) {
  const flags = { noBuild: false };
  for (const arg of argv) {
    if (arg === '--no-build') flags.noBuild = true;
    else throw new Error(`unknown argument: ${arg} (supported: --no-build)`);
  }
  return flags;
}

/** Pure: the child env — the parent's plus exactly the two seed vars the harness uses. */
export function designRunEnv(env, seed) {
  return { ...env, DOCKET_DATA_DIR: seed.dataDir, DOCKET_OPENCODE_BIN: seed.agentBin };
}

function main() {
  const { noBuild } = parseDesignRunArgs(process.argv.slice(2));
  if (!noBuild) execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
    throw new Error('the built app is missing — run `npm run design` without --no-build first');
  }
  const seed = seedDesign();
  // The path is the operator's way back to the state (it stays in place until they clean tmp).
  console.log(`design data dir: ${seed.dataDir}`);
  console.log(`agent binary (fake): ${seed.agentBin}`);
  const electronBin = createRequire(import.meta.url)('electron');
  const child = spawn(electronBin, [join(ROOT, 'dist-electron', 'main.js')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: designRunEnv(process.env, seed),
  });
  // Hold the run open until the window closes; the app's exit code becomes the script's.
  child.on('exit', (code, signal) => {
    process.exitCode = signal !== null ? 1 : (code ?? 1);
  });
  child.on('error', (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
