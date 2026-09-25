// src/adapters/cli-runner/discover.test.ts — auto-discovery against REAL temp directories
// (WO-0107 / Faz D): fake executables with the X bit, a scripted PATH, a faked home — the
// probes exercise the actual fs, the way they run.
import { afterAll, describe, expect, it } from 'vitest';
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { binEnvKey, candidatesOf } from './def';
import { detectOne, detectVendors, pathDirs, wellKnownDirs, type VendorDetection } from './discover';

const DIR = mkdtempSync(join(tmpdir(), 'docket-discover-'));
afterAll(() => rmSync(DIR, { recursive: true, force: true }));

const makeBin = (dir: string, name: string, executable = true): string => {
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, '#!/bin/sh\n');
  chmodSync(p, executable ? 0o755 : 0o644);
  return p;
};

const DEF = { id: 'probe-cli', bin: 'probe-cli', fallbackBins: ['probe-cli-alt'] as const };

describe('pathDirs + wellKnownDirs (the dir union)', () => {
  it('PATH entries split, dedupe, drop empties — order preserved (the PATH the app got wins first)', () => {
    expect(pathDirs('/a:/b:/a::/c')).toEqual(['/a', '/b', '/c']);
    expect(pathDirs(undefined)).toEqual([]);
  });

  it('the well-known set: brew arms, ~/.local, ~/.bun, ~/.volta, ~/bin, every nvm node — newest first, PATH-covered dirs dropped', () => {
    const dirs = wellKnownDirs({
      home: '/h',
      platform: 'darwin',
      pathEnv: '/opt/homebrew/bin:/unrelated',
      listDir: (p) => (p === '/h/.nvm/versions/node' ? ['v20.1.0', 'v22.3.0', 'v18.0.0'] : []),
    });
    expect(dirs).toEqual([
      '/usr/local/bin',
      '/h/.local/bin',
      '/h/.bun/bin',
      '/h/.volta/bin',
      '/h/bin',
      // nvm newest-first; /opt/homebrew/bin already rode PATH
      '/h/.nvm/versions/node/v22.3.0/bin',
      '/h/.nvm/versions/node/v20.1.0/bin',
      '/h/.nvm/versions/node/v18.0.0/bin',
    ]);
  });

  it('non-unix platforms carry NO well-known set (named: win32 dirs ride a later Route V pass)', () => {
    expect(wellKnownDirs({ home: '/h', platform: 'win32', pathEnv: '' })).toEqual([]);
  });
});

describe('detectOne — one vendor through the dir union', () => {
  it('the PATH arm: the first executable in PATH ORDER wins (source: path)', () => {
    const d1 = join(DIR, 'p1');
    const d2 = join(DIR, 'p2');
    makeBin(d1, 'probe-cli');
    makeBin(d2, 'probe-cli');
    const r = detectOne(DEF, { path: [d2, d1], wellKnown: [] });
    expect(r).toEqual({ id: 'probe-cli', path: join(d2, 'probe-cli'), source: 'path' });
  });

  it('the well-known arm: found when PATH misses (source: well-known) — the GUI-thin-PATH case', () => {
    const wk = join(DIR, 'wk');
    makeBin(wk, 'probe-cli');
    expect(detectOne(DEF, { path: [], wellKnown: [wk] })).toEqual({ id: 'probe-cli', path: join(wk, 'probe-cli'), source: 'well-known' });
  });

  it('fallbackBins ride the same arms; a non-executable file never matches; nothing found → honest null', () => {
    const noExec = join(DIR, 'noexec');
    makeBin(noExec, 'probe-cli', false);
    makeBin(noExec, 'probe-cli-alt');
    expect(detectOne(DEF, { path: [noExec], wellKnown: [] })).toEqual({ id: 'probe-cli', path: join(noExec, 'probe-cli-alt'), source: 'path' });
    expect(detectOne(DEF, { path: [], wellKnown: [] })).toEqual({ id: 'probe-cli', path: null, source: null });
  });

  it('the <ID>_BIN override outranks everything (source: override)', () => {
    const overrideDir = join(DIR, 'ovr');
    const p = makeBin(overrideDir, 'anything');
    process.env.PROBE_CLI_BIN = p;
    try {
      const pathArm = join(DIR, 'patharm');
      makeBin(pathArm, 'probe-cli');
      expect(detectOne(DEF, { path: [pathArm], wellKnown: [] })).toEqual({ id: 'probe-cli', path: p, source: 'override' });
    } finally {
      delete process.env.PROBE_CLI_BIN;
    }
  });
});

describe('detectVendors — streaming one result per vendor', () => {
  it('results stream per-vendor (never batched), unfound vendors stream their null, order is the input order', async () => {
    const dirA = join(DIR, 'stream-a');
    const dirB = join(DIR, 'stream-b');
    makeBin(dirA, 'v-one');
    makeBin(dirB, 'v-three'); // v-two: found nowhere — its null still STREAMS (a row clears its spinner)
    const seen: VendorDetection[] = [];
    const prevPath = process.env.PATH;
    process.env.PATH = [dirA, dirB].join(':');
    try {
      const results = await detectVendors(
        [
          { id: 'v-one', bin: 'v-one' },
          { id: 'v-two', bin: 'v-two' },
          { id: 'v-three', bin: 'v-three' },
        ],
        { home: '/nonexistent-home', onResult: (r) => seen.push(r) },
      );
      expect(results.map((r) => [r.id, r.path !== null])).toEqual([
        ['v-one', true],
        ['v-two', false],
        ['v-three', true],
      ]);
      expect(seen).toHaveLength(3);
      expect(new Set(seen.map((r) => r.id)).size).toBe(3); // one result per vendor, never batched
    } finally {
      process.env.PATH = prevPath;
    }
  });
});

describe('candidatesOf — the shared try-order (spawn + discovery)', () => {
  it('override first, then bin, then fallbacks; unset override drops out', () => {
    process.env.PROBE_CLI_BIN = '/ovr/probe-cli';
    try {
      expect(candidatesOf(DEF)).toEqual(['/ovr/probe-cli', 'probe-cli', 'probe-cli-alt']);
    } finally {
      delete process.env.PROBE_CLI_BIN;
    }
    expect(candidatesOf(DEF)).toEqual(['probe-cli', 'probe-cli-alt']);
  });

  it('binEnvKey uppercases and dash-joins (codex → CODEX_BIN, my-tool → MY_TOOL_BIN)', () => {
    expect(binEnvKey('codex')).toBe('CODEX_BIN');
    expect(binEnvKey('my-tool')).toBe('MY_TOOL_BIN');
  });
});
