#!/usr/bin/env node
// P-36 — regenerate the README provider matrix from the capability registry so the table cannot
// drift from the data. Run on demand (`npm run gen:provider-matrix`), never on build; the output
// is committed and the drift test
// (src/infrastructure/providers/registry/provider-matrix.test.ts) pins the committed block to a
// full regeneration. TypeScript loads the same way emit-contract.mjs loads it: a direct .ts
// import under tsx. Emit-only — no markdown library exists anywhere in this pipeline.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PROVIDER_MATRIX_END,
  PROVIDER_MATRIX_START,
  renderRegistryMatrix,
} from '../src/infrastructure/providers/registry/provider-matrix.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const table = renderRegistryMatrix();

const section = [
  '## Providers',
  '',
  'Agent CLIs Docket can run, with the route kinds of each. Support levels and model data come',
  'from the capability registry; regenerate with `npm run gen:provider-matrix`.',
  '',
  PROVIDER_MATRIX_START,
  table,
  PROVIDER_MATRIX_END,
  '',
  '',
].join('\n');

const startIdx = readme.indexOf(PROVIDER_MATRIX_START);
const endIdx = readme.indexOf(PROVIDER_MATRIX_END);
let next;
if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
  next = `${readme.slice(0, startIdx + PROVIDER_MATRIX_START.length)}\n${table}\n${readme.slice(endIdx)}`;
} else {
  // No block yet: insert the Providers section before the license chapter, else append.
  const licenseIdx = readme.indexOf('## License');
  next =
    licenseIdx === -1
      ? `${readme.replace(/\n$/, '')}\n\n${section}`
      : `${readme.slice(0, licenseIdx)}${section}${readme.slice(licenseIdx)}`;
}

if (next === readme) {
  console.log('README.md provider matrix already current');
} else {
  writeFileSync(readmePath, next, 'utf8');
  console.log(`README.md provider matrix ${startIdx === -1 ? 'written' : 'regenerated'} (${table.length} bytes of table)`);
}
