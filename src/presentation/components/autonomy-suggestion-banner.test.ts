// components/autonomy-suggestion-banner.test.ts — U-335 of docs/v2/ui.md (D-10 chain b):
// the suggestion banner on work order detail, confirm and decline affordances, restrictive stage listing,
// refusal text, and the "önerir: auto" tag on the flow library row. U-336 (chain c) adds the flow
// editor's read-only stage tag: "önerir: auto" for a suggesting stage, the level name for a
// restrictive one, nothing when the stage carries no autonomy.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AutonomySuggestionBanner, FlowEditorStageRow, FlowLibraryRow } from './autonomy-suggestion-banner';
import { TR } from '../labels/tr';
import { EN } from '../labels/en';
import type { FlowDef, Slug } from '../../domain/index';
import { parseSlug } from '../../domain/index';
import type { WorkOrderDetailAutonomy } from '../stores/work-order-detail';

const slugOf = <B extends string>(val: string): Slug<B> => {
  const p = parseSlug<B>(val);
  if (!p.ok) throw new Error(`Invalid slug: ${val}`);
  return p.value;
};

const SAMPLE_FLOW: FlowDef = {
  id: slugOf('standard'),
  name: 'Standard flow',
  stages: [
    { id: slugOf('build'), name: 'Build', role: null, exit: [] },
  ],
};

describe('AutonomySuggestionBanner and FlowLibraryRow (U-335)', () => {
  it('U-335: suggestion banner on work order detail displays copy and buttons when suggestion is auto and level is not auto', () => {
    const view: WorkOrderDetailAutonomy = {
      level: 'manual',
      source: 'builtin',
      layerSet: false,
      suggestion: 'auto',
    };
    const htmlTr = renderToStaticMarkup(
      createElement(AutonomySuggestionBanner, {
        locale: 'tr',
        view,
        onConfirm: async () => undefined,
      }),
    );
    expect(htmlTr).toContain(TR['autonomy.suggestion.banner']);
    expect(htmlTr).toContain(TR['autonomy.suggestion.confirm']);
    expect(htmlTr).toContain(TR['autonomy.suggestion.decline']);
    expect(htmlTr).not.toContain('role="alert"');
    expect(htmlTr).not.toContain('text-error');

    const htmlEn = renderToStaticMarkup(
      createElement(AutonomySuggestionBanner, {
        locale: 'en',
        view,
        onConfirm: async () => undefined,
      }),
    );
    expect(htmlEn).toContain(EN['autonomy.suggestion.banner']);
    expect(htmlEn).toContain(EN['autonomy.suggestion.confirm']);
    expect(htmlEn).toContain(EN['autonomy.suggestion.decline']);
  });

  it('U-335: suggestion banner is never shown when effective level is already auto, or when flow does not suggest auto', () => {
    // Already auto
    const alreadyAuto: WorkOrderDetailAutonomy = {
      level: 'auto',
      source: 'workOrder',
      layerSet: true,
      suggestion: 'auto',
    };
    expect(
      renderToStaticMarkup(
        createElement(AutonomySuggestionBanner, {
          locale: 'tr',
          view: alreadyAuto,
          onConfirm: async () => undefined,
        }),
      ),
    ).toBe('');

    // No suggestion
    const noSuggestion: WorkOrderDetailAutonomy = {
      level: 'manual',
      source: 'builtin',
      layerSet: false,
    };
    expect(
      renderToStaticMarkup(
        createElement(AutonomySuggestionBanner, {
          locale: 'tr',
          view: noSuggestion,
          onConfirm: async () => undefined,
        }),
      ),
    ).toBe('');
  });

  it('U-335: the confirm text lists the stages whose definition carries a restriction manual or balanced', () => {
    const withRestrictions: WorkOrderDetailAutonomy = {
      level: 'manual',
      source: 'builtin',
      layerSet: false,
      suggestion: 'auto',
      restrictiveStages: ['review', 'security'],
    };
    const html = renderToStaticMarkup(
      createElement(AutonomySuggestionBanner, {
        locale: 'tr',
        view: withRestrictions,
        onConfirm: async () => undefined,
      }),
    );
    expect(html).toContain('review, security');
    expect(html).toContain(TR['autonomy.suggestion.restrictiveConfirmNote']);

    const htmlEn = renderToStaticMarkup(
      createElement(AutonomySuggestionBanner, {
        locale: 'en',
        view: withRestrictions,
        onConfirm: async () => undefined,
      }),
    );
    expect(htmlEn).toContain('review, security');
    expect(htmlEn).toContain(EN['autonomy.suggestion.restrictiveConfirmNote']);
  });

  it('U-335: flow library row shows a small "önerir: auto" tag when pinned FlowDef suggests it', () => {
    const suggestingFlow: FlowDef = {
      ...SAMPLE_FLOW,
      autonomy: 'auto',
    };
    const plainFlow: FlowDef = {
      ...SAMPLE_FLOW,
    };

    const rowTr = renderToStaticMarkup(
      createElement(FlowLibraryRow, { locale: 'tr', flow: suggestingFlow, version: 1 }),
    );
    expect(rowTr).toContain('önerir: auto');
    expect(rowTr).toContain('v1');
    expect(rowTr).toContain('Standard flow');

    const rowEn = renderToStaticMarkup(
      createElement(FlowLibraryRow, { locale: 'en', flow: suggestingFlow }),
    );
    expect(rowEn).toContain('suggests: auto');

    const plainRow = renderToStaticMarkup(
      createElement(FlowLibraryRow, { locale: 'tr', flow: plainFlow }),
    );
    expect(plainRow).not.toContain('önerir: auto');
  });
});

describe('FlowEditorStageRow (U-336)', () => {
  it('U-336: a stage whose autonomy is auto shows the read-only "önerir: auto" tag', () => {
    const htmlTr = renderToStaticMarkup(
      createElement(FlowEditorStageRow, {
        locale: 'tr',
        stage: { ...SAMPLE_FLOW.stages[0], autonomy: 'auto' },
      }),
    );
    expect(htmlTr).toContain('Build');
    expect(htmlTr).toContain(TR['autonomy.tag.suggestsAuto']);
    expect(htmlTr).toContain('data-stage-autonomy-tag');
    // The tag is never a control there: no input, no button rides the row.
    expect(htmlTr).not.toContain('<button');
    expect(htmlTr).not.toContain('<select');

    const htmlEn = renderToStaticMarkup(
      createElement(FlowEditorStageRow, {
        locale: 'en',
        stage: { ...SAMPLE_FLOW.stages[0], autonomy: 'auto' },
      }),
    );
    expect(htmlEn).toContain(EN['autonomy.tag.suggestsAuto']);
  });

  it('U-336: a restrictive stage names its level, an unset stage draws no tag', () => {
    const manualRow = renderToStaticMarkup(
      createElement(FlowEditorStageRow, {
        locale: 'tr',
        stage: { ...SAMPLE_FLOW.stages[0], autonomy: 'manual' },
      }),
    );
    expect(manualRow).toContain(TR['autonomy.level.manual']);
    expect(manualRow).not.toContain(TR['autonomy.tag.suggestsAuto']);

    const balancedRow = renderToStaticMarkup(
      createElement(FlowEditorStageRow, {
        locale: 'tr',
        stage: { ...SAMPLE_FLOW.stages[0], autonomy: 'balanced' },
      }),
    );
    expect(balancedRow).toContain(TR['autonomy.level.balanced']);

    const unsetRow = renderToStaticMarkup(
      createElement(FlowEditorStageRow, { locale: 'tr', stage: SAMPLE_FLOW.stages[0] }),
    );
    expect(unsetRow).toContain('Build');
    expect(unsetRow).not.toContain('data-stage-autonomy-tag');
  });
});
