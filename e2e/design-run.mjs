// e2e/design-run.mjs — `npm run design`: opens the BUILT app on a fresh design seed for the
// operator's eyes, no Playwright driving it. The seed comes from seedDesign() so the SEED=
// parsing stays in design-app.mjs, and the child gets the same two env vars the E2E harness
// uses. [--no-build] skips the build for a rerun on a fresh seed. Each phase prints a
// `[design]` line before it starts, so the silent stretch between build and window reads as
// progress, and a failure names its phase instead of showing a bare stack.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, seedDesign } from './design-app.mjs';

const PHASE_LINES = {
  build: '[design] building…',
  'skip-build': '[design] skipping build',
  seed: '[design] seeding…',
  launch: '[design] launching the app — close the window to end this command',
};

/** Pure: the line printed for a phase — the start line, or with a message the phase's
 * failure line. One home for the wording, so the script's output and its test cannot
 * drift apart. */
export function designPhaseLine(phase, failedMessage = null) {
  if (failedMessage !== null) return `[design] ${phase} failed: ${failedMessage}`;
  const line = PHASE_LINES[phase];
  if (line === undefined) throw new Error(`unknown design phase: ${phase}`);
  return line;
}

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

/** Report a phase's failure and stop: the message goes to stderr with the phase named,
 * and the non-zero exit is set immediately (no half-started run keeps going). */
function failPhase(phase, error) {
  console.error(designPhaseLine(phase, error instanceof Error ? error.message : String(error)));
  process.exit(1);
}

function main() {
  let noBuild;
  try {
    ({ noBuild } = parseDesignRunArgs(process.argv.slice(2)));
  } catch (error) {
    failPhase('args', error);
  }
  try {
    if (noBuild) console.log(designPhaseLine('skip-build'));
    else {
      console.log(designPhaseLine('build'));
      execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
    }
    if (!existsSync(join(ROOT, 'dist-electron', 'main.js'))) {
      throw new Error('the built app is missing — run `npm run design` without --no-build first');
    }
  } catch (error) {
    failPhase('build', error);
  }
  let seed;
  try {
    console.log(designPhaseLine('seed'));
    seed = seedDesign();
  } catch (error) {
    failPhase('seed', error);
  }
  // The path is the operator's way back to the state (it stays in place until they clean tmp).
  console.log(`design data dir: ${seed.dataDir}`);
  console.log(`agent binary (fake): ${seed.agentBin}`);
  console.log(designPhaseLine('launch'));
  const electronBin = createRequire(import.meta.url)('electron');
  let child;
  try {
    child = spawn(electronBin, [join(ROOT, 'dist-electron', 'main.js')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: designRunEnv(process.env, seed),
    });
  } catch (error) {
    failPhase('launch', error);
  }
  // Hold the run open until the window closes; the app's exit code becomes the script's.
  child.on('exit', (code, signal) => {
    process.exitCode = signal !== null ? 1 : (code ?? 1);
  });
  child.on('error', (error) => {
    failPhase('launch', error);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
