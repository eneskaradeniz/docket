// sidebar-accounts.test.ts — U-51: the sidebar's Hesaplar section as rendered markup. The frame
// still starts collapsed (U-16, the architect's note on #774); open, it shows the helper line and
// equal 56 px cards — mark, name only, status dot, one bar for the tightest limit — the popover
// every limit with its reset time, and the five-account fold. The renders run against the real
// stores (a resolved fake api), so the markup is the component's own output, not a mock's.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { SettingsAccountView, SettingsAccountsView, SettingsMeterView } from '../../api/queries';
import { AccountLimitsPopover, AccountsSkeletonBody, SidebarAccounts, clampPopoverTop } from './sidebar-accounts';
import { ACCOUNTS_BODY_MAX_HEIGHT } from './sidebar-geometry';
import { createAccountsFrameStore, type AccountCard } from '../stores/accounts-frame';
import { createProviderMarksStore } from '../stores/provider-marks';
import type { ShellChangeSignal } from '../stores/shell';

const ACCOUNT_SETTINGS = {
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  test: null,
} as const;

const meter = (id: string, poolId: string, overrides: Partial<SettingsMeterView> = {}): SettingsMeterView => ({
  id,
  poolId,
  label: null,
  cadence: 'billing_cycle',
  durationMs: null,
  unit: 'percent',
  used: 0,
  limit: 100,
  remaining: 100,
  resetsAt: null,
  resetPrecision: 'exact',
  observedAt: 0,
  source: 'polled',
  staleAfterMs: null,
  reserveClass: 'long',
  reserveShare: 0,
  ...overrides,
});

const account = (id: string, label: string, meters: readonly SettingsMeterView[]): SettingsAccountView => ({
  id,
  provider: 'opencode',
  label,
  authMode: 'api_key',
  billing: 'unknown',
  plan: null,
  ...ACCOUNT_SETTINGS,
  pools: [{ id: `pool-${id}`, label, kind: 'allowance', appliesTo: 'all' }],
  meters,
});

const view = (accounts: readonly SettingsAccountView[]): SettingsAccountsView => ({ accounts, bindings: [] });

/** The counts bar of one account: remaining shares the card's thresholds read. */
const meterAt = (id: string, remaining: number): SettingsMeterView =>
  meter(`m-${id}`, `pool-${id}`, { label: `${id} penceresi`, used: 100 - remaining, limit: 100, remaining });

const frameApi = (reply: SettingsAccountsView): Pick<Api, 'query'> => ({
  query: () => Promise.resolve(reply),
});

const noChange: ShellChangeSignal = () => () => undefined;

const marksStore = () => createProviderMarksStore({ api: { query: () => Promise.resolve({ ok: false, code: 'absent' }) } });

const renderFrame = async (reply: SettingsAccountsView, open: boolean): Promise<string> => {
  const store = createAccountsFrameStore({ api: frameApi(reply), changes: noChange });
  await store.load();
  if (open) store.toggle();
  return renderToStaticMarkup(
    createElement(SidebarAccounts, {
      store,
      marks: marksStore(),
      locale: 'tr',
      activeAccountId: null,
      providerName: () => 'OpenCode',
      now: 0,
      unaddedCount: 0,
      onOpenUnadded: () => undefined,
      onOpenAccount: () => undefined,
    }),
  );
};

const card = (id: string, label: string, limits: AccountCard['limits'], tightest: AccountCard['tightest']): AccountCard => ({
  id,
  label,
  provider: 'opencode',
  limits,
  tightest,
  reserved: false,
  reserve: { short: null, long: null },
});

describe('SidebarAccounts (U-51)', () => {
  it('U-51: the section header is 14 px/700 with a chevron and the account count, and the frame starts collapsed', async () => {
    const closed = await renderFrame(view([account('a', 'Tek', [meterAt('a', 50)])]), false);
    // The frame keeps U-16's start (the architect's note on #774): collapsed, the header alone
    // stands — the body sits in the closed row, holding nothing open.
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('grid-rows-[0fr]');
    expect(closed).not.toContain('grid-rows-[1fr]');

    const open = await renderFrame(view([account('a', 'Tek', [meterAt('a', 50)])]), true);
    expect(open).toContain('text-[14px]');
    expect(open).toContain('font-bold');
    expect(open).toContain('Hesaplar');
    // The count names how many accounts sit under the header.
    expect(open).toContain('>1</span>');
    expect(open).toContain('aria-expanded="true"');
    expect(open).toContain('grid-rows-[1fr]');
    // The helper line sits once under the header, dim and 12 px.
    expect(open).toContain('Çubuk en dar limiti gösterir.');
    expect((open.match(/Çubuk en dar limiti gösterir\./g) ?? []).length).toBe(1);
  });

  it('the collapsed body is inert — its cards are neither focusable nor reachable while hidden', async () => {
    const reply = view([account('a', 'Tek', [meterAt('a', 50)])]);
    const closed = await renderFrame(reply, false);
    // grid-rows-[0fr] hides the body from the eye only; inert is what also drops it from the tab
    // order and the accessibility tree while its cards stay in the DOM for the reopening.
    expect(closed).toMatch(/data-accounts-body="[^"]*"[^>]*\binert\b/);
    // Open, the same body is plain content again — inert must not outlive the collapse.
    const open = await renderFrame(reply, true);
    expect(open).not.toMatch(/data-accounts-body="[^"]*"[^>]*\binert\b/);
  });

  it('U-51: every card is one fixed 56 px height — name only with the full Asistan · ad in title, dot, one bar', async () => {
    const html = await renderFrame(
      view([
        account('pro', 'Pro', [meterAt('pro', 50), meter('m-x', 'pool-pro', { label: 'Haftalık', used: 10, limit: 100, remaining: 90 })]),
        account('max', 'Çok Uzun Bir Hesap Adı ki sığmasın', [meterAt('max', 20)]),
      ]),
      true,
    );
    // One height for every account, whatever its number of limits.
    expect((html.match(/h-14 /g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain('h-[56px]');
    // The name alone, truncated; the full assistant · name goes into the title.
    expect(html).toContain('title="OpenCode · Pro"');
    expect(html).toContain('truncate');
    // No per-card limit label rides the bar row: the second window's name stays out of the card.
    expect(html).not.toContain('Haftalık');
    // The card announces the popover it opens (click or Enter — the button's own activation).
    expect((html.match(/aria-haspopup="dialog"/g) ?? []).length).toBe(2);
    expect(html).toContain('aria-expanded="false"');
  });

  it('U-51: the bar and dot colour by what remains — 40 %+ proceed, 15–40 amber, under 15 red', async () => {
    const html = await renderFrame(
      view([
        account('rani', 'Rahat', [meterAt('rani', 50)]),
        account('orta', 'Orta', [meterAt('orta', 20)]),
        account('sik', 'Sıkışık', [meterAt('sik', 10)]),
        account('sinir', 'Sınır', [meterAt('sinir', 40)]),
      ]),
      true,
    );
    const dots = [...html.matchAll(/data-account-dot="([^"]+)"/g)].map((m) => m[1]);
    expect(dots).toEqual(['proceed', 'warn', 'error', 'proceed']);
    const bars = [...html.matchAll(/data-account-bar="([^"]+)"/g)].map((m) => m[1]);
    expect(bars).toEqual(['proceed', 'warn', 'error', 'proceed']);
    // The percent rides the bar's right, in the locale's own percent grammar.
    expect(html).toContain('%50');
    expect(html).toContain('%10');
  });

  it('U-51: an account without limit data shows the dim Limit bilgisi yok line instead of a bar', async () => {
    const html = await renderFrame(
      view([account('bos', 'Bilinmeyen', [meter('m-b', 'pool-bos', { label: 'Pencere', used: null, limit: null, remaining: null })])]),
      true,
    );
    expect(html).toContain('Limit bilgisi yok');
    expect(html).not.toContain('data-account-bar');
    // The dot goes quiet, not red — nothing is known.
    expect(html).toContain('data-account-dot="none"');
  });

  it('U-51b: two cards show at a time with a third peeking — no fold button, the rest scroll inside', async () => {
    const accounts = Array.from({ length: 9 }, (_, index) => account(`a${index}`, `Hesap ${index}`, [meterAt(`a${index}`, 50)]));
    const html = await renderFrame(view(accounts), true);
    // Every card is in the DOM; the body's fixed height is what shows two and a peek.
    expect((html.match(/data-account-card=/g) ?? []).length).toBe(9);
    // The fold button is gone — neither of its words, neither of its marks.
    expect(html).not.toContain('data-accounts-more');
    expect(html).not.toContain('hesap daha');
    expect(html).not.toContain('Daha az göster');
    // The scroll stays inside the section, vertical only.
    expect(html).toContain('overflow-y-auto');
    expect(html).not.toContain('overflow-x');
  });

  it('U-51b: the section body is the fixed two-cards-plus-peek measure, not the leftover height', async () => {
    expect(ACCOUNTS_BODY_MAX_HEIGHT).toBe('max-h-[9.25rem]');
    const accounts = Array.from({ length: 9 }, (_, index) => account(`a${index}`, `Hesap ${index}`, [meterAt(`a${index}`, 50)]));
    const html = await renderFrame(view(accounts), true);
    expect(html).toContain(ACCOUNTS_BODY_MAX_HEIGHT);
    // The section no longer grows into the sidebar's leftover: the peek survives every height.
    expect(html).not.toContain('flex-auto');
  });

  it('U-51: the popover lists every limit with its name and reset time, marking the tightest', () => {
    const NOW = 1_700_000_000_000;
    const limits = [
      { id: 'm-5h', name: { text: '5 saatlik' }, remaining: 0.59, fraction: null, resetsAt: NOW + 3 * 3600_000 },
      { id: 'm-w', name: { text: 'Haftalık' }, remaining: 0.12, fraction: '36 / 300', resetsAt: NOW + 4 * 24 * 3600_000 },
      { id: 'm-r', name: { text: 'İstekler' }, remaining: 0.88, fraction: null, resetsAt: null },
    ];
    const html = renderToStaticMarkup(
      createElement(AccountLimitsPopover, {
        card: card('pro', 'Pro', limits, limits[1] ?? null),
        provider: 'OpenCode',
        mark: null,
        locale: 'tr',
        now: NOW,
        left: 264,
        top: 120,
        onOpen: () => undefined,
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="OpenCode · Pro — Limitler"');
    // Every limit with its name.
    for (const name of ['5 saatlik', 'Haftalık', 'İstekler']) expect(html).toContain(name);
    // The reset time in the locale's own span words; a limit without one says nothing.
    expect(html).toContain('3 sa sonra sıfırlanır');
    expect(html).toContain('4 gün sonra sıfırlanır');
    // The counted unit's fraction rides the name.
    expect(html).toContain('36 / 300');
    // Exactly the tightest carries the mark.
    expect((html.match(/data-tightest-tag/g) ?? []).length).toBe(1);
    expect(html).toContain('En dar');
    // Remaining readouts for each row.
    expect(html).toContain('%12');
    expect(html).toContain('%59');
  });

  it('U-51: the popover of an account without limits says so, dim, with the info mark', () => {
    const html = renderToStaticMarkup(
      createElement(AccountLimitsPopover, {
        card: card('bos', 'Bilinmeyen', [], null),
        provider: null,
        mark: null,
        locale: 'tr',
        now: 0,
        left: 0,
        top: 0,
        onOpen: () => undefined,
      }),
    );
    expect(html).toContain('kullanım bilgisi vermiyor');
    expect(html).not.toContain('data-tightest-tag');
  });

  it('U-51a: the popover ends with the Hesabı aç button that opens that account view', () => {
    const limits = [
      { id: 'm-5h', name: { text: '5 saatlik' }, remaining: 0.59, fraction: null, resetsAt: null },
      { id: 'm-w', name: { text: 'Haftalık' }, remaining: 0.12, fraction: null, resetsAt: null },
    ];
    const render = (locale: 'tr' | 'en'): string =>
      renderToStaticMarkup(
        createElement(AccountLimitsPopover, {
          card: card('pro', 'Pro', limits, limits[1] ?? null),
          provider: 'OpenCode',
          mark: null,
          locale,
          now: 0,
          left: 0,
          top: 0,
          onOpen: () => undefined,
        }),
      );
    const html = render('tr');
    expect(html).toContain('Hesabı aç');
    expect(html).toContain('data-open-account="pro"');
    // The button ends the popover: it rides below the last limit row.
    expect(html.indexOf('Hesabı aç')).toBeGreaterThan(html.indexOf('data-limit-row="m-w"'));
    // The bundle's own word, both locales.
    expect(render('en')).toContain('Open account');
    // U-51a keeps U-51's stance otherwise: the button is the popover's only control, nothing
    // steals the focus from the card (no autofocus), and Esc stays the closer.
    expect((html.match(/<button/g) ?? [])).toHaveLength(1);
    expect(html).not.toContain('autofocus');
  });

  it('U-51a: the popover of an account without limits still ends with the Hesabı aç button', () => {
    const html = renderToStaticMarkup(
      createElement(AccountLimitsPopover, {
        card: card('bos', 'Bilinmeyen', [], null),
        provider: null,
        mark: null,
        locale: 'tr',
        now: 0,
        left: 0,
        top: 0,
        onOpen: () => undefined,
      }),
    );
    expect(html).toContain('data-open-account="bos"');
    expect(html).toContain('Hesabı aç');
  });

  it('U-51: helper text holds at least 12 px — the hint, the percent, the no-limit line', async () => {
    const accounts = Array.from({ length: 6 }, (_, index) => account(`a${index}`, `Hesap ${index}`, [meterAt(`a${index}`, 50)]));
    const html = await renderFrame(view(accounts), true);
    expect(html).not.toContain('text-[9.5px]');
    expect(html).not.toContain('text-[10.5px]');
    expect(html).not.toContain('text-[11px]');
    expect(html).not.toContain('text-[10px]');
  });

  it('U-51b: popover top clamp calculation bounds strictly within viewport', () => {
    // viewport içinde kalma (fits completely)
    expect(clampPopoverTop(100, 300, 800, 8)).toBe(100);
    // alt kenar taşması (overflows bottom)
    expect(clampPopoverTop(600, 300, 800, 8)).toBe(492); // 800 - 8 - 300 = 492
    // üst kenar taşması (overflows top)
    expect(clampPopoverTop(0, 300, 800, 8)).toBe(8);
    // popover yüksekliği viewport'tan büyük (height > viewport)
    expect(clampPopoverTop(100, 900, 800, 8)).toBe(8);
  });

  it('U-23: header button is 24x24 at rest', async () => {
    const html = await renderFrame(view([]), true);
    // Refresh button uses SIDEBAR_HEADER_BUTTON which is h-6 w-6
    expect(html).toContain('h-6 w-6');
  });
});

describe('SidebarAccounts skeleton (U-26)', () => {
  it('U-26: the composition fits the body\'s cap exactly — two whole cards, the list\'s own gaps, a 1.25 rem peek', () => {
    const html = renderToStaticMarkup(createElement(AccountsSkeletonBody));
    expect(html).toContain('data-skeleton=""');
    // Two whole cards at the body's fixed 56 px stance — never three, which would stand past the cap.
    expect((html.match(/h-14 /g) ?? []).length).toBe(2);
    // The cards ride the list's own 0.5 rem gaps, and the third shows only its 1.25 rem peek.
    expect(html).toContain('gap-2');
    expect(html).toContain('h-5 ');
    // 2 × 3.5 rem + 2 × 0.5 rem + 1.25 rem = 9.25 rem — the body's cap (U-51b), never over it.
    const cap = /max-h-\[([\d.]+)rem\]/.exec(ACCOUNTS_BODY_MAX_HEIGHT)?.[1];
    expect(cap).toBe('9.25');
    expect(2 * 3.5 + 2 * 0.5 + 1.25).toBe(Number(cap));
  });
});
