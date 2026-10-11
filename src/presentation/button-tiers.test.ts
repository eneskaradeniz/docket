/// <reference types="vite/client" />
// button-tiers.test.ts — U-216 … U-222: three tiers. Primary fill, secondary outline, tertiary
// only as an inline link inside running text. Ghost is an icon button. A source scan rejects a
// raw borderless text button outside the icon-button host and the inline link.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../api/api';
import type { Command } from '../api/commands';
import type { AccountDetailView } from '../api/queries';
import { ActionButton } from './components/action-button';
import { AccountEditorDialog } from './components/account-editor-dialog';
import { ConcurrencySection } from './components/concurrency-section';
import { InlineLink, Prose } from './components/inline-link';
import { ModelList } from './components/model-list';
import { SettingRow } from './components/setting-row';
import { createAccountEditorStore, type EditorOutcome } from './stores/account-editor';
import { createAccountViewStore } from './stores/account-view';
import type { AccountModelsState } from './stores/account-models';
import { createDispatchSettingsStore } from './stores/dispatch-settings';
import type { ProviderMarksStore } from './stores/provider-marks';
import { AccountViewScreen } from './screens/account-view';

const raw = (glob: Record<string, unknown>): Readonly<Record<string, string>> => glob as Record<string, string>;

const SOURCES = raw(
  import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);

/** The tier component hosts the icon ghost; the inline link is the other legal plain-text control. */
const ALLOWED = new Set(['action-button.tsx', 'inline-link.tsx', 'icon-button.tsx']);

const buttonNamed = (html: string, name: string): string =>
  [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((match) => match[0]).find((button) => button.includes(name)) ?? '';

const outlined = (html: string, name: string): void => {
  const button = buttonNamed(html, name);
  expect(button, name).not.toBe('');
  expect(button, name).toContain('border-bord');
  expect(button, name).not.toContain('border-transparent');
};

describe('button tiers', () => {
  it('U-216: ActionButton exposes primary | neutral | ghost; ghost renders only when the children are an icon', () => {
    const primary = renderToStaticMarkup(createElement(ActionButton, { variant: 'primary', children: 'Kaydet' }));
    const neutral = renderToStaticMarkup(createElement(ActionButton, { variant: 'neutral', children: 'Vazgeç' }));
    const textGhost = renderToStaticMarkup(createElement(ActionButton, { variant: 'ghost', children: 'Geri' }));
    const iconGhost = renderToStaticMarkup(
      createElement(ActionButton, {
        variant: 'ghost',
        ariaLabel: 'Kapat',
        children: createElement('svg', { viewBox: '0 0 16 16', 'aria-hidden': true }),
      }),
    );
    expect(primary).toContain('bg-signal');
    expect(primary).toContain('border-signal');
    expect(neutral).toContain('border-bord');
    expect(neutral).toContain('hover:bg-raised');
    expect(textGhost).toContain('border-bord');
    expect(textGhost).not.toContain('border-transparent');
    expect(iconGhost).toContain('border-transparent');
    expect(iconGhost).not.toContain('border-bord');
  });

  it('U-217: a source scan finds no raw borderless text-only button outside the icon-button host and the InlineLink allow-list', () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(20);
    const consts = constMaps(SOURCES);
    const offenders = Object.entries(SOURCES).flatMap(([file, source]) => {
      const base = file.slice(file.lastIndexOf('/') + 1);
      if (ALLOWED.has(base)) return [];
      return buttonBlocks(source).flatMap((block) => {
        if (!isTextOnly(block.open, block.inner)) return [];
        const blob = classBlob(classExpr(block.open), consts.get(file) ?? new Map(), new Set());
        if (!isBorderless(blob)) return [];
        const line = source.slice(0, block.at).split('\n').length;
        const label = block.inner.replace(/\s+/g, ' ').trim().slice(0, 48);
        return [`${file}:${line} ${label}`];
      });
    });
    expect(offenders).toEqual([]);
  });

  it('U-218: heights are md 2 rem and sm 1.75 rem, rem lengths only', () => {
    const sm = renderToStaticMarkup(createElement(ActionButton, { size: 'sm', children: 'Küçük' }));
    const md = renderToStaticMarkup(createElement(ActionButton, { size: 'md', children: 'Orta' }));
    expect(sm).toContain('h-[1.75rem]');
    expect(md).toContain('h-[2rem]');
    expect(sm).not.toMatch(/\d+px/);
    expect(md).not.toMatch(/\d+px/);
    expect(sm).toContain('rounded-control');
    expect(md).toContain('rounded-control');
  });

  it('U-219: InlineLink renders only inside running text, keyboard-focusable, with a visible focus ring, underlined', () => {
    const inside = renderToStaticMarkup(
      createElement(Prose, {
        className: 'text-ink',
        children: ['Önce ', createElement(InlineLink, { onClick: () => undefined, children: 'Modeller' }), ' sekmesine bak.'],
      }),
    );
    expect(inside).toContain('data-prose');
    expect(inside).toContain('<a ');
    expect(inside).toContain('data-inline-link');
    expect(inside).toContain('tabindex="0"');
    expect(inside).toContain('underline');
    expect(inside).toContain('focus-visible:outline');
    expect(inside).toContain('role="link"');
    const outside = renderToStaticMarkup(createElement(InlineLink, { onClick: () => undefined, children: 'Modeller' }));
    expect(outside).not.toContain('<a ');
    expect(outside).not.toContain('data-inline-link=""');
    expect(outside).toContain('data-inline-link-blocked');
  });

  it('U-222: settings sections former text buttons are outlined and still named', async () => {
    const row = renderToStaticMarkup(
      createElement(SettingRow, {
        locale: 'tr',
        title: 'Tavan',
        control: null,
        differsFrom: '%80',
        onReset: () => undefined,
      }),
    );
    outlined(row, 'Önerilene dön');

    const models: AccountModelsState = {
      accountId: 'acc-1',
      loading: false,
      refreshing: false,
      rows: [{ id: 'opus', name: 'Opus', tier: null, billing: 'metered', mark: 'currency', stale: false, consented: true }],
      defaultModel: null,
      stale: true,
      problem: null,
      draft: null,
      lastOutcome: null,
    };
    const list = renderToStaticMarkup(
      createElement(ModelList, {
        locale: 'tr',
        state: models,
        onSelect: () => undefined,
        onSelectDefault: () => undefined,
        onRefresh: () => undefined,
        onEditCap: () => undefined,
        onAllow: () => undefined,
        onCancel: () => undefined,
        onRevoke: () => undefined,
      }),
    );
    outlined(list, 'Geri al');
    outlined(list, 'Yenile');

    const dispatch = createDispatchSettingsStore({
      read: () => Promise.resolve({ global: 4, perRepo: 3, perAccount: {}, mode: 'fixed', suggested: 4, machine: null, status: null }),
      write: () => Promise.resolve({ ok: true }),
    });
    await dispatch.load();
    const section = renderToStaticMarkup(
      createElement(ConcurrencySection, {
        store: dispatch,
        locale: 'tr',
        accounts: [],
        active: true,
      }),
    );
    outlined(section, 'Varsayılana dön');

    const run = (_command: Command): Promise<EditorOutcome> => Promise.resolve({ result: { ok: true }, labelKey: 'success.account.save' });
    const dialog = renderToStaticMarkup(
      createElement(AccountEditorDialog, {
        host: 'wizard',
        account: {
          id: 'acc-1',
          provider: 'claude',
          label: 'Kişisel',
          authMode: 'subscription',
          billing: 'included',
          plan: null,
          limitPolicy: 'wait_resume',
          reserve: { short: null, long: null },
          caps: [],
          consentedModels: [],
          routeKind: null,
          identityDir: null,
          endpointHost: null,
          hasSecret: false,
          test: null,
          pools: [],
          meters: [],
        },
        locale: 'tr',
        store: createAccountEditorStore({ run, now: () => 0 }),
        formatTime: () => null,
        onRefresh: () => undefined,
        mark: null,
        title: 'Claude Code · Kişisel',
        meta: '',
        billing: 'included',
        viaKey: false,
        status: { tone: 'proceed', text: 'Hazır' },
        onClose: () => undefined,
      }),
    );
    outlined(dialog, 'Vazgeç');
  });
});

describe('button tiers — account view names', () => {
  it('U-221: page viewer and account view former text buttons are outlined and still named', async () => {
    const view: AccountDetailView = {
      account: { id: 'acc-1', provider: 'claude-code', label: 'Claude Max', authMode: 'subscription', plan: 'Max', limitPolicy: 'wait_resume' },
      windows: [],
      activeWork: [],
    };
    const api = { query: async () => view } as unknown as Pick<Api, 'query'>;
    const store = createAccountViewStore({ api, changes: () => () => undefined, now: () => 0 });
    await store.load('acc-1');
    const marks: ProviderMarksStore = {
      load: () => Promise.resolve(),
      markFor: () => null,
      state: () => ({ loaded: true }),
      subscribe: () => () => undefined,
    };
    const html = renderToStaticMarkup(
      createElement(AccountViewScreen, {
        store,
        marks,
        accountId: 'acc-1',
        locale: 'tr',
        timeZone: 'UTC',
        onOpenWorkOrder: () => undefined,
        reserve: null,
        onOpenSettings: () => undefined,
        onBack: () => undefined,
      }),
    );
    outlined(html, '‹ Geri · kokpit');
    outlined(html, 'düzenle');
  });
});

interface ButtonBlock {
  readonly at: number;
  readonly open: string;
  readonly inner: string;
}

const buttonBlocks = (source: string): readonly ButtonBlock[] => {
  const blocks: ButtonBlock[] = [];
  let from = 0;
  while (from < source.length) {
    const at = source.indexOf('<button', from);
    if (at < 0) break;
    const before = at === 0 ? '' : source[at - 1] ?? '';
    if (/[\w-]/.test(before)) {
      from = at + 7;
      continue;
    }
    const openEnd = tagEnd(source, at);
    if (openEnd < 0) break;
    const closeAt = matchingClose(source, openEnd + 1);
    if (closeAt < 0) break;
    blocks.push({ at, open: source.slice(at, openEnd + 1), inner: source.slice(openEnd + 1, closeAt) });
    from = closeAt + '</button>'.length;
  }
  return blocks;
};

const tagEnd = (source: string, start: number): number => {
  let quote: '"' | "'" | '`' | null = null;
  let brace = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') brace += 1;
    else if (ch === '}') brace = Math.max(0, brace - 1);
    else if (ch === '>' && brace === 0) return i;
  }
  return -1;
};

const matchingClose = (source: string, from: number): number => {
  let depth = 1;
  let i = from;
  while (i < source.length && depth > 0) {
    const nextOpen = source.indexOf('<button', i);
    const nextClose = source.indexOf('</button>', i);
    if (nextClose < 0) return -1;
    if (nextOpen >= 0 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 7;
    } else {
      depth -= 1;
      if (depth === 0) return nextClose;
      i = nextClose + 9;
    }
  }
  return -1;
};

const classExpr = (open: string): string => {
  const at = open.indexOf('className');
  if (at < 0) return '';
  const eq = open.indexOf('=', at);
  if (eq < 0) return '';
  let i = eq + 1;
  while ((open[i] ?? '') === ' ') i += 1;
  const start = open[i] ?? '';
  if (start === '"' || start === "'") {
    const end = open.indexOf(start, i + 1);
    return end < 0 ? '' : open.slice(i + 1, end);
  }
  if (start !== '{') return '';
  let depth = 0;
  for (let j = i; j < open.length; j += 1) {
    const ch = open[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return open.slice(i + 1, j);
    }
  }
  return '';
};

const isBorderless = (blob: string): boolean => {
  if (/(?:^|[\s"'`])(?:border-transparent|border-0|border-none)(?=$|[\s"'`])/.test(blob)) return true;
  return !/(?:^|[\s"'`])border(?:-|\b)/.test(blob);
};

const isTextOnly = (open: string, inner: string): boolean => {
  if (/<[A-Za-z]/.test(inner)) return false;
  if (/\brole="(?:option|menuitem|tab|checkbox)"/.test(open)) return false;
  const literal = inner.replace(/\{[^}]*\}/g, '').trim();
  if (/\baria-label=/.test(open) && !/\{t\(/.test(inner) && literal.length <= 2) return false;
  return literal.length > 0 || /\{/.test(inner);
};

type ConstMap = ReadonlyMap<string, string>;

const constMaps = (sources: Readonly<Record<string, string>>): ReadonlyMap<string, ConstMap> => {
  const local = new Map<string, Map<string, string>>();
  for (const [file, source] of Object.entries(sources)) {
    local.set(file, localConsts(source));
  }
  const merged = new Map<string, ConstMap>();
  for (const [file, source] of Object.entries(sources)) {
    const map = new Map<string, string>(local.get(file) ?? []);
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/g)) {
      const spec = match[2] ?? '';
      if (!spec.startsWith('.')) continue;
      const target = resolveImport(file, spec, sources);
      if (target === null) continue;
      const imported = local.get(target);
      if (imported === undefined) continue;
      for (const part of (match[1] ?? '').split(',')) {
        const piece = part.trim();
        if (piece === '') continue;
        const [original, alias] = piece.split(/\s+as\s+/);
        const name = (alias ?? original ?? '').trim();
        const from = (original ?? '').trim();
        const value = imported.get(from);
        if (name !== '' && value !== undefined) map.set(name, value);
      }
    }
    merged.set(file, map);
  }
  return merged;
};

const localConsts = (source: string): Map<string, string> => {
  const map = new Map<string, string>();
  const re = /(?:export\s+)?const\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*/g;
  for (const match of source.matchAll(re)) {
    const name = match[1];
    const begin = match.index === undefined ? -1 : match.index + match[0].length;
    if (name === undefined || begin < 0) continue;
    const end = statementEnd(source, begin);
    if (end < 0) continue;
    map.set(name, source.slice(begin, end));
  }
  return map;
};

const statementEnd = (source: string, start: number): number => {
  let quote: '"' | "'" | '`' | null = null;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i] ?? '';
    if (quote !== null) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') brace += 1;
    else if (ch === '}') brace -= 1;
    else if (ch === '(') paren += 1;
    else if (ch === ')') paren -= 1;
    else if (ch === '[') bracket += 1;
    else if (ch === ']') bracket -= 1;
    else if (ch === ';' && brace === 0 && paren === 0 && bracket === 0) return i;
  }
  return -1;
};

const resolveImport = (fromFile: string, spec: string, sources: Readonly<Record<string, string>>): string | null => {
  const dir = fromFile.slice(0, fromFile.lastIndexOf('/'));
  const parts = `${dir}/${spec}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  const base = stack.join('/');
  for (const key of [`./${base}.tsx`, `${base}.tsx`, `./${base}.ts`, `${base}.ts`]) {
    if (sources[key] !== undefined) return key;
  }
  return null;
};

const classBlob = (expr: string, consts: ConstMap, seen: Set<string>): string => {
  let blob = expr;
  for (const id of expr.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (seen.has(id)) continue;
    const init = consts.get(id);
    if (init === undefined) continue;
    seen.add(id);
    blob += ` ${classBlob(init, consts, seen)}`;
  }
  return blob;
};
