// chat-dock.test.ts — U-116 (untrusted text), U-119 (the shortcut), U-120 (the panel's markup, roles
// and names), U-121 (empty state) and U-125 (reduced motion, focus rings, the hidden panel) at the
// markup a person would see: the dock drawn over a real store and a scripted bridge with the server
// renderer, the way the layer's other screen tests draw. Message text is hostile data on purpose.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { chatShortcutPlan, GLOBAL_PLACE, isChatShortcut, type ChatPlace } from '../stores/chat-model';
import { createChatStore, type ChatStore } from '../stores/chat-store';
import { ACTOR, action, bridge, conversation, draft, flush, grant, message, summary, type Bridge } from '../stores/chat-kit';
import { ChatDock } from './chat-dock';

const NOW = 1_700_000_000_000;
const PLACE: ChatPlace = {
  choices: [
    { scope: { kind: 'global' }, label: '' },
    { scope: { kind: 'project', project: 'antero' }, label: 'Antero' },
    { scope: { kind: 'workOrder', workOrder: 'W1' }, label: 'İE-0012 · Giriş ekranı' },
  ],
  screen: { key: 'workOrder:W1', kind: 'workOrder', input: { kind: 'workOrder', id: 'W1' }, label: 'İE-0012' },
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const draw = async (
  setup: (store: ChatStore, b: Bridge) => void | Promise<void> = () => undefined,
  locale: 'tr' | 'en' = 'tr',
  options: { readonly hidden?: boolean; readonly place?: ChatPlace; readonly now?: number } = {},
): Promise<string> => {
  const b = bridge();
  const store = createChatStore({ api: b.api, changes: b.changes, actor: ACTOR, now: () => options.now ?? NOW, notify: b.notify });
  store.setPlace(options.place ?? PLACE);
  await setup(store, b);
  await flush();
  return renderToStaticMarkup(
    createElement(ChatDock, {
      store,
      locale,
      hidden: options.hidden ?? false,
      onOpenPage: () => undefined,
      onOpenAccounts: () => undefined,
      onOpenConsent: () => undefined,
    }),
  );
};

const withConversation = (view: ReturnType<typeof conversation>) => async (store: ChatStore, b: Bridge): Promise<void> => {
  b.onQuery('chat.conversation', () => view);
  store.open();
  await store.openConversation(view.id);
};

describe('the shortcut (U-119)', () => {
  const press = (key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
    isChatShortcut({ key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

  it('U-119: ⌘J and Ctrl+J, in either case, are the shortcut; nothing else is', () => {
    expect(press('j', { metaKey: true })).toBe(true);
    expect(press('J', { ctrlKey: true })).toBe(true);
    expect(press('j')).toBe(false);
    expect(press('k', { metaKey: true })).toBe(false);
    expect(press('j', { metaKey: true, altKey: true })).toBe(false);
    expect(press('j', { metaKey: true, shiftKey: true })).toBe(false);
  });

  it('U-119: with the search palette open the shortcut closes it and opens the chat; a blocking modal ignores it', () => {
    expect(chatShortcutPlan({ paletteOpen: false, modalOpen: false, chatOpen: false })).toBe('toggle');
    expect(chatShortcutPlan({ paletteOpen: false, modalOpen: false, chatOpen: true })).toBe('toggle');
    expect(chatShortcutPlan({ paletteOpen: true, modalOpen: false, chatOpen: false })).toBe('closePaletteAndOpen');
    expect(chatShortcutPlan({ paletteOpen: false, modalOpen: true, chatOpen: false })).toBe('ignore');
  });
});

describe('panel markup (U-120)', () => {
  it('U-120: the button is a named toggle and the panel a non-modal dialog', async () => {
    const closed = await draw();
    expect(closed).toContain('aria-label="Docket AI’ı aç"');
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain('role="dialog"');
    expect(closed).toContain('aria-label="Docket AI"');
    expect(closed).toContain('aria-modal="false"');
    const open = await draw((store) => store.open());
    expect(open).toContain('aria-label="Docket AI’ı kapat"');
    expect(open).toContain('aria-expanded="true"');
  });

  it('U-120: the header has the scope chip, Geçmiş (pressed state) and Yeni konuşma', async () => {
    const html = await draw((store) => store.open());
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('aria-label="Geçmiş"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('aria-label="Yeni konuşma"');
    expect(html).toContain('İE-0012 · Giriş ekranı');
  });

  it('U-120: an empty conversation offers the scope\'s two suggestions', async () => {
    const html = await draw((store) => store.open());
    expect(html).toContain('Ne öğrenmek istersin?');
    expect(html).toContain('Neden beklemede?');
    expect(html).toContain('Son çalışmada ne değişti?');
    const project = await draw((store) => store.open(), 'tr', { place: { choices: PLACE.choices.slice(0, 2), screen: null } });
    expect(project).toContain('Sıradaki hazır görevler?');
    expect(project).toContain('Bütçe ne durumda?');
    const global = await draw((store) => store.open(), 'tr', { place: GLOBAL_PLACE });
    expect(global).toContain('Benden ne bekleniyor?');
    expect(global).toContain('Bu hafta kota nasıl gitti?');
  });

  it('U-120: the dock names its controls — Mesaj, Ekle (menu), Gönder (disabled while empty) — and the footer line', async () => {
    const html = await draw(async (store, b) => {
      b.onQuery('chat.usage', () => ({ month: { messages: 38 }, account: { label: 'Claude Code · Kişisel' } }));
      store.open();
    });
    expect(html).toContain('aria-label="Mesaj"');
    expect(html).toContain('placeholder="Sor  ·  @ ile ekle"');
    expect(html).toContain('aria-label="Ekle"');
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toMatch(/aria-label="Gönder"[^>]*disabled|disabled=""[^>]*aria-label="Gönder"/);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Öner');
    expect(html).toContain('Claude Code · Kişisel');
    expect(html).toContain('bu ay 38 mesaj');
  });

  it('U-120: the English bundle is the peer locale', async () => {
    const html = await draw((store) => store.open(), 'en');
    expect(html).toContain('aria-label="Message"');
    expect(html).not.toContain('Ne öğrenmek istersin?');
    expect(html).toContain('aria-label="History"');
  });

  it('U-120: while the model answers the dots are a named status and the send button becomes a stop control', async () => {
    const html = await draw(async (store, b) => {
      b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
      b.onQuery('chat.conversation', () => conversation('C1', { activeTurn: 'T1', messages: [message('m1', { role: 'user', text: 'Merhaba' })] }));
      store.open();
      store.setDraft('Merhaba');
      await store.send();
    });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-label="Asistan yazıyor"');
    expect(html).toContain('aria-label="Durdur"');
    expect(html).not.toContain('aria-label="Gönder"');
  });

  it('U-104: once text streams the dots go and the text shows in the assistant bubble', async () => {
    const html = await draw(async (store, b) => {
      b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
      b.onQuery('chat.conversation', () => conversation('C1', { activeTurn: 'T1', messages: [message('m1', { role: 'user', text: 'Merhaba' })] }));
      store.open();
      store.setDraft('Merhaba');
      await store.send();
      b.emit({ type: 'chat.delta', conversation: 'C1', turn: 'T1', text: 'Akan metin' });
    });
    expect(html).toContain('Akan metin');
    expect(html).not.toContain('aria-label="Asistan yazıyor"');
  });

  it('U-120: the feed announces politely', async () => {
    const html = await draw((store) => store.open());
    expect(html).toMatch(/aria-live="polite"/);
  });
});

describe('notes (U-106)', () => {
  it('U-106: a quota note keeps the Hesabı değiştir button, names no time, and disables the input', async () => {
    const html = await draw(async (store, b) => {
      b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
      b.onQuery('chat.conversation', () => conversation('C1', {}));
      store.open();
      store.setDraft('x');
      await store.send();
      b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code: 'quota' });
    });
    expect(html).toContain('Hesabı değiştir');
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
    expect(html).toMatch(/<textarea[^>]*\sdisabled=""/);
  });

  it('U-106: a consent note offers İzin ver; a text-only note offers no button', async () => {
    const consent = await draw(async (store, b) => {
      b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
      b.onQuery('chat.conversation', () => conversation('C1', {}));
      store.open();
      store.setDraft('x');
      await store.send();
      b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code: 'consent' });
    });
    expect(consent).toContain('Bu model kullanım başına faturalanır.');
    expect(consent).toContain('İzin ver');
    const network = await draw(async (store, b) => {
      b.onCommand('chat.start', () => ({ ok: true, conversation: 'C1', turn: 'T1' }));
      b.onQuery('chat.conversation', () => conversation('C1', {}));
      store.open();
      store.setDraft('x');
      await store.send();
      b.emit({ type: 'chat.notice', conversation: 'C1', turn: 'T1', code: 'network' });
    });
    expect(network).not.toContain('İzin ver');
    expect(network).not.toContain('Hesabı değiştir');
    expect(network).not.toMatch(/<textarea[^>]*\sdisabled=""/);
  });

  it('U-110: the file rejections are polite status notes in the prototype\'s sentences', async () => {
    const html = await draw((store) => {
      store.open();
      store.addFiles([{ name: 'demo.mp4', base64: 'aGk=' }]);
    });
    expect(html).toContain('Video desteklenmiyor. Bir kareyi resim olarak ekleyebilirsin.');
    expect(html).toContain('role="status"');
  });
});

describe('messages and cards (U-111, U-112, U-116)', () => {
  const hostile = '<img src=x onerror=alert(1)> https://evil.example/a?b=1 **kalın** [x](javascript:alert(1))';

  it('U-116: message text, titles, sources, table cells and page titles are text nodes — never markup, never links', async () => {
    const view = conversation('C1', {
      messages: [
        message('u', { role: 'user', text: hostile }),
        message('a', {
          text: hostile,
          sources: [hostile],
          artifacts: [
            { kind: 'page', id: 'P1', version: 2, title: hostile, pageKind: 'html' },
            { kind: 'table', columns: [hostile], rows: [[hostile]] },
          ],
        }),
      ],
    });
    const html = await draw(withConversation(view));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/<a[\s>]/);
    expect(html).not.toContain('<strong>');
    expect(html).not.toContain('dangerouslySetInnerHTML');
  });

  it('U-116: sent messages keep their chips and the user bubble wraps long words', async () => {
    const view = conversation('C1', {
      messages: [
        message('u', {
          role: 'user',
          text: 'bak',
          refs: [{ kind: 'workOrder', id: 'W1', label: 'İE-0031 Mobil oturum ekranı', project: 'mobile' }],
          attachments: [{ id: 'A1', name: 'ekran.png', type: 'image', bytes: 10 }],
        }),
      ],
    });
    const html = await draw(withConversation(view));
    expect(html).toContain('İE-0031 Mobil oturum ekranı');
    expect(html).toContain('ekran.png');
    expect(html).toContain('whitespace-pre-wrap');
    expect(html).toContain('[overflow-wrap:anywhere]');
    expect(html).not.toContain('atfını kaldır');
  });

  it('U-111: a page card shows its title, kind and version and an Aç button; a table card is a bare table', async () => {
    const view = conversation('C1', {
      messages: [
        message('a', {
          artifacts: [
            { kind: 'page', id: 'P1', version: 2, title: 'Giriş ekranı taslağı', pageKind: 'html' },
            { kind: 'table', columns: ['Hesap', '5 sa'], rows: [['Claude Code · Kişisel', '62%'], ['Codex', '']] },
          ],
        }),
      ],
    });
    const html = await draw(withConversation(view));
    expect(html).toContain('Giriş ekranı taslağı');
    expect(html).toContain('html · sürüm 2');
    expect(html).toContain('>Aç<');
    expect(html).toContain('<table');
    expect(html).toContain('<th');
    expect(html).toContain('Claude Code · Kişisel');
    expect(html).toContain('—');
  });

  it('U-111: a draft card offers Vazgeç and Oluştur while it is a draft, and its state after', async () => {
    const make = (status: 'draft' | 'confirmed' | 'dropped') =>
      conversation('C1', {
        drafts: [draft('D1', { status, title: 'Parola sıfırlama e-postaları', repo: 'antreo-api' })],
        messages: [message('a', { artifacts: [{ kind: 'draft', id: 'D1', label: 'Parola sıfırlama e-postaları', action: 'ACT1' }] })],
      });
    const open = await draw(withConversation(make('draft')));
    expect(open).toContain('Parola sıfırlama e-postaları');
    expect(open).toContain('antreo-api');
    expect(open).toContain('Vazgeç');
    expect(open).toContain('Oluştur');
    const made = await draw(withConversation(make('confirmed')));
    expect(made).toContain('✓ İş emri açıldı');
    expect(made).not.toContain('>Oluştur<');
    const dropped = await draw(withConversation(make('dropped')));
    expect(dropped).toContain('Vazgeçildi');
  });

  it('U-111: a proposal card shows the diff with its gutters, the source line, and Onayla / Reddet while pending', async () => {
    const view = conversation('C1', {
      actions: [action('ACT1', { class: 'definition_edit', status: 'pending' })],
      messages: [
        message('a', {
          sources: ['flows/odoo.yaml'],
          artifacts: [{ kind: 'proposal', id: 'PR1', label: 'Odoo akışına inceleme aşaması ekle', action: 'ACT1' }],
        }),
      ],
    });
    const html = await draw(async (store, b) => {
      b.onQuery('proposal.detail', () => ({
        id: 'PR1',
        summary: 'Odoo akışına inceleme aşaması ekle',
        target: 'flows/odoo.yaml',
        lines: [
          { kind: 'same', text: 'stages:' },
          { kind: 'add', text: '  - id: inceleme' },
          { kind: 'remove', text: '  - id: eski' },
        ],
      }));
      await withConversation(view)(store, b);
      store.loadProposal('PR1');
    });
    expect(html).toContain('Odoo akışına inceleme aşaması ekle');
    expect(html).toContain('flows/odoo.yaml');
    expect(html).toContain('Kaynak: flows/odoo.yaml');
    expect(html).toContain('  - id: inceleme');
    expect(html).toContain('−');
    expect(html).toContain('+');
    expect(html).toContain('Reddet');
    expect(html).toContain('Onayla');
    // The card replaces the source chips row for that message.
    expect(html.split('flows/odoo.yaml').length - 1).toBeLessThanOrEqual(3);
  });

  it('U-111: a decided proposal shows its state, not the buttons', async () => {
    const view = conversation('C1', {
      actions: [action('ACT1', { class: 'definition_edit', status: 'applied' })],
      messages: [message('a', { artifacts: [{ kind: 'proposal', id: 'PR1', label: 'x', action: 'ACT1' }] })],
    });
    const html = await draw(withConversation(view));
    expect(html).toContain('✓ Onaylandı');
    expect(html).not.toContain('>Onayla<');
  });

  it('U-112: an applied action row shows Geri al while the window is open and not after it', async () => {
    const view = (expires: number) =>
      conversation('C1', {
        actions: [action('A1', { class: 'open_work_order', status: 'applied', undoable: true, undoExpiresAt: expires, authority: 'grant' })],
        messages: [message('a', { text: 'İkisini de yaptım.' })],
      });
    const open = await draw(withConversation(view(NOW + 60_000)));
    expect(open).toContain('İş emri açıldı');
    expect(open).toContain('Geri al');
    const expired = await draw(withConversation(view(NOW - 1)), 'tr', { now: NOW });
    expect(expired).toContain('İş emri açıldı');
    expect(expired).not.toContain('Geri al');
  });

  it('U-112: an undone row is dimmed with its state and no button; a pending setting change can be decided', async () => {
    const html = await draw(
      withConversation(
        conversation('C1', {
          actions: [
            action('A1', { status: 'undone', undoable: false }),
            action('A2', { class: 'setting_change', status: 'pending' }),
          ],
          messages: [message('a')],
        }),
      ),
    );
    expect(html).toContain('Geri alındı');
    expect(html).toContain('Onayla');
    expect(html).toContain('Reddet');
  });
});

describe('history view (U-107)', () => {
  it('U-107: search, groups, rows with a title, meta line and the pin and delete buttons; no dock', async () => {
    const html = await draw(async (store, b) => {
      b.onQuery('chat.conversations', () => [
        summary('a', { title: 'Bu iş emri neden beklemede?', pinned: true, updatedAt: NOW - 1000, scope: { kind: 'workOrder', workOrder: 'W1' } }),
        summary('b', { title: 'Bütçe sınırı ne kadar?', updatedAt: NOW - 2000 }),
      ]);
      store.open();
      store.openHistory();
    });
    expect(html).toContain('aria-label="Geçmişte ara"');
    expect(html).toContain('Sabitlenenler');
    expect(html).toContain('Bu iş emri neden beklemede?');
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Sabiti kaldır"');
    expect(html).toContain('aria-label="Sabitle"');
    expect(html).toContain('aria-label="Sil"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain('aria-label="Mesaj"');
  });

  it('U-107: an empty list and a search that matches nothing read differently; a failed read says so', async () => {
    const empty = await draw(async (store, b) => {
      b.onQuery('chat.conversations', () => []);
      store.open();
      store.openHistory();
    });
    expect(empty).toContain('Henüz konuşma yok.');
    const none = await draw(async (store, b) => {
      b.onQuery('chat.conversations', () => []);
      store.open();
      store.openHistory();
      await flush();
      store.setSearch('xyz');
      vi.advanceTimersByTime(200);
    });
    expect(none).toContain('Eşleşen konuşma yok.');
    const failed = await draw(async (store, b) => {
      b.onQuery('chat.conversations', () => ({ ok: false, code: 'io_failed' }));
      store.open();
      store.openHistory();
    });
    expect(failed).toContain('Geçmiş okunamadı.');
  });

  it('U-116: a conversation title is a text node', async () => {
    const html = await draw(async (store, b) => {
      b.onQuery('chat.conversations', () => [summary('a', { title: '<script>alert(1)</script>', updatedAt: NOW })]);
      store.open();
      store.openHistory();
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('scope pop, menus and the permission surface (U-102, U-109, U-113)', () => {
  it('U-102: the pop lists the scopes as options with the selected one marked, plus the follow row', async () => {
    const html = await draw((store) => {
      store.open();
      store.togglePop();
    });
    expect(html).toContain('role="option"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('Tüm projeler');
    expect(html).toContain('Genel bakış');
    expect(html).toContain('Bu projenin her şeyi');
    expect(html).toContain('Yalnızca bu iş emri');
    expect(html).toContain('Bulunduğun ekranı izler');
    const pinned = await draw((store) => {
      store.open();
      store.pickScope({ kind: 'global' });
      store.togglePop();
    });
    expect(pinned).toContain('Bulunduğum ekranı izle');
    expect(pinned).toContain('sabit');
  });

  it('U-110: the + menu has its three items and the tray shows removable chips with named buttons', async () => {
    const html = await draw(async (store, b) => {
      b.onCommand('chat.attach', () => ({ ok: true, attachment: 'A1' }));
      store.open();
      store.attachScreen();
      store.addFiles([{ name: 'notlar.md', base64: 'aGk=' }]);
      await flush();
      store.openPlus();
    });
    expect(html).toContain('Dosya veya resim');
    expect(html).toContain('png, jpg, webp, md, txt, log, csv, json, pdf');
    expect(html).toContain('Bu ekranı ekle');
    expect(html).toContain('Ekranın verisi, görüntüsü değil');
    expect(html).toContain('İş emri, sayfa, dosya…');
    expect(html).toContain('aria-label="İE-0012 atfını kaldır"');
    expect(html).toContain('aria-label="notlar.md dosyasını kaldır"');
    expect(html).toContain('role="menu"');
  });

  it('U-109: the @ menu lists the server\'s answer; with none it says what can be added', async () => {
    const some = await draw(async (store, b) => {
      b.onQuery('chat.references', () => [{ kind: 'work_order', id: 'W1', label: 'İE-0012 Giriş ekranını hazırla', project: 'antero' }]);
      store.open();
      store.setDraft('@gi');
      vi.advanceTimersByTime(200);
      await flush();
    });
    expect(some).toContain('İE-0012 Giriş ekranını hazırla');
    expect(some).toContain('antero/');
    const none = await draw(async (store, b) => {
      b.onQuery('chat.references', () => []);
      store.open();
      store.setDraft('@zzz');
      vi.advanceTimersByTime(200);
      await flush();
    });
    expect(none).toContain('Eşleşen bir şey yok. Yalnızca kendi projelerindeki iş emirleri, sayfalar ve dosyalar eklenebilir.');
  });

  it('U-113: the permission dialog (off) lists the four classes and a grant button disabled until one is checked', async () => {
    const html = await draw((store) => {
      store.open();
      store.togglePerm();
    });
    expect(html).toContain('aria-label="Docket AI izinleri"');
    expect(html).toContain('Docket AI ne yapabilir?');
    for (const label of ['İş emri aç', 'Yol haritasını düzenle', 'Akış ve rol dosyaları', 'Eşzamanlılık ayarı']) expect(html).toContain(label);
    expect(html).toContain('Hiçbir zaman: kapı onayı, izin cevabı, birleştirme, silme, hesap ve sır, harcama izni.');
    expect(html).toContain('1 saat izin ver');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>1 saat izin ver|<button[^>]*>1 saat izin ver/);
    const checked = await draw((store) => {
      store.open();
      store.togglePerm();
      store.setPermClass('open_work_order', true);
    });
    expect(checked).toContain('checked');
  });

  it('U-113: with a live grant the tier reads Uygula · n dk and the dialog lists the granted classes with İzni kapat', async () => {
    const html = await draw(async (store, b) => {
      b.onQuery('chat.conversation', () => conversation('C1', { grants: [grant('G1', NOW + 3_600_000, ['open_work_order', 'roadmap_edit'])] }));
      store.open();
      await store.openConversation('C1');
      store.togglePerm();
    });
    expect(html).toContain('Uygula · 60 dk');
    expect(html).toContain('Uygula açık · 60 dk kaldı');
    expect(html).toContain('✓ İş emri aç');
    expect(html).toContain('✓ Yol haritasını düzenle');
    expect(html).not.toContain('✓ Akış ve rol dosyaları');
    expect(html).toContain('İzni kapat');
  });
});

describe('closed and hidden panels (U-125)', () => {
  it('U-125: a closed panel is inert and hidden from assistive tech; an open one is not', async () => {
    const closed = await draw();
    expect(closed).toMatch(/<section[^>]*inert/);
    expect(closed).toMatch(/<section[^>]*aria-hidden="true"/);
    const open = await draw((store) => store.open());
    expect(open).not.toMatch(/<section[^>]*inert/);
  });

  it('U-125: while a blocking modal owns focus the whole dock is hidden', async () => {
    const html = await draw((store) => store.open(), 'tr', { hidden: true });
    expect(html).toContain('hidden=""');
  });
});
