// components/autonomy-ceiling-control.test.ts — U-336 of docs/v2/ui.md (D-10 chain c): the
// maxLevel select and the "{n} iş emri sınırın üzerinde" warning line, on the repo settings
// screen and for the global ceiling. The warning is a standing in plain ink — never `error.*`
// copy, never error styling, so the layout walk never reads it as a problem text.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AutonomyCeilingControl } from './autonomy-ceiling-control';
import { TR } from '../labels/tr';
import { EN } from '../labels/en';

describe('AutonomyCeilingControl (U-336)', () => {
  it('U-336: the ceiling select offers none, manual and auto — balanced stays unoffered', () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyCeilingControl, { locale: 'tr', mark: 'repo', ceiling: null, warningCount: null, onSelect: () => {} }),
    );
    expect(html).toContain(TR['autonomy.ceiling']);
    expect(html).toContain(TR['autonomy.ceiling.none']);
    expect(html).toContain(TR['autonomy.level.manual']);
    expect(html).toContain(TR['autonomy.level.auto']);
    // R-154's clause, the level control's own discipline: `balanced` is not among the offers.
    expect(html).not.toContain(TR['autonomy.level.balanced']);
    expect(html).toContain('data-autonomy-ceiling-select="repo"');
  });

  it('U-336: the global instance carries its own title, and a stored balanced ceiling is reflected, never offered', () => {
    const plain = renderToStaticMarkup(
      createElement(AutonomyCeilingControl, { locale: 'en', mark: 'global', ceiling: null, warningCount: null, onSelect: () => {}, title: EN['autonomy.ceiling.global'] }),
    );
    expect(plain).toContain(EN['autonomy.ceiling.global']);
    expect(plain).not.toContain(EN['autonomy.level.balanced']);

    // A ceiling stored as `balanced` (a definition may restrict) stays visible as the standing…
    const reflected = renderToStaticMarkup(
      createElement(AutonomyCeilingControl, { locale: 'en', mark: 'global', ceiling: 'balanced', warningCount: null, onSelect: () => {}, title: EN['autonomy.ceiling.global'] }),
    );
    expect(reflected).toContain(EN['autonomy.level.balanced']);
    // …while an unset ceiling never grows the option.
    expect(plain).not.toContain('value="balanced"');
  });

  it('U-336: the warning line names the count and is a standing in plain ink, not an error', () => {
    const html = renderToStaticMarkup(
      createElement(AutonomyCeilingControl, { locale: 'tr', mark: 'repo', ceiling: 'manual', warningCount: 3, onSelect: () => {} }),
    );
    expect(html).toContain(TR['autonomy.ceilingWarning'].replace('{n}', '3'));
    expect(html).toContain('data-autonomy-ceiling-warning="repo"');
    // No error dressing and no `error.*` copy: the count is information, not a failure.
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('text-error');

    const htmlEn = renderToStaticMarkup(
      createElement(AutonomyCeilingControl, { locale: 'en', mark: 'repo', ceiling: 'manual', warningCount: 3, onSelect: () => {} }),
    );
    expect(htmlEn).toContain(EN['autonomy.ceilingWarning'].replace('{n}', '3'));
  });

  it('U-336: no warning line when the count is absent or zero', () => {
    for (const warningCount of [null, 0]) {
      const html = renderToStaticMarkup(
        createElement(AutonomyCeilingControl, { locale: 'tr', mark: 'repo', ceiling: 'manual', warningCount, onSelect: () => {} }),
      );
      expect(html).not.toContain('data-autonomy-ceiling-warning');
    }
  });
});
