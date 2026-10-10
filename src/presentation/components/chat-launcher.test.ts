/// <reference types="vite/client" />
// chat-launcher.test.ts (components) — U-126, U-129 … U-135 at the markup a person would see: each host's
// launcher row drawn with the server renderer inside the launcher context, asserted by text and
// by the data hooks that name the launcher and its scope. Clicking is U-126's store test and J-16.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { EN } from '../labels/en';
import { LABEL_KEYS } from '../labels/keys';
import { TR } from '../labels/tr';
import type { Locale } from '../labels/t';
import { prefillText, type LaunchStore } from '../stores/chat-launcher';
import { ChatLauncherContext } from './chat-launcher';
import {
  BoardLaunchers,
  HomeLaunchers,
  PageLaunchers,
  RoadmapLaunchers,
  SettingsLaunchers,
  WorkOrderLaunchers,
} from './launcher-rows';

const store: LaunchStore = { state: () => ({ draft: '' }), openChat: () => undefined };

const draw = (element: ReturnType<typeof createElement>, locale: Locale = 'tr'): string =>
  renderToStaticMarkup(createElement(ChatLauncherContext.Provider, { value: { store, locale } }, element));

const launchers = (html: string): string[] => [...html.matchAll(/data-launch="([^"]+)"/g)].map((m) => m[1] ?? '');

describe('without a chat store a launcher is hidden', () => {
  it('U-126: outside the launcher context nothing is drawn', () => {
    expect(renderToStaticMarkup(createElement(HomeLaunchers))).toBe('');
  });
});

describe('home and the new-project screen (U-129)', () => {
  it('U-129: home offers "Docket AI ile birlikte kur" with the global scope', () => {
    const html = draw(createElement(HomeLaunchers));
    expect(html).toContain('Docket AI ile birlikte kur');
    expect(launchers(html)).toStrictEqual(['together']);
    expect(html).toContain('data-launch-scope="global"');
  });

  it('U-129: the roadmap offers "Docket AI ile planla" scoped to its project', () => {
    const html = draw(createElement(RoadmapLaunchers, { project: 'antero' }));
    expect(html).toContain('Docket AI ile planla');
    expect(launchers(html)).toStrictEqual(['plan']);
    expect(html).toContain('data-launch-scope="project:antero"');
  });

  it('U-129: the English locale draws the English label', () => {
    expect(draw(createElement(HomeLaunchers), 'en')).toContain(EN['launch.together']);
  });

  it('U-129: the launcher is a button with an icon the readers skip, never a link', () => {
    const html = draw(createElement(HomeLaunchers));
    expect(html).toContain('<button type="button"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<a ');
  });
});

describe('work-order creation (U-130)', () => {
  it('U-130: the board create form offers "Tarif et, ben açayım" scoped to the repo\'s project', () => {
    const html = draw(createElement(BoardLaunchers, { project: 'antero' }));
    expect(html).toContain('Tarif et, ben açayım');
    expect(launchers(html)).toStrictEqual(['describe']);
    expect(html).toContain('data-launch-scope="project:antero"');
  });

  it('U-130: a repo that no project owns has no launcher', () => {
    expect(draw(createElement(BoardLaunchers, { project: null }))).toBe('');
  });
});

describe('work-order detail (U-131)', () => {
  const row = (status: string): string => draw(createElement(WorkOrderLaunchers, { workOrder: 'wo-7', status }));

  it('U-131: waiting and blocked orders show "Bu neden beklemede?" and not "Ne yapıyor?"', () => {
    for (const status of ['awaiting_human', 'limit_waiting', 'blocked']) {
      const html = row(status);
      expect(html, status).toContain('Bu neden beklemede?');
      expect(html, status).not.toContain('Ne yapıyor?');
      expect(html).toContain('data-launch-scope="workOrder:wo-7"');
    }
  });

  it('U-131: a running order shows "Ne yapıyor?" and not "Bu neden beklemede?"', () => {
    const html = row('running');
    expect(html).toContain('Ne yapıyor?');
    expect(html).not.toContain('Bu neden beklemede?');
  });

  it('U-131: a ready, finished or unknown order shows no launcher at all', () => {
    for (const status of ['ready', 'done', 'gating', 'bilinmeyen']) expect(row(status), status).toBe('');
  });
});

describe('settings (U-132)', () => {
  it('U-132: Hesaplar, Roller and Eşzamanlılık each carry "Bunu benim için ayarla" scoped global', () => {
    for (const section of ['accounts', 'roles', 'concurrency'] as const) {
      const html = draw(createElement(SettingsLaunchers, { section, onLaunch: () => undefined }));
      expect(html, section).toContain('Bunu benim için ayarla');
      expect(launchers(html), section).toStrictEqual([`setup-${section}`]);
      expect(html).toContain('data-launch-scope="global"');
    }
  });

  it('U-132: the other sections draw nothing', () => {
    for (const section of ['capabilities', 'providers', 'appearance', 'phone', 'update'] as const) {
      expect(draw(createElement(SettingsLaunchers, { section, onLaunch: () => undefined })), section).toBe('');
    }
  });

  it('U-132: the prefill names the section through its own label bundle entry', () => {
    expect(prefillText('tr', 'launch.prefill.setup', 'settings.section.accounts')).toBe('Hesaplar ayarını benim için yapılandır.');
    expect(prefillText('tr', 'launch.prefill.setup', 'settings.section.roles')).toBe('Roller ayarını benim için yapılandır.');
    expect(prefillText('en', 'launch.prefill.setup', 'settings.section.concurrency')).toBe('Configure the Concurrency setting for me.');
  });
});

describe('page viewer (U-133)', () => {
  it('U-133: with open comments the viewer offers "Yorumlarımı düzelt" scoped to the order, else the project', () => {
    const order = draw(createElement(PageLaunchers, { scope: { kind: 'workOrder', workOrder: 'wo-9' }, openComments: 2 }));
    expect(order).toContain('Yorumlarımı düzelt');
    expect(order).toContain('data-launch-scope="workOrder:wo-9"');
    const project = draw(createElement(PageLaunchers, { scope: { kind: 'project', project: 'antero' }, openComments: 1 }));
    expect(project).toContain('data-launch-scope="project:antero"');
  });

  it('U-133: no open comments, or no known scope, hides it', () => {
    expect(draw(createElement(PageLaunchers, { scope: { kind: 'global' }, openComments: 0 }))).toBe('');
    expect(draw(createElement(PageLaunchers, { scope: null, openComments: 3 }))).toBe('');
  });
});

describe('copy (U-134)', () => {
  const launchKeys = LABEL_KEYS.filter((key) => key.startsWith('launch.'));

  it('U-134: every launcher label and prefill exists, non-empty, in both locales', () => {
    expect(launchKeys.length).toBe(14);
    for (const key of launchKeys) {
      expect(TR[key].length, `tr ${key}`).toBeGreaterThan(0);
      expect(EN[key].length, `en ${key}`).toBeGreaterThan(0);
    }
  });

  it('U-134: both locales carry the same placeholders, and a button label stays short', () => {
    for (const key of launchKeys) {
      const names = (text: string): string => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
      expect(names(EN[key]), key).toBe(names(TR[key]));
      if (!key.startsWith('launch.prefill.')) {
        expect(TR[key].length, key).toBeLessThanOrEqual(28);
        expect(EN[key].length, key).toBeLessThanOrEqual(28);
      }
    }
  });

  it('U-134: the prefill is the bundle\'s text and only that — a title or id handed in never reaches it', () => {
    expect(prefillText('tr', 'launch.prefill.together')).toBe('Yeni bir proje kurmak istiyorum, birlikte yapalım.');
    expect(prefillText('tr', 'launch.prefill.describe')).toBe('Şunu yapmak istiyorum: ');
    const hostile = '<script>alert(1)</script> {section}';
    expect(prefillText('tr', 'launch.prefill.plan')).not.toContain(hostile);
    expect(prefillText('tr', 'launch.prefill.fixComments')).toBe('Sayfadaki yorumlarımı gözden geçirip düzelt.');
  });
});

describe('measure (U-135)', () => {
  const RAW = import.meta.glob(['./chat-launcher.tsx', './launcher-rows.tsx', '../stores/chat-launcher.ts'], {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;
  const SOURCES = Object.entries(RAW);
  const code = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const joined = SOURCES.map(([, source]) => code(source)).join('\n');
  const classes = SOURCES.filter(([path]) => path.endsWith('.tsx')).flatMap(([, source]) =>
    [...code(source).matchAll(/(?:className=\{?|\b[A-Z_]+ =\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? ''),
  );

  it('U-135: the launcher sources are found and carry class strings to scan', () => {
    expect(SOURCES.length).toBe(3);
    expect(classes.length).toBeGreaterThan(0);
  });

  it('U-135: lengths are rem, never px (the hairline border is the only 1 px)', () => {
    for (const cls of classes) expect(cls, cls).not.toMatch(/\[\d*\.?\d+px\]/);
    expect(joined).not.toMatch(/\d\s?px\b/);
  });

  it('U-135: spacing steps sit on the 4·8·12·16·20·24·32 scale', () => {
    const allowed = new Set(['0', '1', '2', '3', '4', '5', '6', '8']);
    for (const cls of classes) {
      for (const m of cls.matchAll(/(?:^|\s)(?:[a-z-]+:)*(?:p[xytblr]?|m[xytblr]?|gap(?:-[xy])?|space-[xy])-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
        expect(allowed.has(m[1] ?? ''), `${m[0]} in ${cls}`).toBe(true);
      }
    }
  });

  it('U-135: only rounded-full is used for the pill — no other rounded-* and no hand-typed radius', () => {
    for (const cls of classes) {
      for (const m of cls.matchAll(/rounded(?:-[a-z0-9\-\[\]\.]+)?/g)) expect(['rounded-full', 'rounded-control', 'rounded-card', 'rounded-panel']).toContain(m[0]);
    }
    expect(classes.join(' ')).toContain('rounded-full');
  });

  it('U-135: every sized text line carries an explicit leading', () => {
    for (const cls of classes) {
      if (/\btext-\[[\d.]+rem\]/.test(cls)) expect(cls, cls).toMatch(/\bleading-/);
    }
  });

  it('U-135: a focus ring, and transitions behind motion-safe or motion-reduce', () => {
    // The ring is chat-style's own FOCUS string, which U-124 already pins to focus-visible.
    expect(joined).toContain('${FOCUS}');
    for (const cls of classes) {
      for (const token of cls.split(/\s+/)) {
        if (/^(?:[a-z-]+:)*(?:transition|duration|animate|ease)(?:-|$)/.test(token)) expect(token, token).toMatch(/^(?:motion-safe|motion-reduce):/);
      }
    }
  });

  it('U-135: no vendor name, and no Turkish copy inline', () => {
    expect(joined).not.toMatch(/claude|anthropic|openai|codex|gemini|copilot|cursor|antigravity|z\.ai/i);
    for (const literal of [...joined.matchAll(/'([^'\n]*)'|"([^"\n]*)"|>([^<>{}\n]+)</g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '')) {
      expect(literal, literal).not.toMatch(/[çğışöüÇĞİŞÖÜ]/);
    }
  });
});
