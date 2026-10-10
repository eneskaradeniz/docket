/// <reference types="vite/client" />
// shell-chat.test.ts — how the shell carries Docket AI's dock (U-101, U-119, U-122, U-125): the
// wiring is read off the shell's and the root's own sources, because it lives in composition and
// effects that a markup test cannot see. One dock, mounted once at the app root; ⌘J through the
// shared shortcut rules; the search palette and the dock never stand together; the page view
// yields while the panel is open; a blocking modal hides the dock; the place follows the route.
import { describe, expect, it } from 'vitest';

const RAW = import.meta.glob(['./shell.tsx', '../root.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const shell = Object.entries(RAW).find(([path]) => path.endsWith('shell.tsx'))?.[1] ?? '';
const root = Object.entries(RAW).find(([path]) => path.endsWith('root.tsx'))?.[1] ?? '';

describe('the shell carries the dock', () => {
  it('U-101: the sources exist', () => {
    expect(shell.length).toBeGreaterThan(1000);
    expect(root.length).toBeGreaterThan(1000);
  });

  it('U-101: the root composes the chat store from the bridge and hands it to the shell; the shell mounts one dock', () => {
    expect(root).toContain('createChatStore({');
    expect(root).toContain('chat={chat}');
    expect(shell.match(/<ChatDock\b/g)?.length).toBe(1);
  });

  it('U-119: the shortcut goes through the shared rules and the dock answers it with preventDefault', () => {
    expect(shell).toContain('isChatShortcut(event)');
    expect(shell).toContain('chatShortcutPlan(');
    expect(shell).toMatch(/isChatShortcut\(event\)\)\s*return;\s*event\.preventDefault\(\)/);
  });

  it('U-119: opening the palette closes the panel, and the shortcut closes the palette first', () => {
    expect(shell).toContain('if (palette.open) chat.close()');
    expect(shell).toContain("dispatchPalette({ type: 'close' });\n        chat.open();");
  });

  it('U-125: the page view yields while the panel is open, and a blocking modal hides the dock', () => {
    expect(shell).toContain('overlayOpen={palette.open || settingsPanel.open || wizardUp || chatOpen}');
    expect(shell).toContain('hidden={wizardUp || settingsPanel.open}');
  });

  it('U-122: the place follows the route, the tree and the loaded work order', () => {
    expect(shell).toContain('chat.setPlace(chatPlace)');
    expect(shell).toMatch(/chatPlaceOf\(\{[\s\S]*route,[\s\S]*tree: treeState\.tree,/);
  });

  it('U-101: a page card opens the page route and the note buttons open Ayarlar › Hesaplar', () => {
    expect(shell).toContain('onOpenPage={openPage}');
    expect(shell).toContain("onOpenAccounts={() => openSettings('accounts')}");
    expect(shell).toContain("onOpenConsent={() => openSettings('accounts')}");
  });
});
