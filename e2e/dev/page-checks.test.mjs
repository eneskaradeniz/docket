// e2e/dev/page-checks.test.mjs — the page checks' policies, proven without a page. Run:
// node --test e2e/dev/page-checks.test.mjs (node:test; not part of vitest, which covers src/ and
// electron/ only — the same standing as e2e/layout-rules.test.mjs).
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  MIN_TARGET_PX,
  PAGE_CHECK_IDS,
  pc1Failures,
  pc2Failures,
  pc3Failures,
  pc4Failures,
  verdictsFromMeasurements,
} from './page-checks.mjs';

test('the check ids are the four rules the dev session walks', () => {
  assert.deepEqual(PAGE_CHECK_IDS, ['PC-1', 'PC-2', 'PC-3', 'PC-4']);
});

test('PC-1: an interactive control without an accessible name fails', () => {
  const named = [{ tag: 'button', name: 'Kaydet' }, { tag: 'input', name: 'Ara' }];
  assert.deepEqual(pc1Failures(named), []);
  const unnamed = [
    { tag: 'button', name: '' },
    { tag: 'a', name: '   ' },
    { tag: 'select', name: '' },
  ];
  assert.equal(pc1Failures(unnamed).length, 3);
});

test('PC-2: a focusable control hidden by an ancestor fails unless the ancestor is inert', () => {
  // The pilot's case: a collapsed (zero-height) ancestor still reachable by Tab.
  const collapsedButFocusable = { desc: 'button in collapsed body', cause: 'ancestor-zero-height', inert: false };
  assert.deepEqual(pc2Failures([collapsedButFocusable]), [collapsedButFocusable]);

  // aria-hidden with inert is the documented, correct way to hide and unfocus at once.
  assert.deepEqual(pc2Failures([{ desc: 'dialog', cause: 'aria-hidden', inert: true }]), []);

  // Hidden by visibility without inert is still reachable.
  assert.equal(pc2Failures([{ desc: 'link', cause: 'visibility-hidden', inert: false }]).length, 1);

  // Nothing hidden, nothing to report.
  assert.deepEqual(pc2Failures([{ desc: 'button', cause: null, inert: false }]), []);
});

test('PC-3: an interactive target smaller than 24x24 CSS px fails', () => {
  assert.deepEqual(pc3Failures([{ desc: 'ok', width: 24, height: 24 }, { desc: 'big', width: 40, height: 40 }]), []);
  assert.equal(pc3Failures([{ desc: 'narrow', width: 20, height: 30 }]).length, 1);
  assert.equal(pc3Failures([{ desc: 'short', width: 30, height: 23.4 }]).length, 1);
  assert.equal(MIN_TARGET_PX, 24);
});

test('PC-4: an element crossing the viewport fails; one flush with the edge passes', () => {
  const vw = 1024;
  const vh = 720;
  const inside = { desc: 'card', left: 10, top: 10, right: 100, bottom: 50, vw, vh };
  const flush = { desc: 'edge', left: 0, top: 0, right: vw, bottom: vh, vw, vh };
  assert.deepEqual(pc4Failures([inside, flush]), []);
  assert.equal(pc4Failures([{ desc: 'past right', left: 10, top: 0, right: vw + 4, bottom: 20, vw, vh }]).length, 1);
  assert.equal(pc4Failures([{ desc: 'above top', left: 0, top: -3, right: 20, bottom: 20, vw, vh }]).length, 1);
});

test('verdictsFromMeasurements answers one row per check id in the rules\' own shape', () => {
  const verdicts = verdictsFromMeasurements({
    unnamed: [{ tag: 'button', name: '' }],
    hiddenReachable: [],
    smallTargets: [],
    crossing: [],
  });
  assert.deepEqual(verdicts.map((v) => v.id), PAGE_CHECK_IDS);
  assert.equal(verdicts[0].ok, false);
  for (const verdict of verdicts.slice(1)) assert.equal(verdict.ok, true);
  for (const verdict of verdicts) {
    assert.equal(typeof verdict.detail, 'string');
    assert.ok(verdict.detail.length > 0);
  }
});
