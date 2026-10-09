// library/flows.ts — built-in flows shipped as editable data. Contract: docs/v2/domain.md section 12.
// Stage ids, gate ids, gate kinds, and onFail follow the contract text exactly.
import type { FlowSlug, GateSlug, RoleSlug, StageSlug } from '../shared/index';
import type { FlowDef } from '../definitions/index';

// Hard-coded slugs; the R-45 test (validateDefinitions over the whole library) parses every id
// at runtime, so the assertion cannot drift out of the slug pattern.
const asFlow = (id: string): FlowSlug => id as FlowSlug;
const asStage = (id: string): StageSlug => id as StageSlug;
const asRole = (id: string): RoleSlug => id as RoleSlug;
const asGate = (id: string): GateSlug => id as GateSlug;

/** Command sets the built-in flows reference; a repo must define them to use those flows. */
export const BUILTIN_COMMAND_SET_NAMES: readonly string[] = ['tests'];

export const BUILTIN_FLOWS: readonly FlowDef[] = [
  {
    id: asFlow('standard'),
    name: 'Standart',
    stages: [
      {
        id: asStage('plan'),
        name: 'Planlama',
        role: asRole('planner'),
        exit: [{ kind: 'human', id: asGate('plan-approval'), label: 'Plan onayı' }],
      },
      {
        id: asStage('implement'),
        name: 'Uygulama',
        role: asRole('developer'),
        exit: [
          { kind: 'changes', id: asGate('changes') },
          { kind: 'command', id: asGate('tests'), commandSet: 'tests' },
          { kind: 'secret_scan', id: asGate('secrets') },
        ],
        onFail: { goto: asStage('implement'), maxAttempts: 3 },
      },
      {
        id: asStage('review'),
        name: 'Gözden geçirme',
        role: asRole('reviewer'),
        tier: 'strong',
        reviewOf: asStage('implement'),
        exit: [
          { kind: 'agent_verdict', id: asGate('review-verdict'), role: asRole('reviewer') },
          { kind: 'human', id: asGate('review-approval'), label: 'Gözden geçirme onayı' },
        ],
        onFail: { goto: asStage('implement'), maxAttempts: 3 },
      },
      {
        id: asStage('close'),
        name: 'Kapatma',
        role: null,
        exit: [{ kind: 'human', id: asGate('closure'), label: 'Kapanış onayı' }],
      },
    ],
  },
  {
    id: asFlow('quick-fix'),
    name: 'Hızlı düzeltme',
    stages: [
      {
        id: asStage('implement'),
        name: 'Uygulama',
        role: asRole('developer'),
        exit: [
          { kind: 'command', id: asGate('tests'), commandSet: 'tests' },
          { kind: 'secret_scan', id: asGate('secrets') },
        ],
        onFail: { goto: asStage('implement'), maxAttempts: 3 },
      },
      {
        id: asStage('close'),
        name: 'Kapatma',
        role: null,
        exit: [{ kind: 'human', id: asGate('closure'), label: 'Kapanış onayı' }],
      },
    ],
  },
  {
    id: asFlow('security-reviewed'),
    name: 'Güvenlik incelemeli',
    stages: [
      {
        id: asStage('plan'),
        name: 'Planlama',
        role: asRole('planner'),
        exit: [{ kind: 'human', id: asGate('plan-approval'), label: 'Plan onayı' }],
      },
      {
        id: asStage('implement'),
        name: 'Uygulama',
        role: asRole('developer'),
        exit: [
          { kind: 'command', id: asGate('tests'), commandSet: 'tests' },
          { kind: 'secret_scan', id: asGate('secrets') },
        ],
        onFail: { goto: asStage('implement'), maxAttempts: 3 },
      },
      {
        id: asStage('security'),
        name: 'Güvenlik incelemesi',
        role: asRole('security-auditor'),
        tier: 'strong',
        reviewOf: asStage('implement'),
        exit: [
          { kind: 'agent_verdict', id: asGate('security-verdict'), role: asRole('security-auditor') },
          { kind: 'human', id: asGate('security-approval'), label: 'Güvenlik onayı' },
        ],
        onFail: { goto: asStage('implement'), maxAttempts: 3 },
      },
      {
        id: asStage('review'),
        name: 'Gözden geçirme',
        role: asRole('reviewer'),
        tier: 'strong',
        reviewOf: asStage('implement'),
        exit: [
          { kind: 'agent_verdict', id: asGate('review-verdict'), role: asRole('reviewer') },
          { kind: 'human', id: asGate('review-approval'), label: 'Gözden geçirme onayı' },
        ],
        onFail: { goto: asStage('implement'), maxAttempts: 3 },
      },
      {
        id: asStage('close'),
        name: 'Kapatma',
        role: null,
        exit: [{ kind: 'human', id: asGate('closure'), label: 'Kapanış onayı' }],
      },
    ],
  },
  {
    id: asFlow('research'),
    name: 'Araştırma',
    stages: [
      {
        id: asStage('research'),
        name: 'Araştırma',
        role: asRole('analyst'),
        exit: [{ kind: 'page_approval', id: asGate('findings'), label: 'Bulgular onayı' }],
      },
    ],
  },
];
