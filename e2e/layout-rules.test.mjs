// e2e/layout-rules.test.mjs — the size plan's pure logic, proven without Electron. Run:
// npm run test:e2e-sizes (node:test; not part of vitest, which covers src/ and electron/ only).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { SIZE_PLAN, resolveSizes, sizeFromPlan, sizesForWorkArea } from './layout-rules.mjs';

test('the plan holds three named sizes, full screen being the display itself', () => {
  assert.deepEqual(
    SIZE_PLAN.map(({ name }) => name),
    ['minimum', 'default', 'fullscreen'],
  );
  assert.deepEqual(SIZE_PLAN[0].size, [1024, 640]);
  assert.deepEqual(SIZE_PLAN[1].size, [1152, 720]);
  assert.equal(SIZE_PLAN[2].size, 'display');
});

test('a number size passes through unchanged on a display that can hold it', () => {
  assert.deepEqual(sizeFromPlan([1024, 640], { width: 1512, height: 920 }), [1024, 640]);
  assert.deepEqual(sizeFromPlan([1152, 720], { width: 2560, height: 1440 }), [1152, 720]);
});

test("'display' resolves to the work area itself", () => {
  assert.deepEqual(sizeFromPlan('display', { width: 1512, height: 920 }), [1512, 920]);
});

test('every size is clamped down to a work area smaller than it', () => {
  const tiny = { width: 1000, height: 600 };
  assert.deepEqual(sizeFromPlan([1024, 640], tiny), [1000, 600]);
  assert.deepEqual(sizeFromPlan([1152, 720], tiny), [1000, 600]);
  assert.deepEqual(sizeFromPlan('display', tiny), [1000, 600]);
});

test('sizesForWorkArea pairs each plan name with its concrete size', () => {
  assert.deepEqual(sizesForWorkArea({ width: 1920, height: 1080 }), [
    { name: 'minimum', size: [1024, 640] },
    { name: 'default', size: [1152, 720] },
    { name: 'fullscreen', size: [1920, 1080] },
  ]);
});

test('resolveSizes reads the primary display through the app and resolves the plan', async () => {
  // A stand-in for the Playwright electron handle: `evaluate` hands the main-process electron
  // module to the callback, exactly as the real one does.
  const fakeApp = {
    evaluate: (fn) => fn({ screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1512, height: 920 } }) } }),
  };
  assert.deepEqual(await resolveSizes(fakeApp), [
    { name: 'minimum', size: [1024, 640] },
    { name: 'default', size: [1152, 720] },
    { name: 'fullscreen', size: [1512, 920] },
  ]);
});
