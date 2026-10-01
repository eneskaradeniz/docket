// P-36 drift test: the committed README block must equal a full regeneration from the capability
// registry, so a hand edit — or a registry change without running the generator — fails here with
// the diff instead of drifting silently. Reading the repository README is infrastructure work;
// the table text itself is the domain renderer's output.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { renderRegistryMatrix, PROVIDER_MATRIX_END, PROVIDER_MATRIX_START } from './provider-matrix';

const ROOT = join(fileURLToPath(new URL('../../../../', import.meta.url)));
const README_PATH = join(ROOT, 'README.md');

const blockOf = (readme: string): string => {
  const start = readme.indexOf(PROVIDER_MATRIX_START);
  const end = readme.indexOf(PROVIDER_MATRIX_END);
  if (start === -1 || end === -1 || end < start) return '';
  return readme
    .slice(start + PROVIDER_MATRIX_START.length, end)
    .replace(/^\n/, '')
    .replace(/\n$/, '');
};

describe('README provider matrix (P-36)', () => {
  it('P-36: the committed README block equals the matrix regenerated from the capability registry', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    const committed = blockOf(readme);
    expect(committed).not.toBe('');
    expect(committed).toBe(renderRegistryMatrix());
  });
});
