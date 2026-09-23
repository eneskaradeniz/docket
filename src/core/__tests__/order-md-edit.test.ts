import { describe, expect, it } from 'vitest';
import { applyOrderMdEdits, parseOrderMd } from '../order-md';

// WO-0031c — the work-order EDIT surface: order.md is surgically rewritten (front-matter keys + the
// Objective body) while everything else — Scope, Context, Closure notes, the operator's voice — is
// preserved byte-for-byte.
const doc = (front: string, body: string): string => `---\n${front}\n---\n\n${body}`;

const base = doc(
  ['id: WO-0005', 'title: Old title', 'review_mode: gates'].join('\n'),
  ['# WO-0005 — Old title', '', '## Objective', '', 'Old objective.', '', '## Scope', '', 'In scope:', '', '- (none)', ''].join('\n'),
);

describe('parseOrderMd — permission_rule (WO-0031c)', () => {
  it('reads the rule from front-matter', () => {
    const p = parseOrderMd(doc(['permission_rule: full_auto'].join('\n'), 'x'));
    expect(p.permissionRule).toBe('full_auto');
  });

  it("absent rule → ask_every (the operator's safe default — no silent auto-approval)", () => {
    expect(parseOrderMd(base).permissionRule).toBe('ask_every');
  });

  it('an unknown value coerces to the safe default (no free-form rules)', () => {
    expect(parseOrderMd(doc(['permission_rule: yolo'].join('\n'), 'x')).permissionRule).toBe('ask_every');
  });
});

describe('applyOrderMdEdits (WO-0031c)', () => {
  it('rewrites the title in front-matter (and nowhere else)', () => {
    const out = applyOrderMdEdits(base, { title: 'New title' });
    expect(parseOrderMd(out).title).toBe('New title');
    expect(out).toContain('# WO-0005 — Old title'); // the H1 body is untouched (only front-matter carries the id link)
  });

  it('rewrites review_mode', () => {
    const out = applyOrderMdEdits(base, { reviewMode: 'every-step' });
    expect(parseOrderMd(out).reviewMode).toBe('every-step');
  });

  it('rewrites permission_rule, inserting the key when absent', () => {
    const out = applyOrderMdEdits(base, { permissionRule: 'full_auto' });
    expect(parseOrderMd(out).permissionRule).toBe('full_auto');
    expect(out).toContain('review_mode: gates'); // neighbours intact
  });

  it('rewrites the Objective body with the description', () => {
    const out = applyOrderMdEdits(base, { description: 'The new goal.' });
    expect(parseOrderMd(out).objective).toBe('The new goal.');
    expect(out).toContain('## Scope'); // the rest of the body survives
  });

  it('all fields at once', () => {
    const out = applyOrderMdEdits(base, { title: 'T', description: 'D', reviewMode: 'every-step', permissionRule: 'ask_every' });
    const p = parseOrderMd(out);
    expect([p.title, p.objective, p.reviewMode, p.permissionRule]).toEqual(['T', 'D', 'every-step', 'ask_every']);
  });

  it('a Closure section is preserved byte-for-byte', () => {
    const withClosure = base + '\n## Closure\n\nShipped. Maliyet: $9.50\n\n_Closed 2026-08-16 at abc_\n';
    const out = applyOrderMdEdits(withClosure, { title: 'New title', description: 'New goal.' });
    expect(out).toContain('## Closure\n\nShipped. Maliyet: $9.50\n\n_Closed 2026-08-16 at abc_');
  });

  it('no front-matter → returned unchanged (the guard)', () => {
    const free = '# Just a doc\n\nNo front matter here.\n';
    expect(applyOrderMdEdits(free, { title: 'X' })).toBe(free);
  });

  it('an empty patch is the identity', () => {
    expect(applyOrderMdEdits(base, {})).toBe(base);
  });
});

describe('flow_mode edits (WO-0045)', () => {
  it('rewrites flow_mode, inserting the key when absent', () => {
    const out = applyOrderMdEdits(base, { flowMode: 'manual' });
    expect(parseOrderMd(out).flowMode).toBe('manual');
    expect(out).toContain('review_mode: gates'); // neighbours intact
  });
});

describe('flow_mode back to auto (WO-0045)', () => {
  it('flipping to auto REMOVES the key — silence IS auto', () => {
    const manual = applyOrderMdEdits(base, { flowMode: 'manual' });
    const back = applyOrderMdEdits(manual, { flowMode: 'auto' });
    expect(back).not.toContain('flow_mode');
    expect(parseOrderMd(back).flowMode).toBe('auto');
  });
});

describe('applyOrderMdEdits — taskRef (WO-0048, the roadmap link)', () => {
  it('sets the task key, inserting it when absent, neighbours intact', () => {
    const out = applyOrderMdEdits(base, { taskRef: 'f1-t3' });
    expect(parseOrderMd(out).taskRef).toBe('f1-t3');
    expect(out).toContain('review_mode: gates');
    expect(out).toContain('## Objective'); // the body is untouched
  });

  it('rewrites an existing task key in place', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'task: f0-t1'].join('\n'), 'Body.');
    const out = applyOrderMdEdits(linked, { taskRef: 'f1-t3' });
    expect(parseOrderMd(out).taskRef).toBe('f1-t3');
    expect(out).not.toContain('f0-t1');
  });

  it('null DROPS the key — silence is unlinked (the flow_mode idiom)', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'task: f0-t1'].join('\n'), 'Body.');
    const out = applyOrderMdEdits(linked, { taskRef: null });
    expect(parseOrderMd(out).taskRef).toBeUndefined();
    expect(out).not.toContain('task:');
  });

  it('an untouched task key survives any other patch byte-for-byte', () => {
    const linked = doc(
      ['id: WO-0005', 'title: Old title', 'task: f1-t3'].join('\n'),
      ['# WO-0005', '', '## Objective', '', 'Old.', '', '## Closure', '', 'Merged.'].join('\n'),
    );
    const out = applyOrderMdEdits(linked, { title: 'New title' });
    expect(out).toContain('task: f1-t3');
    expect(out).toContain('## Closure\n\nMerged.');
  });

  it('undefined = untouched: a patch without taskRef never touches the key', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'task: f1-t3'].join('\n'), 'Body.');
    expect(applyOrderMdEdits(linked, {})).toBe(linked);
  });
});

// ===== WO-0088 — the cwd override edits like the taskRef idiom: string sets, null drops =====
describe('applyOrderMdEdits — the cwd key (WO-0088)', () => {
  it('a string sets cwd: into the front-matter', () => {
    const out = applyOrderMdEdits(doc(['id: WO-0005', 'title: Old title'].join('\n'), 'Body.'), { cwd: '/wave/wt/WO-0005' });
    expect(parseOrderMd(out).cwd).toBe('/wave/wt/WO-0005');
    expect(out).toContain('Body.'); // the body is untouched
  });

  it('null DROPS the key (silence = the connection-table fallback)', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'cwd: /wave/wt/WO-0005'].join('\n'), 'Body.');
    const out = applyOrderMdEdits(linked, { cwd: null });
    expect(parseOrderMd(out).cwd).toBeUndefined();
    expect(out).not.toContain('cwd:');
  });

  it('undefined = untouched: a patch without cwd never touches the key', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'cwd: /wave/wt/WO-0005'].join('\n'), 'Body.');
    expect(applyOrderMdEdits(linked, {})).toBe(linked);
  });
});


// ===== WO-0093 — the worktree enablement rides the same set/drop idiom: true sets, false/null drops =====
describe('parseOrderMd — the checkout key (WO-0093)', () => {
  it('checkout: true parses enabled; checkout: false parses disabled; absence is undefined', () => {
    const on = parseOrderMd(doc(['id: WO-0005', 'title: T', 'checkout: true'].join('\n'), 'Body.'));
    const off = parseOrderMd(doc(['id: WO-0005', 'title: T', 'checkout: false'].join('\n'), 'Body.'));
    const silent = parseOrderMd(doc(['id: WO-0005', 'title: T'].join('\n'), 'Body.'));
    expect(on.checkout).toBe(true);
    expect(off.checkout).toBe(false);
    expect(silent.checkout).toBeUndefined();
  });

  it('garbage values are undefined — never a coerced truth', () => {
    const g = parseOrderMd(doc(['id: WO-0005', 'title: T', 'checkout: maybe'].join('\n'), 'Body.'));
    expect(g.checkout).toBeUndefined();
  });
});

describe('applyOrderMdEdits — the checkout key (WO-0093)', () => {
  it('true sets checkout: true into the front-matter', () => {
    const out = applyOrderMdEdits(doc(['id: WO-0005', 'title: Old title'].join('\n'), 'Body.'), { checkout: true });
    expect(parseOrderMd(out).checkout).toBe(true);
    expect(out).toContain('Body.');
  });

  it('false DROPS the key (silence IS disabled — the pre-WO-0093 orders keep their bytes)', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'checkout: true'].join('\n'), 'Body.');
    const out = applyOrderMdEdits(linked, { checkout: false });
    expect(parseOrderMd(out).checkout).toBeUndefined();
    expect(out).not.toContain('checkout:');
  });

  it('null DROPS the key the same way', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'checkout: true'].join('\n'), 'Body.');
    expect(applyOrderMdEdits(linked, { checkout: null })).not.toContain('checkout:');
  });

  it('undefined = untouched', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'checkout: true'].join('\n'), 'Body.');
    expect(applyOrderMdEdits(linked, {})).toBe(linked);
  });
});

// ===== WO-0098 — the per-WO backend profile override edits like the cwd key: string sets, null drops =====
describe('applyOrderMdEdits — the profile key (WO-0098)', () => {
  it('a string sets profile: into the front-matter', () => {
    const out = applyOrderMdEdits(doc(['id: WO-0005', 'title: Old title'].join('\n'), 'Body.'), { profile: 'GLM' });
    expect(parseOrderMd(out).profile).toBe('GLM');
    expect(out).toContain('Body.');
  });

  it('null DROPS the key (silence = the workspace default stands)', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'profile: GLM'].join('\n'), 'Body.');
    const out = applyOrderMdEdits(linked, { profile: null });
    expect(parseOrderMd(out).profile).toBeUndefined();
    expect(out).not.toContain('profile:');
  });

  it('undefined = untouched', () => {
    const linked = doc(['id: WO-0005', 'title: Old title', 'profile: GLM'].join('\n'), 'Body.');
    expect(applyOrderMdEdits(linked, {})).toBe(linked);
  });
});
