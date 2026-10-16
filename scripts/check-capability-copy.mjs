#!/usr/bin/env node
// U-333 drift guard — the presentation layer-safe copy of the translation table (the base64
// CAPABILITY_TRANSLATION_TABLE_B64 constant in src/presentation/stores/agent-capabilities.ts) must
// equal the infrastructure registry's TRANSLATION_TABLE row for row. No layer may read both sides
// (presentation may not import infrastructure, infrastructure may not import presentation), so the
// guard lives here under scripts/ the way check-rule-coverage.mjs does; TypeScript loads the same
// way gen-provider-matrix.mjs loads it: a direct .ts import under tsx. Runs as part of
// `npm run check:boundaries`; `npm run gen:capability-copy` (--write here) regenerates the constant
// from the table — the constant is generated, never hand-edited.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSLATION_TABLE } from '../src/infrastructure/providers/registry/capability-registry.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STORE_PATH = join(ROOT, 'src', 'presentation', 'stores', 'agent-capabilities.ts');
const WRITE = process.argv.includes('--write');
const REGEN_HINT = 'regenerate with: npm run gen:capability-copy (tsx scripts/check-capability-copy.mjs --write)';

/** The copy's row: the registry row in the copy's fixed field order (provider, kind, support, how,
 *  then the optional degradesTo / sourceKinds only when the registry row carries them). */
const copyRow = (row) => {
  const copy = { provider: row.provider, kind: row.kind, support: row.support, how: row.how };
  if (row.degradesTo !== undefined) copy.degradesTo = row.degradesTo;
  if (row.sourceKinds !== undefined) copy.sourceKinds = [...row.sourceKinds];
  return copy;
};

const expectedRows = () => TRANSLATION_TABLE.map(copyRow);
const expectedBase64 = () => Buffer.from(JSON.stringify(expectedRows()), 'utf8').toString('base64');

/** Structural compare independent of field order: stable JSON with sorted keys. */
const canonical = (value) =>
  Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : value !== null && typeof value === 'object'
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
          .join(',')}}`
      : JSON.stringify(value);

/** Row-level diffs for the failure message: at most the first five rows that differ. */
const rowDiffs = (copy, expected) => {
  const diffs = [];
  const count = Math.max(copy.length, expected.length);
  for (let i = 0; i < count && diffs.length < 5; i += 1) {
    const a = copy[i];
    const b = expected[i];
    if (canonical(a) === canonical(b)) continue;
    const fields = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter(
      (key) => canonical(a?.[key]) !== canonical(b?.[key]),
    );
    const name = a ?? b;
    diffs.push(
      `  row ${i} (${name.provider}/${name.kind}): ${fields
        .map((key) => `${key} copy=${JSON.stringify(a?.[key])} registry=${JSON.stringify(b?.[key])}`)
        .join('; ')}`,
    );
  }
  return diffs;
};

const source = readFileSync(STORE_PATH, 'utf8');
const match = /(const CAPABILITY_TRANSLATION_TABLE_B64 =\s*')([A-Za-z0-9+/=]+)(')/.exec(source);
if (match === null) {
  console.error(`capability copy drift check: CAPABILITY_TRANSLATION_TABLE_B64 literal not found in ${STORE_PATH}\n${REGEN_HINT}`);
  process.exit(1);
}

const fresh = expectedBase64();
if (WRITE) {
  if (match[2] === fresh) {
    console.log('capability copy already current');
  } else {
    writeFileSync(STORE_PATH, `${source.slice(0, match.index)}${match[1]}${fresh}${match[3]}${source.slice(match.index + match[0].length)}`, 'utf8');
    console.log(`capability copy regenerated (${expectedRows().length} rows, ${fresh.length} bytes of base64)`);
  }
  process.exit(0);
}

let copyRows;
try {
  copyRows = JSON.parse(Buffer.from(match[2], 'base64').toString('utf8'));
} catch (error) {
  console.error(`capability copy drift check: the constant does not decode (${error.message})\n${REGEN_HINT}`);
  process.exit(1);
}
const expected = expectedRows();
if (canonical(copyRows) !== canonical(expected)) {
  console.error(
    `capability copy drift: the presentation copy does not equal the registry table (copy ${copyRows.length} rows, registry ${expected.length} rows)\n` +
      `${rowDiffs(copyRows, expected).join('\n')}\n${REGEN_HINT}`,
  );
  process.exit(1);
}
console.log(`capability copy drift check clean (${expected.length} rows)`);
