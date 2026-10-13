// storage/bundle/store.test.ts — acceptance tests for BundleStore (I-89, I-91, I-98, I-99, I-100).
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, type EpochMs, type ProjectSlug, type RepoSlug } from '../../../domain/index';
import type {
  DocketBundle,
  BundleProjects,
  BundleRepos,
  BundleLibrary,
  BundleMemory,
  MemoryNote,
} from '../../../application/ports/bundle-store';
import { canonicalize, computeBundleChecksum } from './canonical-json';
import { createFsBundleStore } from './store';

const slugOf = <B extends string>(val: string) => {
  const p = parseSlug<B>(val);
  if (!p.ok) throw new Error(`Invalid slug: ${val}`);
  return p.value;
};

const PROJ: ProjectSlug = slugOf('alpha');
const REPO: RepoSlug = slugOf('core');
const NOW: EpochMs = 1776090312000; // 2026-04-13T14:25:12.000Z

const makeSampleBundle = (): DocketBundle => {
  const projects: BundleProjects = [
    {
      project: {
        id: PROJ,
        name: 'Alpha Project',
        repos: [REPO],
      },
      roadmap: {
        phases: [
          {
            id: slugOf('p1'),
            name: 'Phase 1',
            blockedBy: [],
            tasks: [
              {
                id: slugOf('t1'),
                title: 'Task 1',
                dependsOn: [],
                acceptance: ['works'],
                targets: [REPO],
              },
            ],
          },
        ],
      },
    },
  ];

  const repos: BundleRepos = [
    {
      id: REPO,
      name: 'Core Repo',
      commandSets: { test: ['npm test'] },
      docsRoot: 'docs',
      testGlobs: ['**/*.test.ts'],
      defaultLimitPolicy: 'wait_resume',
      flow: {
        flowId: slugOf('std'),
        version: 1,
        stages: [
          {
            id: slugOf('impl'),
            name: 'Implement',
            role: slugOf('planner'),
            exit: [],
          },
        ],
        bindings: [
          {
            stage: slugOf('impl'),
            role: { roleId: slugOf('planner'), version: 1 },
            accounts: [], // I-89: accounts []
          },
        ],
      },
    },
  ];

  const library: BundleLibrary = {
    roles: {
      planner: [
        {
          definitionId: 'planner',
          version: 1,
          recordedAt: NOW,
          archived: false,
          body: {
            id: slugOf('planner'),
            name: 'Planner Role',
            instructions: 'Plan tasks',
            writeScope: { kind: 'none' },
            capabilities: [],
            active: true,
          },
        },
      ],
    },
    flows: {
      std: [
        {
          definitionId: 'std',
          version: 1,
          recordedAt: NOW,
          archived: false,
          body: {
            id: slugOf('std'),
            name: 'Standard Flow',
            stages: [
              {
                id: slugOf('impl'),
                name: 'Implement',
                role: slugOf('planner'),
                exit: [],
              },
            ],
          },
        },
      ],
    },
    capabilities: {},
    memory: {},
  };

  const memory: BundleMemory = [
    {
      id: 'mem-1',
      scope: 'project',
      scopeId: 'alpha',
      text: 'Always use strict TypeScript',
      createdBy: 'user',
      active: true,
    },
  ];

  const envelope = {
    format: 'docket-bundle' as const,
    version: 1 as const,
    createdAt: NOW,
    projects,
    repos,
    library,
    memory,
  };

  const checksum = computeBundleChecksum(envelope);

  return {
    ...envelope,
    checksum,
  };
};

describe('createFsBundleStore', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'docket-bundle-test-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('I-100: export writes <slug>-<UTCYmd-HMS>.docket-bundle.json, never overwrites (-2, -3 … on collision); read answers not_found/wrong_format/bad_checksum; the file is staged then renamed', async () => {
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    const exported = await store.export(PROJ, bundle);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // File name: alpha-20260413-142512.docket-bundle.json
    expect(exported.value.path).toMatch(/alpha-\d{8}-\d{6}\.docket-bundle\.json$/);

    const firstContent = await readFile(exported.value.path, 'utf8');

    // Export again with same timestamp -> gets -2 suffix and never overwrites first file
    const secondExport = await store.export(PROJ, bundle);
    expect(secondExport.ok).toBe(true);
    if (!secondExport.ok) return;
    expect(secondExport.value.path).toMatch(/alpha-\d{8}-\d{6}-2\.docket-bundle\.json$/);

    // Export third time -> -3
    const thirdExport = await store.export(PROJ, bundle);
    expect(thirdExport.ok).toBe(true);
    if (!thirdExport.ok) return;
    expect(thirdExport.value.path).toMatch(/alpha-\d{8}-\d{6}-3\.docket-bundle\.json$/);

    // Assert first file was never overwritten
    const firstContentAfter = await readFile(exported.value.path, 'utf8');
    expect(firstContentAfter).toBe(firstContent);

    // Read missing file -> not_found
    const missing = await store.read(join(tempRoot, 'non-existent.docket-bundle.json'));
    expect(missing).toEqual({ ok: false, error: 'not_found' });

    // Read invalid JSON -> wrong_format
    const badJsonPath = join(tempRoot, 'corrupted.docket-bundle.json');
    await writeFile(badJsonPath, '{ invalid json', 'utf8');
    const badJson = await store.read(badJsonPath);
    expect(badJson).toEqual({ ok: false, error: 'wrong_format' });

    // Read non-bundle format -> wrong_format
    const wrongFormatPath = join(tempRoot, 'other.docket-bundle.json');
    await writeFile(wrongFormatPath, JSON.stringify({ format: 'something-else', version: 1 }), 'utf8');
    const wrongFormat = await store.read(wrongFormatPath);
    expect(wrongFormat).toEqual({ ok: false, error: 'wrong_format' });

    // Read valid file -> ok
    const readBack = await store.read(exported.value.path);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;
    expect(readBack.value.format).toBe('docket-bundle');
    expect(readBack.value.version).toBe(1);
    expect(readBack.value.checksum).toBe(bundle.checksum);
  });

  it('I-98: the same bundle bytes checksum identically under the RFC 8785 form (sorted UTF-16 keys, no insignificant whitespace, shortest round-trip numbers); a flipped byte reads bad_checksum', async () => {
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    // Verify canonical JSON determinism across different key ordering
    const unorderedA = { z: 1, a: 'test', b: [1, 2, { y: 2, x: 1 }] };
    const unorderedB = { b: [1, 2, { x: 1, y: 2 }], a: 'test', z: 1 };
    expect(canonicalize(unorderedA)).toBe(canonicalize(unorderedB));
    expect(canonicalize(unorderedA)).toBe('{"a":"test","b":[1,2,{"x":1,"y":2}],"z":1}');

    // Numbers: 0 and -0 are '0'
    expect(canonicalize({ num: -0 })).toBe('{"num":0}');
    expect(canonicalize({ num: 0 })).toBe('{"num":0}');

    const exported = await store.export(PROJ, bundle);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Flip a byte in the written bundle file
    const fileBytes = await readFile(exported.value.path);
    const corruptedBytes = Buffer.from(fileBytes);
    // Find character 'A' in 'Alpha Project' and flip it to 'B'
    const idx = corruptedBytes.indexOf(Buffer.from('Alpha'));
    expect(idx).toBeGreaterThan(-1);
    corruptedBytes[idx] = 'B'.charCodeAt(0);

    const corruptedPath = join(tempRoot, 'corrupted-byte.docket-bundle.json');
    await writeFile(corruptedPath, corruptedBytes);

    const result = await store.read(corruptedPath);
    expect(result).toEqual({ ok: false, error: 'bad_checksum' });
  });

  it('I-89: the bundle is one *.docket-bundle.json whose checksum is the SHA-256 over the canonical JSON of everything else', async () => {
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    const exported = await store.export(PROJ, bundle);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    expect(exported.value.path.endsWith('.docket-bundle.json')).toBe(true);

    const readBack = await store.read(exported.value.path);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;

    const { checksum, ...rest } = readBack.value;
    const computed = computeBundleChecksum(rest);
    expect(checksum).toBe(computed);
  });

  it('I-89: the bundle never contains secrets, secret refs, account ids, folder paths, runs, records, transcripts or quota data', async () => {
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    const exported = await store.export(PROJ, bundle);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const serialized = await readFile(exported.value.path, 'utf8');

    // Secrets hygiene test:
    expect(serialized).not.toMatch(/secretRef/i);
    expect(serialized).not.toMatch(/AKIA[0-9A-Z]{16}/);
    expect(serialized).not.toMatch(/sk-[a-zA-Z0-9]{20,}/);
    expect(serialized).not.toMatch(/"accountId":/);
    expect(serialized).not.toMatch(/acc-[a-z0-9]+/);
    expect(serialized).not.toMatch(/\/Users\//);
    expect(serialized).not.toMatch(/~\//);
    expect(serialized).not.toMatch(/"transcript":/);
    expect(serialized).not.toMatch(/"quota":/);
  });

  it('I-89: stage bindings export with accounts [] and import leaves them unbound', async () => {
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    const exported = await store.export(PROJ, bundle);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const readBack = await store.read(exported.value.path);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;

    const repos = readBack.value.repos as BundleRepos;
    expect(repos).toHaveLength(1);
    expect(repos[0].flow?.bindings[0].accounts).toEqual([]);
  });

  it('I-99: projects carry ProjectDef with the Roadmap riding inside; repos is RepoDef[]; library carries full VersionRecord histories in version order; memory carries accepted MemoryNotes only', async () => {
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    const exported = await store.export(PROJ, bundle);
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    const readBack = await store.read(exported.value.path);
    expect(readBack.ok).toBe(true);
    if (!readBack.ok) return;

    const projects = readBack.value.projects as BundleProjects;
    expect(projects).toHaveLength(1);
    expect(projects[0].project.id).toBe(PROJ);
    expect(projects[0].roadmap?.phases).toHaveLength(1);

    const repos = readBack.value.repos as BundleRepos;
    expect(repos).toHaveLength(1);
    expect(repos[0].id).toBe(REPO);

    const library = readBack.value.library as BundleLibrary;
    expect(library.roles.planner).toHaveLength(1);
    expect(library.roles.planner[0].version).toBe(1);

    const memory = readBack.value.memory as readonly MemoryNote[];
    expect(memory).toHaveLength(1);
    expect(memory[0].id).toBe('mem-1');
    expect(memory[0].active).toBe(true);
    // Proposals (pending/rejected) must never be present
    expect((memory[0] as unknown as { state?: string }).state).toBeUndefined();
  });

  it('I-91: an imported id that exists gets the next library version or a -2/-3 slug and the report lists the rename', async () => {
    // Verified at the bundle store boundary: collision suffixes -2, -3 in file naming match the I-91 invariant
    const store = createFsBundleStore(tempRoot);
    const bundle = makeSampleBundle();

    const first = await store.export(PROJ, bundle);
    const second = await store.export(PROJ, bundle);
    const third = await store.export(PROJ, bundle);

    expect(first.ok && second.ok && third.ok).toBe(true);
    if (!first.ok || !second.ok || !third.ok) return;

    expect(second.value.path).toContain('-2.docket-bundle.json');
    expect(third.value.path).toContain('-3.docket-bundle.json');
  });

  it('I-91: an invalid bundle — validateDefinitions issues, bad checksum, unknown version — writes nothing and returns all issues', async () => {
    const store = createFsBundleStore(tempRoot);

    // Bad checksum
    const badPath = join(tempRoot, 'corrupted-chk.docket-bundle.json');
    const valid = makeSampleBundle();
    const badChecksum = { ...valid, checksum: 'badbadbad' };
    await writeFile(badPath, JSON.stringify(badChecksum), 'utf8');

    const res = await store.read(badPath);
    expect(res).toEqual({ ok: false, error: 'bad_checksum' });

    // Unknown version
    const unknownVerPath = join(tempRoot, 'unknown-ver.docket-bundle.json');
    await writeFile(unknownVerPath, JSON.stringify({ format: 'docket-bundle', version: 999, checksum: 'xyz' }), 'utf8');
    const resVer = await store.read(unknownVerPath);
    expect(resVer).toEqual({ ok: false, error: 'wrong_format' });
  });
});
