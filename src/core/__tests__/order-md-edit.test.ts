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

  it('absent rule → risky_excluded (the chosen default)', () => {
    expect(parseOrderMd(base).permissionRule).toBe('risky_excluded');
  });

  it('an unknown value coerces to the default (no free-form rules)', () => {
    expect(parseOrderMd(doc(['permission_rule: yolo'].join('\n'), 'x')).permissionRule).toBe('risky_excluded');
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
