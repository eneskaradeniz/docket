import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  WINDOW_DEFAULT_HEIGHT,
  WINDOW_DEFAULT_WIDTH,
  WINDOW_MIN_HEIGHT,
  WINDOW_MIN_WIDTH,
  clampDefaultWindowSize,
  quietWindowOptions,
  titleBarOptionsFor,
} from './window-options';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Tracked e2e source only. A local e2e run writes generated scripts under e2e/.out, and
 *  installed packages sit in node_modules; neither is a launcher the suite is guarding. */
export const includeInLaunchScan = (repoRelativePath: string): boolean => {
  const segments = repoRelativePath.split(/[/\\]/);
  if (segments.includes('node_modules')) return false;
  return !(segments[0] === 'e2e' && segments[1] === '.out');
};

/** Source files under e2e/ whose text contains needle. The scan is the guard that a new launcher
 *  cannot open Electron on its own and skip the quiet env. */
const e2eSourcesContaining = (needle: string): readonly string[] => {
  const hits: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (!includeInLaunchScan(relative(REPO_ROOT, path))) continue;
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.(mjs|cjs|js)$/.test(name)) continue;
      if (readFileSync(path, 'utf8').includes(needle)) hits.push(relative(REPO_ROOT, path));
    }
  };
  walk(join(REPO_ROOT, 'e2e'));
  return hits.sort();
};

describe('window default size', () => {
  it('opens at 1152x720 and never smaller than either minimum', () => {
    expect(WINDOW_DEFAULT_WIDTH).toBe(1152);
    expect(WINDOW_DEFAULT_HEIGHT).toBe(720);
    expect(WINDOW_DEFAULT_WIDTH).toBeGreaterThanOrEqual(WINDOW_MIN_WIDTH);
    expect(WINDOW_DEFAULT_HEIGHT).toBeGreaterThanOrEqual(WINDOW_MIN_HEIGHT);
  });
});

describe('clampDefaultWindowSize', () => {
  it('leaves the default unchanged on a display whose work area can hold it', () => {
    expect(clampDefaultWindowSize({ width: 1512, height: 920 })).toStrictEqual({
      width: 1152,
      height: 720,
    });
    expect(clampDefaultWindowSize({ width: 2560, height: 1440 })).toStrictEqual({
      width: 1152,
      height: 720,
    });
  });

  it('clamps the default down to a smaller work area that still holds the minimums', () => {
    expect(clampDefaultWindowSize({ width: 1100, height: 680 })).toStrictEqual({
      width: 1100,
      height: 680,
    });
  });

  it('never goes below the minimums, even when the work area cannot hold them', () => {
    expect(clampDefaultWindowSize({ width: 800, height: 400 })).toStrictEqual({
      width: 1024,
      height: 640,
    });
  });
});

describe('window minimum size', () => {
  it('is 1024x640 so the fixed 240px sidebar still leaves a 784px body column', () => {
    expect(WINDOW_MIN_WIDTH).toBe(1024);
    expect(WINDOW_MIN_HEIGHT).toBe(640);
  });
});

describe('titleBarOptionsFor', () => {
  it('darwin hides the native title strip and insets the traffic lights into the shell drag bar', () => {
    expect(titleBarOptionsFor('darwin')).toStrictEqual({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 14, y: 14 },
    });
  });

  it('every other platform keeps the default frame — no title bar options at all', () => {
    expect(titleBarOptionsFor('win32')).toStrictEqual({});
    expect(titleBarOptionsFor('linux')).toStrictEqual({});
  });
});

describe('quietWindowOptions', () => {
  it('U-257: returns options only for DOCKET_E2E_QUIET=1 when the app is not packaged', () => {
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: '1' }, false)).toBeDefined();
    expect(quietWindowOptions({}, false)).toBeUndefined();
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: undefined }, false)).toBeUndefined();
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: '0' }, false)).toBeUndefined();
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: '' }, false)).toBeUndefined();
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: 'true' }, false)).toBeUndefined();
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: '1' }, true)).toBeUndefined();
    expect(quietWindowOptions({}, true)).toBeUndefined();
    expect(quietWindowOptions({ DOCKET_E2E_QUIET: '0' }, true)).toBeUndefined();
  });

  it('U-258: quiet options are show false, opacity 0, ignore-mouse-events, no dock, no throttling, and never a focus or show call', () => {
    const options = quietWindowOptions({ DOCKET_E2E_QUIET: '1' }, false);
    const table = [
      ['show', false],
      ['opacity', 0],
      ['ignoreMouseEvents', true],
      ['skipTaskbar', true],
      ['hideDock', true],
      ['backgroundThrottling', false],
    ] as const;
    expect(options).toEqual({
      show: false,
      opacity: 0,
      ignoreMouseEvents: true,
      skipTaskbar: true,
      hideDock: true,
      backgroundThrottling: false,
    });
    if (options === undefined) throw new Error('quiet options missing');
    for (const [key, value] of table) expect(options[key]).toBe(value);
    expect(Object.keys(options).sort()).toEqual([...table.map(([key]) => key)].sort());
    for (const value of Object.values(options)) expect(typeof value).not.toBe('function');
    expect(Object.prototype.hasOwnProperty.call(options, 'focus')).toBe(false);
    expect(options.show).toBe(false);
    expect(JSON.stringify(options)).not.toMatch(/focus|\.show\(/);
  });

  it('U-259: every electron.launch under e2e goes through the shared helper that sets DOCKET_E2E_QUIET', () => {
    const launchSites = e2eSourcesContaining('electron.launch');
    expect(launchSites).toEqual(['e2e/quiet-launch.mjs']);
    expect(e2eSourcesContaining('_electron')).toEqual(['e2e/quiet-launch.mjs']);
    const quietSites = e2eSourcesContaining('DOCKET_E2E_QUIET');
    expect(quietSites).toEqual(['e2e/quiet-launch.mjs']);
    const helper = readFileSync(join(REPO_ROOT, 'e2e', 'quiet-launch.mjs'), 'utf8');
    expect(helper).toContain("DOCKET_E2E_QUIET = '1'");
    expect(helper).toContain("DOCKET_E2E_VISIBLE === '1'");
    expect(helper).toContain('electron.launch');
    expect(helper).not.toMatch(/\.focus\s*\(|\.show\s*\(/);
  });

  it('U-259: the launch scan ignores generated files under e2e/.out', () => {
    expect(includeInLaunchScan('e2e/.out/anything.mjs')).toBe(false);
    expect(includeInLaunchScan('e2e/quiet-launch.mjs')).toBe(true);
  });
});
