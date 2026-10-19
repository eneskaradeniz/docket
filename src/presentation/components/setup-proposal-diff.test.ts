/// <reference types="vite/client" />
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { FlowSlug, StageSlug } from '../../domain/index';
import { buildSetupProposal, type SetupProposal } from '../stores/new-project';
import { sectionBody, sectionDetail, SetupProposalDiff } from './setup-proposal-diff';

describe('SetupProposalDiff (U-364)', () => {
  it('U-364: sectionBody returns concise summary for header badges', () => {
    const proposal = buildSetupProposal('Atolye', '/Users/e/atolye');
    expect(sectionBody(proposal, 'flow')).toBe('standard');
    expect(sectionBody(proposal, 'roles')).toBe(String(proposal.repo.flow.bindings.length));
    expect(sectionBody(proposal, 'limits')).toBe('wait_resume');
    expect(sectionBody(proposal, 'commands')).toBe('tests');
  });

  it('U-364: sectionDetail formats pipeline, bindings, limits, and command sets', () => {
    const proposal = buildSetupProposal('Atolye', '/Users/e/atolye');
    const flowDetail = sectionDetail(proposal, 'flow');
    expect(flowDetail).toContain('→');
    expect(flowDetail).toBe(proposal.repo.flow.stages.map((s) => s.name || s.id).join(' → '));

    const rolesDetail = sectionDetail(proposal, 'roles');
    expect(rolesDetail).toBe(
      proposal.repo.flow.bindings
        .map((b) => (b.role !== undefined ? `${b.stage}: ${b.role.roleId}` : b.stage))
        .join(' · '),
    );

    expect(sectionDetail(proposal, 'limits')).toBe('wait_resume');

    // Default proposal has tests: []
    expect(sectionDetail(proposal, 'commands')).toBe('tests: —');
  });

  it('U-364: sectionDetail falls back when stages or bindings are empty', () => {
    const custom: SetupProposal = {
      project: { name: 'Empty', repos: ['empty'] },
      repo: {
        id: 'empty',
        flow: {
          flowId: 'custom-flow' as FlowSlug,
          version: 1,
          stages: [],
          bindings: [],
        },
        defaultLimitPolicy: 'ask',
        commandSets: {},
        docsRoot: 'docs',
        testGlobs: [],
      },
      warnings: [],
      differsFromRecommended: [],
    };

    expect(sectionDetail(custom, 'flow')).toBe('custom-flow');
    expect(sectionDetail(custom, 'roles')).toBe('0');
    expect(sectionDetail(custom, 'limits')).toBe('ask');
    expect(sectionDetail(custom, 'commands')).toBe('');
  });

  it('U-364: sectionDetail joins multiple commands with && and sets with ·', () => {
    const custom: SetupProposal = {
      project: { name: 'P', repos: ['p'] },
      repo: {
        id: 'p',
        flow: {
          flowId: 'standard' as FlowSlug,
          version: 1,
          stages: [{ id: 'plan' as StageSlug, name: 'Planlama', role: null, exit: [] }],
          bindings: [{ stage: 'plan' as StageSlug, accounts: [] }],
        },
        defaultLimitPolicy: 'wait_resume',
        commandSets: {
          tests: ['npm test', 'npm run e2e'],
          lint: ['eslint .'],
          empty: [],
        },
        docsRoot: 'docs',
        testGlobs: [],
      },
      warnings: [],
      differsFromRecommended: [],
    };

    expect(sectionDetail(custom, 'commands')).toBe('tests: npm test && npm run e2e · lint: eslint . · empty: —');
    expect(sectionDetail(custom, 'roles')).toBe('plan');
  });

  it('U-364: renders data-proposal-section-detail for each open section while collapsed sections show only header summary', () => {
    const proposal = buildSetupProposal('Atolye', '/Users/e/atolye');
    const htmlOpen = renderToStaticMarkup(
      createElement(SetupProposalDiff, {
        locale: 'tr',
        proposal,
        expanded: () => true,
        onToggle: () => undefined,
      }),
    );

    expect(htmlOpen).toContain('data-proposal-section-detail="flow"');
    expect(htmlOpen).toContain('data-proposal-section-detail="roles"');
    expect(htmlOpen).toContain('data-proposal-section-detail="limits"');
    expect(htmlOpen).toContain('data-proposal-section-detail="commands"');
    expect(htmlOpen).toContain(sectionDetail(proposal, 'flow'));
    expect(htmlOpen).toContain(sectionDetail(proposal, 'roles'));
    expect(htmlOpen).toContain(sectionDetail(proposal, 'commands'));

    const htmlClosed = renderToStaticMarkup(
      createElement(SetupProposalDiff, {
        locale: 'tr',
        proposal,
        expanded: () => false,
        onToggle: () => undefined,
      }),
    );

    expect(htmlClosed).not.toContain('data-proposal-section-detail');
  });
});
