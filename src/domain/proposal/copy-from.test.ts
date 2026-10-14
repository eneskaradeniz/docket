import { describe, expect, it } from 'vitest';

import { copyFromRepo, type RepoSetupSnapshot } from './copy-from';

const SOURCE: RepoSetupSnapshot = {
  flow: {
    flowId: 'standard',
    version: 1,
    stages: [{ id: 'build', role: 'developer', gates: [] }],
    bindings: [
      {
        stage: 'build',
        role: { roleId: 'developer', version: 1, overlay: { name: 'Dev overlay' } },
        accounts: [{ accountId: 'acc-1', model: 'm' }],
      },
    ],
  },
  defaultLimitPolicy: 'wait_resume',
  commandSets: { tests: ['npm test'], lint: ['npm run lint'] },
};

describe('copyFromRepo', () => {
  it('R-147: docs root and test globs come from detected; copied paths are listed; inputs stay unmutated', () => {
    const detected = { docsRoot: 'documentation', testGlobs: ['**/*.spec.ts'] };
    const before = JSON.stringify(SOURCE);
    const result = copyFromRepo(SOURCE, detected);
    expect(result.copiedPaths).toEqual(['flow', 'defaultLimitPolicy', 'commandSets']);
    expect(result.repo.docsRoot).toBe('documentation');
    expect(result.repo.testGlobs).toEqual(['**/*.spec.ts']);
    expect(JSON.stringify(SOURCE)).toBe(before);
  });

  it('R-147: overlays are preserved in the copied flow', () => {
    const result = copyFromRepo(SOURCE, { docsRoot: 'docs', testGlobs: [] });
    const flow = result.repo.flow as { bindings: { role?: { overlay?: { name: string } } }[] };
    expect(flow.bindings[0]?.role?.overlay).toEqual({ name: 'Dev overlay' });
    expect(result.repo.flow).not.toBe(SOURCE.flow);
  });

  it('R-147: no path field of the source leaks into the result', () => {
    const withPath = { ...SOURCE, path: '/secret/source' } as RepoSetupSnapshot & { readonly path: string };
    const result = copyFromRepo(withPath, { docsRoot: 'docs', testGlobs: ['**/*.test.ts'] });
    expect(JSON.stringify(result.repo)).not.toContain('/secret');
    expect(Object.keys(result.repo)).not.toContain('path');
  });
});
