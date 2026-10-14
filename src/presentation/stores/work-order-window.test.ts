// work-order-window.test.ts — U-290, U-291 for the new work order dialog store and markup.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { filterSkippableStageIds, type FlowDef, type GateDef, type EnvSlug, type FlowSlug, type GateSlug, type RoleSlug, type StageSlug } from '../../domain/index';
import { NewWorkOrderWindow } from '../components/new-work-order-window';
import { t } from '../labels/t';
import {
  boardFlowChoices,
  openedWorkOrderForm,
  pinnedFlowFromColumns,
  stageSkipLedgerEvents,
  workOrderFormReducer,
  type PinnedFlowView,
  type StageSkipProposalCard,
} from './work-order-window';

const stageOf = (id: string): StageSlug => id as StageSlug;
const gateOf = (id: string): GateSlug => id as GateSlug;
const roleOf = (id: string): RoleSlug => id as RoleSlug;
const flowOf = (id: string): FlowSlug => id as FlowSlug;

const HUMAN: GateDef = { kind: 'human', id: gateOf('approval'), label: 'Onay' };
const DEPLOY: GateDef = { kind: 'deploy', id: gateOf('deploy'), environment: 'stg' as EnvSlug };
const COMMAND: GateDef = { kind: 'command', id: gateOf('tests'), commandSet: 'tests' };

const SKIP_FLOW: FlowDef = {
  id: flowOf('fixture'),
  name: 'Fixture',
  stages: [
    { id: stageOf('plan'), name: 'Plan', role: roleOf('planner'), exit: [HUMAN] },
    { id: stageOf('review'), name: 'Review', role: roleOf('reviewer'), exit: [COMMAND] },
    { id: stageOf('ship'), name: 'Ship', role: roleOf('developer'), exit: [DEPLOY] },
  ],
};

const PINNED: PinnedFlowView = pinnedFlowFromColumns('standard', 2, [
  { stage: 'plan', name: 'Plan' },
  { stage: 'review', name: 'Review' },
  { stage: 'ship', name: 'Ship' },
]);

const renderWindow = (skipProposal: StageSkipProposalCard | null): string =>
  renderToStaticMarkup(
    createElement(NewWorkOrderWindow, {
      open: true,
      locale: 'tr',
      projectName: 'Kadife Odoo',
      flows: boardFlowChoices('standard'),
      pinnedFlow: PINNED,
      skipProposal,
      launchProject: 'kadife',
      onClose: () => undefined,
      onCreated: () => undefined,
      onCreate: () => Promise.resolve({ ok: true as const }),
    }),
  );

describe('new work order window (U-290, U-291)', () => {
  it('U-290: new work order dialog renders fixed read-only flow strip without flow selector', () => {
    const html = renderWindow(null);
    expect(html).toContain('role="dialog"');
    expect(html).not.toContain('<select');
    expect(html).toContain(t('tr', 'workOrder.flowStrip.label'));
    expect(html).toContain('role="region"');
    expect(html).toContain(t('tr', 'workOrder.create'));
    expect(html).toContain(t('tr', 'workOrder.cancel'));
  });

  it('U-290: flow strip displays pinned flow and role versions', () => {
    const html = renderWindow(null);
    expect(html).toContain('Sürüm 2');
    expect(html).toContain('Plan');
    expect(html).toContain('Review');
  });

  it('U-291: planner stage-skip card appears only when skip proposal exists', () => {
    expect(renderWindow(null)).not.toContain(t('tr', 'workOrder.skipProposal.title'));
    expect(renderWindow({ stages: ['review'], reason: 'Küçük düzeltme' })).toContain(t('tr', 'workOrder.skipProposal.title'));
  });

  it('U-291: stage-skip card displays proposed stages, reason, and Atla/Atlama buttons', () => {
    const html = renderWindow({ stages: ['review'], reason: 'Testler zaten yeşil' });
    expect(html).toContain('Testler zaten yeşil');
    expect(html).toContain('Review');
    expect(html).toContain(t('tr', 'workOrder.skipProposal.skip'));
    expect(html).toContain(t('tr', 'workOrder.skipProposal.doNotSkip'));
  });

  it('U-291: deploy and human-gate stages are strictly excluded from skipping', () => {
    expect(filterSkippableStageIds(SKIP_FLOW, [stageOf('plan'), stageOf('review'), stageOf('ship')])).toEqual([
      stageOf('review'),
    ]);
  });

  it('U-291: Atla marks stages skipped in form state; Atlama dismisses the proposal', () => {
    let state = openedWorkOrderForm({ title: '', description: '' }, boardFlowChoices('standard'));
    state = workOrderFormReducer(state, { type: 'skip_approve', stages: ['review'] });
    expect(state.skippedStageIds).toEqual(['review']);
    expect(state.skipDecision).toBe('approved');
    state = workOrderFormReducer(state, { type: 'skip_reject' });
    expect(state.skippedStageIds).toEqual([]);
    expect(state.skipDecision).toBe('rejected');
  });

  it('R-133: stage-skip proposal and decision recorded as ledger events', () => {
    const events = stageSkipLedgerEvents(100, [stageOf('review')], 'tests green', true);
    expect(events).toEqual([
      { type: 'stage_skip_proposed', at: 100, stages: [stageOf('review')], reason: 'tests green' },
      { type: 'stage_skip_decided', at: 100, approved: true },
    ]);
  });
});
