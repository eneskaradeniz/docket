#!/usr/bin/env bash
set -Eeuo pipefail

# check-provider-versions.sh — P-69's weekly sweep: compares the installed provider CLIs against
# the registry's `measuredWith` versions and the exactly-pinned npm dependencies against npm's
# latest. Read-only — it writes nothing, changes nothing, and always exits 0; the table is the
# answer, and one issue per drifted provider is filed by hand afterwards.
#
# The provider names, binaries and measured versions are never typed here: the collector reads
# them from the registry and the provider defs the same way check-capability-copy.mjs does (a
# direct .ts import under tsx), so this script cannot drift from the data it audits.

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COLLECTOR="${TMPDIR:-/tmp}/docket-provider-versions-$$.mjs"
trap 'rm -f "$COLLECTOR"' EXIT

cat >"$COLLECTOR" <<'COLLECTOR'
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.DOCKET_ROOT;
const load = async (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const { BUILTIN_PROVIDER_DEFS } = await load('src/infrastructure/providers/defs/index.ts');
const { CAPABILITY_REGISTRY } = await load('src/infrastructure/providers/registry/capability-registry.ts');
const { versionDrift } = await load('src/domain/providers/capability.ts');

// The same leading dotted number the providers screen parses a CLI's version line into.
const parseVersion = (raw) => /\d+(?:\.\d+)+(?:-[0-9A-Za-z.]+)?/.exec(raw)?.[0] ?? null;

const pad = (text, width) => String(text).padEnd(width, ' ');

// CLI side: for every provider whose evidence names a measured CLI version, probe the installed
// binary the way discovery does (the def's own version args) and compare.
const cliRows = [];
for (const provider of CAPABILITY_REGISTRY.providers) {
  const measured = provider.measuredWith?.cli;
  const def = BUILTIN_PROVIDER_DEFS.find((entry) => entry.id === provider.providerId);
  if (measured === undefined || def === undefined) continue;
  let installed = null;
  for (const bin of def.bins) {
    const probe = spawnSync(bin, [...def.versionArgs], { encoding: 'utf8', timeout: 15000 });
    if (probe.error !== undefined) continue;
    installed = parseVersion(`${probe.stdout ?? ''}${probe.stderr ?? ''}`) ?? null;
    if (installed !== null) break;
  }
  cliRows.push({ provider: provider.providerId, measured, installed, drift: versionDrift(installed ?? undefined, measured) });
}

// Package side: every exactly-pinned dependency (no range — P-69 keeps pins exact) against npm's
// latest, with the registry's measured SDK version joined by the pin's own value, so a pin that
// moved past its measurement is visible too.
const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const pinned = [
  ...Object.entries(manifest.dependencies ?? {}),
  ...Object.entries(manifest.devDependencies ?? {}),
].filter(([, spec]) => /^\d/.test(spec));
const measuredSdks = CAPABILITY_REGISTRY.providers
  .filter((provider) => provider.measuredWith?.sdk !== undefined)
  .map((provider) => ({ provider: provider.providerId, sdk: provider.measuredWith.sdk }));
const npmLatest = (pkg) => {
  const view = spawnSync('npm', ['view', pkg, 'version'], { encoding: 'utf8', timeout: 30000 });
  return view.status === 0 ? parseVersion(view.stdout ?? '') : null;
};

console.log('CLI versions (installed vs the registry measuredWith)');
const cliWidths = ['provider', 'measured', 'installed', 'drift'].map((key, index) =>
  Math.max(key.length, ...cliRows.map((row) => String(row[key] ?? 'not found').length), [12, 8, 9, 6][index]),
);
console.log(`  ${pad('provider', cliWidths[0])} ${pad('measured', cliWidths[1])} ${pad('installed', cliWidths[2])} drift`);
for (const row of cliRows) {
  console.log(
    `  ${pad(row.provider, cliWidths[0])} ${pad(row.measured, cliWidths[1])} ${pad(row.installed ?? 'not found', cliWidths[2])} ${row.drift}`,
  );
}
console.log('');
console.log('Pinned packages (pin vs npm latest; the registry measuredWith.sdk joins by the pin)');
console.log(`  ${pad('package', 34)} ${pad('pinned', 8)} ${pad('npm latest', 11)} note`);
for (const [pkg, pin] of pinned) {
  const latest = npmLatest(pkg);
  const measured = measuredSdks.find((entry) => entry.sdk === pin);
  const notes = [];
  if (measured === undefined) notes.push('outside the provider stack');
  if (latest !== null && latest !== pin) {
    notes.push(measured === undefined ? 'npm is ahead' : 'npm is ahead — bump PR per P-69 (changelog review, suites, canary)');
  }
  if (latest === null) notes.push('npm view failed');
  console.log(`  ${pad(pkg, 34)} ${pad(pin, 8)} ${pad(latest ?? 'unknown', 11)} ${notes.join('; ') || 'current'}`);
}
COLLECTOR

DOCKET_ROOT="$ROOT" npx --no-install tsx "$COLLECTOR"
