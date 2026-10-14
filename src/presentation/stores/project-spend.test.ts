import { describe, expect, it } from 'vitest';

import { projectCapHardStop, projectSpendDisplay } from './project-spend';
import type { ProjectSpendView } from '../../api/queries';

const view = (over: Partial<ProjectSpendView> & Pick<ProjectSpendView, 'billing'>): ProjectSpendView => ({
  totalUsd: 0,
  perRepo: [],
  ...over,
});

describe('project spend header (U-329)', () => {
  it('U-329: subscription-only draws nothing; loading, error, meter, counter and hidden no-spend states', () => {
    expect(projectSpendDisplay(null, true, null).kind).toBe('loading');
    expect(projectSpendDisplay(null, false, 'network').kind).toBe('error');
    expect(projectSpendDisplay(view({ billing: 'included', totalUsd: 40 }), false, null).kind).toBe('hidden');

    const meter = projectSpendDisplay(
      view({ billing: 'pay_per_use', totalUsd: 42.5, cap: { amountUsd: 120, warnPercent: 80 } }),
      false,
      null,
    );
    expect(meter).toMatchObject({ kind: 'meter', status: 'ok', percent: 35 });

    const warn = projectSpendDisplay(
      view({ billing: 'mixed', totalUsd: 100, cap: { amountUsd: 120, warnPercent: 80 } }),
      false,
      null,
    );
    expect(warn).toMatchObject({ kind: 'meter', status: 'warn' });

    const counter = projectSpendDisplay(view({ billing: 'pay_per_use', totalUsd: 18.4 }), false, null);
    expect(counter).toEqual({ kind: 'counter', totalUsd: 18.4 });

    expect(projectSpendDisplay(view({ billing: 'pay_per_use', totalUsd: 0 }), false, null).kind).toBe('hidden');
    expect(projectSpendDisplay(view({ billing: 'none', totalUsd: 0 }), false, null).kind).toBe('hidden');
  });
});

describe('project cap hard stop (U-330)', () => {
  it('U-330: hard_stop is true only at or above the cap', () => {
    const capped = view({ billing: 'pay_per_use', totalUsd: 120, cap: { amountUsd: 120, warnPercent: 80 } });
    expect(projectCapHardStop(capped)).toBe(true);
    expect(projectCapHardStop(view({ billing: 'pay_per_use', totalUsd: 119, cap: { amountUsd: 120, warnPercent: 80 } }))).toBe(false);
    expect(projectCapHardStop(null)).toBe(false);
  });
});
