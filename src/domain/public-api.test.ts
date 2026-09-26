import { describe, expect, it } from 'vitest';
import * as domain from './index';

// The runtime surface of the docs/v2/domain.md contract: every function (sections 1–12) and every
// constant it names, listed explicitly so a dropped or renamed export fails here by name. Types are
// compile-time only and are enforced by typecheck against the same doc.
const CONTRACT_FUNCTIONS = [
  // shared (section 1)
  'ok',
  'err',
  'parseSlug',
  'parseUlid',
  'isSlug',
  'isUlid',
  // definitions (section 2)
  'validateDefinitions',
  // resolver (section 3)
  'resolve',
  'applyRoleOverrides',
  'resolveBinding',
  // gates (section 4)
  'evaluateGate',
  // flow (section 5)
  'deriveWorkOrderState',
  'nextAction',
  // quota (section 6)
  'matchesModel',
  'poolsForModel',
  'normalizedRemaining',
  'isStale',
  'headroom',
  'decideOnLimit',
  // budget (section 7)
  'spendStatus',
  'combinedSpendStatus',
  // dispatch (section 8)
  'decideDispatch',
  // proposal (section 9)
  'decideProposal',
  // roadmap (section 10)
  'validateRoadmap',
  'deriveRoadmap',
  // providers (section 11)
  'supportTier',
  'foldRun',
] as const;

const CONTRACT_CONSTANTS = [
  // shared (section 1)
  'MINUTE',
  'HOUR',
  // resolver (section 3)
  'LEVEL_ORDER',
  // gates (section 4)
  'GATE_EVALUATORS',
  // quota (section 6)
  'RESUME_JITTER_MS',
  // library (section 12)
  'BUILTIN_ROLES',
  'BUILTIN_FLOWS',
  'BUILTIN_COMMAND_SET_NAMES',
] as const;

const api: Record<string, unknown> = { ...domain };

describe('domain public API — docs/v2/domain.md contract', () => {
  it('exports every function named in the contract', () => {
    expect(CONTRACT_FUNCTIONS.filter((name) => typeof api[name] !== 'function')).toEqual([]);
  });

  it('exports every constant named in the contract', () => {
    expect(CONTRACT_CONSTANTS.filter((name) => api[name] === undefined)).toEqual([]);
  });
});
