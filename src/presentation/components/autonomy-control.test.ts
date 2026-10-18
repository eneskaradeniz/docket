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
    // The balanced key exists for the surfaces that only reflect a stored value (the ceiling's
    // and the stage tag's wording, U-336) — this control still never renders it, offered or not.
    expect(LABEL_KEYS).toContain('autonomy.level.balanced');
    expect(markup).not.toContain(TR['autonomy.level.balanced']);
  });

  it('U-334: shows the effective level with its source line — Kaynak: …', () => {
    expect(render({ level: 'manual', source: 'workOrder' })).toContain(TR['autonomy.source.workOrder']);
    expect(render({ level: 'auto', source: 'repo', layerSet: false })).toContain(TR['autonomy.source.repo']);
    expect(render({ level: 'manual', source: 'ceiling' })).toContain(TR['autonomy.source.ceiling']);
  });

  it('U-334: disables auto with the typed reason text when R-169/R-156 or the ceiling would refuse', () => {
    const blocked = render({ level: 'manual', source: 'builtin', autoUnavailable: 'auto_requires_spend_cap' });
    expect(blocked).toContain('disabled=""');
    expect(blocked).toContain(TR['autonomy.why.auto_requires_spend_cap']);
    expect(blocked).not.toContain(TR['error.auto_requires_spend_cap']);
    expect(blocked).not.toContain('role="alert"');

    const attempts = render({ level: 'manual', source: 'workOrder', layerSet: true, autoUnavailable: 'auto_requires_max_attempts' });
    expect(attempts).toContain(TR['autonomy.why.auto_requires_max_attempts']);
    expect(attempts).toContain('disabled=""');

    const ceiling = render({ level: 'manual', source: 'ceiling', autoUnavailable: 'above_ceiling' });
    expect(ceiling).toContain(TR['autonomy.why.above_ceiling']);
  });

  it('#1283: one reason line — where the why line shows, the refusal line is gone and the auto radio points at the why line', () => {
    for (const code of ['auto_requires_spend_cap', 'auto_requires_max_attempts', 'above_ceiling'] as const) {
      const markup = render({ level: 'manual', source: 'repo', autoUnavailable: code });
      expect(markup).toContain('data-autonomy-why');
      expect(markup).not.toContain('data-autonomy-refusal');
      expect(markup).not.toContain(TR[`autonomy.autoDisabledReason.${code}`]);
      expect(markup).toContain('aria-describedby="autonomy-test-why"');
      expect(markup).toContain('id="autonomy-test-why"');
    }
    // No why line (a balanced level the control does not offer): the refusal line stays, bound as before.
    const kept = render({ level: 'balanced', source: 'repo', autoUnavailable: 'above_ceiling' });
    expect(kept).not.toContain('data-autonomy-why');
    expect(kept).toContain('data-autonomy-refusal');
    expect(kept).toContain('aria-describedby="autonomy-test-refusal"');
  });

  it('U-334: an already-automatic level keeps auto selected — a later missing cap does not unpick it', () => {
    const markup = render({ level: 'auto', source: 'workOrder', layerSet: true, autoUnavailable: 'auto_requires_spend_cap' });
    expect(markup).not.toContain('disabled=""');
    expect(markup).not.toContain(`>${TR['autonomy.autoDisabledReason.auto_requires_spend_cap']}<`);
  });

  it('#1277: selected and disabled radios never share a look — hand-drawn, disabled is hollow and dashed', () => {
    const markup = render({ level: 'manual', source: 'builtin', autoUnavailable: 'auto_requires_spend_cap' });
    const radios = markup.match(/<input[^>]*type="radio"[^>]*>/g) ?? [];
    expect(radios).toHaveLength(2);
    for (const radio of radios) {
      // The platform's own radio (a grey disc when disabled in the dark theme) is switched off.
      expect(radio).toContain('appearance-none');
      expect(radio).toContain('checked:before:scale-100');
      expect(radio).toContain('disabled:border-dashed');
      expect(radio).toContain('disabled:checked:before:scale-0');
    }
  });

  it('#1283: a manual level says why — the missing spend cap, the missing attempt bound, the ceiling, or the untouched default', () => {
    const cap = render({ level: 'manual', source: 'builtin', autoUnavailable: 'auto_requires_spend_cap' });
    expect(cap).toContain(TR['autonomy.why.auto_requires_spend_cap']);
    expect(cap).toContain('data-autonomy-why');
    expect(render({ level: 'manual', source: 'repo', autoUnavailable: 'auto_requires_max_attempts' })).toContain(TR['autonomy.why.auto_requires_max_attempts']);
    expect(render({ level: 'manual', source: 'ceiling', autoUnavailable: 'above_ceiling' })).toContain(TR['autonomy.why.above_ceiling']);
    // Nothing set anywhere and nothing refusing: the built-in default is the reason.
    expect(render({ level: 'manual', source: 'builtin' })).toContain(TR['autonomy.why.default']);
    expect(render({ level: 'manual', source: 'builtin' }, 'en')).toContain(EN['autonomy.why.default']);
    // A chosen manual (no refusal, not the built-in) and an automatic level need no explanation.
    expect(render({ level: 'manual', source: 'workOrder', layerSet: true })).not.toContain('data-autonomy-why');
    expect(render({ level: 'auto', source: 'workOrder', layerSet: true })).not.toContain('data-autonomy-why');
  });

  it('#1302: one helper line says what Otomatik changes — both locales, manual, auto and unavailable, apart from the reason line', () => {
    for (const locale of ['tr', 'en'] as const) {
      const dict = locale === 'tr' ? TR : EN;
      const states = [
        { level: 'manual' as const, source: 'builtin' },
        { level: 'auto' as const, source: 'repo', layerSet: true },
        { level: 'manual' as const, source: 'builtin', autoUnavailable: 'auto_requires_spend_cap' },
        { level: 'manual' as const, source: 'workOrder', autoUnavailable: 'above_ceiling' },
      ];
      for (const state of states) {
        const markup = render(state, locale);
        expect(markup).toContain('data-autonomy-auto-help');
        expect(markup.split(dict['autonomy.autoHelp']).length - 1).toBe(1);
      }
    }
    expect(render({ level: 'manual', source: 'builtin' })).toContain('data-autonomy-why');
    expect(TR['autonomy.autoHelp']).not.toBe(TR['autonomy.why.default']);
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
    expect(tr).toContain(TR['autonomy.why.above_ceiling']);
    expect(en).toContain(EN['autonomy.source.repo']);
    expect(en).toContain(EN['autonomy.why.above_ceiling']);
    expect(autonomySourceKey('repo')).toBe('autonomy.source.repo');
    expect(autonomyRefusalKey('above_ceiling')).toBe('autonomy.autoDisabledReason.above_ceiling');
  });
});
