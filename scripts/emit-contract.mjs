#!/usr/bin/env node
// WO-0102 — regenerate contract/endpoints.yaml from the core emitter (ADR-0020 #11: the
// contract's source is the code; the mirror is generated). Run on demand (`npm run contract`),
// never on build; the output is committed and the drift test
// (src/adapters/remote/contract-drift.test.ts) pins file-vs-emitter byte equality, so a
// hand-edited yaml goes red until this script regenerates it. tsx runs the .ts import (the
// devDep WO-0073 kept); emit-only — no yaml parser exists anywhere in this pipeline.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitEndpointsYaml } from '../src/core/remote-contract.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'contract', 'endpoints.yaml');
mkdirSync(dirname(target), { recursive: true });
const next = emitEndpointsYaml();
let prior = '';
try {
  prior = readFileSync(target, 'utf8');
} catch {
  prior = '';
}
if (prior === next) {
  console.log('contract/endpoints.yaml already current');
} else {
  writeFileSync(target, next, 'utf8');
  console.log(`contract/endpoints.yaml ${prior === '' ? 'written' : 'regenerated'} (${next.length} bytes)`);
}
