// components/autonomy-control.test.ts — U-334 of docs/v2/ui.md (D-10 chain a): the two offered
// levels with `balanced` hidden, the effective level's source line, `auto` disabled with the
// typed reason text, the clear-layer affordance, and the quiet render on an unreadable chain.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AutonomyControl, autonomyRefusalKey, autonomySourceKey } from './autonomy-control';
import { TR } from '../labels/tr';
import { EN } from '../labels/en';
import { LABEL_KEYS } from '../labels/keys';

const view = (over: Partial<Parameters<typeof AutonomyControl>[0]['view']> = {}) => ({
  level: 'manual' as const,
  source: 'builtin',
  layerSet: false,
  ...over,
});

const render = (over: Partial<Parameters<typeof AutonomyControl>[0]['view']>, locale: 'tr' | 'en' = 'tr') =>
  renderToStaticMarkup(
    createElement(AutonomyControl, {
      locale,
      view: view(over),
      mark: 'test',
      onPick: () => undefined,
      onClear: () => undefined,
    }),
  );

describe('AutonomyControl', () => {
  it('U-334: renders manual and auto only — balanced stays hidden until the level is offered', () => {
    const markup = render({ level: 'manual', source: 'builtin' });
    expect(markup).toContain(TR['autonomy.level.manual']);
    expect(markup).toContain(TR['autonomy.level.auto']);
    expect(markup).not.toContain('Dengeli');
    expect(markup).not.toContain('balanced');
    // No balanced key exists in the bundle at all yet — the control cannot name what is not offered.
    expect(LABEL_KEYS).not.toContain('autonomy.level.balanced');
  });

  it('U-334: shows the effective level with its source line — Kaynak: …', () => {
    expect(render({ level: 'manual', source: 'workOrder' })).toContain(TR['autonomy.source.workOrder']);
    expect(render({ level: 'auto', source: 'repo', layerSet: false })).toContain(TR['autonomy.source.repo']);
    expect(render({ level: 'manual', source: 'ceiling' })).toContain(TR['autonomy.source.ceiling']);
  });

  it('U-334: disables auto with the typed reason text when R-169/R-156 or the ceiling would refuse', () => {
    const blocked = render({ level: 'manual', source: 'builtin', autoUnavailable: 'auto_requires_spend_cap' });
    expect(blocked).toContain('disabled');
    expect(blocked).toContain(TR['error.auto_requires_spend_cap']);

    const attempts = render({ level: 'manual', source: 'workOrder', layerSet: true, autoUnavailable: 'auto_requires_max_attempts' });
    expect(attempts).toContain(TR['error.auto_requires_max_attempts']);
    expect(attempts).toContain('disabled');

    const ceiling = render({ level: 'manual', source: 'ceiling', autoUnavailable: 'above_ceiling' });
    expect(ceiling).toContain(TR['error.above_ceiling']);
  });

  it('U-334: an already-automatic level keeps auto selected — a later missing cap does not unpick it', () => {
    const markup = render({ level: 'auto', source: 'workOrder', layerSet: true, autoUnavailable: 'auto_requires_spend_cap' });
    expect(markup).not.toContain('disabled');
    expect(markup).not.toContain(`>${TR['error.auto_requires_spend_cap']}<`);
  });

  it('U-334: the clear-layer affordance appears only when the layer itself is set', () => {
    expect(render({ level: 'manual', source: 'workOrder', layerSet: true })).toContain(TR['autonomy.clear']);
    expect(render({ level: 'manual', source: 'repo', layerSet: false })).not.toContain(TR['autonomy.clear']);
  });

  it('U-334: an unreadable chain renders nothing — never a wrong level on the screen', () => {
    const markup = renderToStaticMarkup(
      createElement(AutonomyControl, { locale: 'tr', view: null, mark: 'test', onPick: () => undefined, onClear: () => undefined }),
    );
    expect(markup).toBe('');
  });

  it('U-334: Turkish and English carry the same keys — the source and refusal lines localize', () => {
    const tr = render({ level: 'manual', source: 'repo', autoUnavailable: 'above_ceiling' }, 'tr');
    const en = render({ level: 'manual', source: 'repo', autoUnavailable: 'above_ceiling' }, 'en');
    expect(tr).toContain(TR['autonomy.source.repo']);
    expect(tr).toContain(TR['error.above_ceiling']);
    expect(en).toContain(EN['autonomy.source.repo']);
    expect(en).toContain(EN['error.above_ceiling']);
    expect(autonomySourceKey('repo')).toBe('autonomy.source.repo');
    expect(autonomyRefusalKey('above_ceiling')).toBe('error.above_ceiling');
  });
});
