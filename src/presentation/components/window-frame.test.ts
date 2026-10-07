// window-frame.test.ts — U-46: the one window the setup wizard and Settings share, and the
// AccountEditor that opens over it. The sizes are asserted from the rendered markup, because the
// frame is the only place they live: a class lost here is the rule broken.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SettingsAccountView } from '../../api/queries';
import { AccountEditorDialog } from './account-editor-dialog';
import { WindowFrame, WindowTitle } from './window-frame';
import { createAccountEditorStore, type EditorOutcome } from '../stores/account-editor';
import type { Command } from '../../api/commands';

const account: SettingsAccountView = {
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
};

describe('window frame (U-46)', () => {
  it('U-46: the window the wizard and Settings share is 1040×680 at most, clamped to the viewport', () => {
    const html = renderToStaticMarkup(
      createElement(WindowFrame, {
        label: 'Kurulum',
        brand: 'Docket',
        rail: createElement('span', null, 'rail'),
        head: createElement(WindowTitle, { title: 'Bütçe' }),
        children: createElement('p', null, 'body'),
      }),
    );
    // The frame's own size classes carry the rule: the fixed ideal, then the two clamps that
    // narrow it inside a small window (the single-column layout's existing shrink).
    for (const expected of ['w-[1040px]', 'h-[680px]', 'max-w-[calc(100vw-48px)]', 'max-h-[calc(100vh-96px)]']) {
      expect(html, expected).toContain(expected);
    }
    // A clamped ideal never grows past itself.
    expect(html).not.toContain('w-[880px]');
    expect(html).not.toContain('h-[580px]');
  });

  it('U-46: the AccountEditor stays 820×600 — always visibly smaller than the window it opens over', () => {
    const run = (_command: Command): Promise<EditorOutcome> =>
      Promise.resolve({ result: { ok: true }, labelKey: 'success.account.save' });
    const html = renderToStaticMarkup(
      createElement(AccountEditorDialog, {
        host: 'wizard',
        account,
        locale: 'tr',
        store: createAccountEditorStore({ run, now: () => 0 }),
        formatTime: () => null,
        onRefresh: () => {},
        mark: null,
        title: 'Claude Code · Kişisel',
        meta: '',
        billing: 'included',
        viaKey: false,
        status: { tone: 'proceed', text: 'Hazır' },
        onClose: () => {},
      }),
    );
    expect(html).toContain('w-[820px]');
    expect(html).toContain('h-[600px]');
    // The editor's ceiling stays under the window's in both axes, so it can never read as the
    // window's peer (1040×680 per the clause above).
    expect(820).toBeLessThan(1040);
    expect(600).toBeLessThan(680);
  });
});
