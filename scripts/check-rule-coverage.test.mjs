// Self-test for duplicate rule-id detection in check-rule-coverage.mjs. Run via that script's entrypoint
// (check:boundaries) or: node --test scripts/check-rule-coverage.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { duplicateRuleDefinitionIds } from './check-rule-coverage.mjs';

test('duplicateRuleDefinitionIds reports the same (added) id twice', () => {
  const fixture = [
    '- **R-1** (added 2026-01-01, #1) first.',
    '- **R-1** (added 2026-01-02, #2) second.',
  ].join('\n');
  assert.deepEqual(duplicateRuleDefinitionIds(fixture), ['R-1']);
});

test('duplicateRuleDefinitionIds ignores amended bullets and distinct ids', () => {
  const fixture = [
    '- **A-1** (added 2026-01-01, #1) first.',
    '- **A-1** (amended 2026-01-02, #2) amendment.',
    '- **A-2** (added 2026-01-01, #3) other.',
  ].join('\n');
  assert.deepEqual(duplicateRuleDefinitionIds(fixture), []);
});

test('duplicateRuleDefinitionIds passes on the real docs tree', () => {
  assert.deepEqual(duplicateRuleDefinitionIds(), []);
});
