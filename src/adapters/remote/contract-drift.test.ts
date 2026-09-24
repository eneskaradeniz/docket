// src/adapters/remote/contract-drift.test.ts — the checked-in mirror's byte guard (WO-0102).
//
// Lives ADAPTER-side, not under src/core/__tests__, because reading the file needs node:fs and
// c3 (scripts/check-boundaries.mjs) carries no test exemption for src/core/ (plan §12 finding 1,
// architect-confirmed). The emitter may be imported from core — adapters import core everywhere.
// A hand edit to contract/endpoints.yaml goes RED here; `npm run contract` regenerates.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { emitEndpointsYaml } from '../../core/remote-contract';

const onDisk = (): string => readFileSync(fileURLToPath(new URL('../../../contract/endpoints.yaml', import.meta.url)), 'utf8');

describe('contract/endpoints.yaml drift guard (WO-0102)', () => {
  it('is byte-identical to emitEndpointsYaml() — regenerate with npm run contract', () => {
    expect(emitEndpointsYaml()).toBe(onDisk());
  });
});
