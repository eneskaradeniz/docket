# Docket v2 — the current design language

This is the design language of the app **as it ships today**, written down from the code and from
[ui.md](ui.md). Nothing here is new: every statement cites a source path or a rule id (`U-n` is a
rule of [ui.md](ui.md)). Where the code does not decide, the point is listed under
[Not decided](#not-decided). It is a start for a prototype ([#1403](https://github.com/eneskaradeniz/docket/issues/1403)),
not a redesign.

Paths are repo-relative. `tokens.css` is `src/presentation/styles/tokens.css`; `index.css` is
`src/index.css`. The tokens are the only source of colour and face: nothing else in the presentation
layer defines a colour or a font from scratch (`tokens.css`, header comment).

## 1. What it looks like

- A dark, near-black console by default; a warm off-white face exists and is chosen in Settings
  (Sistem · Koyu · Açık, U-36; `tokens.css` `:root[data-theme='light']`).
- Calm, flat surfaces separated by hairlines, with one amber accent that means "the operator is
  needed" (U-373). Sans for words, mono only for machine data (U-372).
- Pages are full-width sections; empty states are cards (U-54, U-180). Docket AI is one round button
  at the bottom right that opens a panel over any screen (U-101).
- Seen in the e2e journey captures (local run output, not part of the repo): the Kanban board
  (J-2), the work-order detail with its stage strip (J-3), the cockpit and chat button (J-15), dark
  and light.

## 2. Colour

Values are copied from `tokens.css` (`:root` and `:root[data-theme='light']`). Utilities are
generated from them through the `@theme` bridge (`bg-surface`, `text-ink`, `border-hairline`,
`border-bord`, `text-signal-ink`, …; `text-inkdim` is the legacy utility name of `--dim`).

| Token | Dark | Light | Role (source) |
| --- | --- | --- | --- |
| `--bg` | `#000` | `#fafaf8` | Page ground |
| `--surface` | `#0a0a0a` | `#fff` | Cards, floating surfaces (`section-card.tsx`, `chat-style.tsx` `FLOATING`) |
| `--raised` | `#161616` | `#f2f2f0` | Hover, selected row/segment, chips (`segmented-control.tsx`, `chat-style.tsx`) |
| `--band` | `#0c0c0c` | `#f5f5f2` | Quiet band (hover on small icon buttons, `chat-style.tsx`) |
| `--hair` | `#262626` | `#e3e3e0` | Hairline edge of rows and cards |
| `--bord` | `#3a3a3a` | `#c9c9c4` | Visible edge: outline buttons, menus (`action-button.tsx`) |
| `--ink` | `#f2f2f2` | `#191917` | Text |
| `--dim` | `#8f8f8f` | `#6e6e69` | Secondary text |
| `--signal` | `#f5b544` | `#f5b544` | The amber: the one primary action, the operator is needed (U-373, U-375) |
| `--signal-soft` | `#f5b544` | `#8f5f00` | Small amber text and focus ring; AA on light (`tokens.css` comment: 5.05 / 4.92 / 5.52:1) |
| `--signal-ink` | `#000` | `#1c1300` | Text on the amber fill |
| `--proceed` | `#4cc38a` | `#1a7f37` | Running, done, healthy |
| `--info` | `#6ca0ce` | `#0969da` | Info |
| `--error` | `#e5484d` | `#cf222e` | Failure |
| `--write` | `#a371f7` | `#8250df` | Tool kind: the repo changed |
| `--exec` | `#4ac3ce` | `#4ac3ce` | Tool kind: a command ran (no light value, `tokens.css`) |

Rules:

- **Amber has one meaning**: the operator is needed — an open ask, a pending gate, an account not yet
  added, a meter in its warning band — and it fills the view's single primary button (U-373).
- **Selection is neutral**: a raised surface with ink text, never amber (U-373, U-371).
- **Meter colour** follows what remains: 40 % or more proceed, 15–40 % amber, under 15 % red (U-51).
- Status is a lamp plus a word; colour never carries it alone (`board-card.tsx`, `status-lamp.tsx`).
- Focus ring: `--signal-soft`, 2 px, 2 px offset (`chat-style.tsx` `FOCUS`; global ring in `index.css`
  uses `--color-signal`).

## 3. Type

- **Faces** (`tokens.css` `--sans`, `--mono`; bundled in `index.css` through `@fontsource`):
  Manrope 400 / 500 / 600 / 700 for prose; IBM Plex Mono 400 / 500 / 600 for machine data.
  Fallbacks: `system-ui` and `ui-monospace` stacks.
- **Mono is for machine data alone** — paths, versions, commands, ids, money, a work-order code
  (`İE-0016`, U-22). Never a status chip, a segment option, a section header, a name or a standing
  word (U-372, U-28). A source scan pins it (`src/presentation/mono-scale.test.ts`).
- **Section title**: 20 px / 700, plain text, no boxed header, no upper-case label (U-28, U-376).
  Sidebar section headers 14 / 700, rows 13.5–14, helper text at least 12 (U-51). Assistant body
  text 14 / 20 (U-198).
- **Sizes in use** are rem values written inline (no named scale). The most used, counted over
  `src/presentation/**/*.tsx`: `0.8125rem` (133 uses), `0.75rem` (87), `0.6875rem` (78),
  `0.78125rem` (65), `0.875rem` (49); buttons use `0.78125rem` and `0.84375rem` (`action-button.tsx`).
- **Weights in use** (same count): `font-semibold` 184, `font-bold` 74, `font-medium` 42,
  `font-normal` 8.
- **Proportional scale**: one rule on the root grows the whole interface with the window — 1440 px
  anchors 100 %, clamped 100–125 % (`tokens.css` `html`, U-53). No other rule may touch the root
  font size; lengths are rem, px stays only for hairlines (U-53).
- The frozen v1 sheet keeps a mono, uppercase, 0.08em `.readout` line (`index.css`); `SectionCard`
  still draws its header that way (`section-card.tsx`), against U-28 and U-376 — see
  [Not decided](#not-decided).

## 4. Radius, spacing, elevation

**Radius** — three tokens and `rounded-full`, nothing else; a test scans the sources (U-23,
`src/presentation/radius-scale.test.ts`):

| Utility | Value | Used for (U-23) |
| --- | --- | --- |
| `rounded-control` | 6 px | Buttons, inputs, tabs, segments, icon buttons, hover rows, chips |
| `rounded-card` | 8 px | Bordered boxes: cards, alerts, sections, bordered rows, sidebar frames |
| `rounded-panel` | 12 px | Floating or card-holding surfaces: modals, search palette, Settings panel, Kanban lanes |
| `rounded-full` | — | Lamps, round badges, the Docket AI button |

**Spacing** — no spacing token exists. The chat styles sit on 4·8·12·16·20·24·32
(`chat-style.tsx` header); decision cards stack 12 px apart, `gap-3` (U-227); dock header buttons
8 px apart (U-198). Lengths are rem (U-53, U-179).

**Elevation** — three tokens, no other shadow (U-374; `tokens.css`, `elevation-scale.test.ts`):

| Token / utility | Dark | Light | For |
| --- | --- | --- | --- |
| `elevation-flat` / `shadow-elevation-flat` | `0 0 #0000` | `0 0 #0000` | List rows, flat rows in a card: a hairline, no shadow |
| `elevation-card` / `shadow-elevation-card` | `0 0 #0000` | `0 1px 2px rgba(0,0,0,0.05)` | Cards, Settings and detail card sections; in dark the card is a surface above the page |
| `elevation-overlay` / `shadow-elevation-overlay` | `0 1rem 3rem rgba(0,0,0,0.5)` | `0 1rem 2.5rem rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.12)` | Modals, palette, Settings panel, menus, popovers |

## 5. Buttons

- Three tiers: `primary` (amber fill), `neutral` (1 px outline in `--bord`), `ghost` (borderless, icon
  only — a text label on a ghost is drawn as the outline) (U-216, `action-button.tsx`).
- **One primary per view.** Every other button is the outline, or a tertiary text link where U-219
  allows one (U-375). `InlineLink` appears only inside running text, underlined and focusable (U-219).
- Heights: `md` 2 rem, `sm` 1.75 rem, radius `rounded-control` (U-218).
- A disabled button keeps its own look at reduced opacity with `cursor: not-allowed` — no grey fill
  (U-375; `chat-style.tsx` uses `opacity-45`).
- Text-only borderless buttons are banned outside the icon-button host and the `InlineLink`
  allow-list (U-217).
- Exclusive choices of two to four options are one segment control; five or more use a listbox;
  chips are for multi-select and filters (U-371).

## 6. Layout

- **Shell** (`src/presentation/screens/shell.tsx`): a 40 px title bar (2.5 rem, U-193), a sidebar
  of 16.5 rem (264 px at 1440, 330 px at 2560; `tokens.css` `html` comment, U-53) and the content
  area. The sidebar holds the nav rows of 32 px, the project tree, then the Hesaplar frame
  (`sidebar-nav.tsx`, U-51).
- **Full-width sections.** The four data screens (cockpit, account view, work-order detail,
  roadmap) fill the main area: no `max-w-*` on page wrappers, fixed rem padding, content
  left-aligned; reading text inside a full-width card keeps at most 62ch (U-54).
- **Deliberately narrow**: search palette (560 px), Settings and wizard window (1040×680 at most,
  U-46), AccountEditor (820×600, U-43), Yeni proje card (880×580, U-40), empty-state cards (U-54;
  px sizes listed in `ui.md` under U-53's constraints).
- **Columns follow the main container, not the viewport** (`@container`): below 900 px one column,
  from 900 two, from 1500 three; the detail's live pane is a fixed 22.5 rem column from 900 and its
  third column (21.25 rem) from 1700 (U-55). Card grids use `repeat(auto-fill, minmax(min, 1fr))`
  with rem minimums (U-55). A row that fits on one line keeps natural cards and gives the rest to a
  `1fr` side panel (U-56).
- **Panels and windows**: the setup wizard and Settings share one `Window` frame — a 200 px left
  column, a head, a scrolling body, an optional footer band (`window-frame.tsx`, U-41, U-46); the
  frame sits in `panel-overlay.tsx` over a blurred scrim.
- **Board**: columns are the flow's stages, the done work is the last column; Kanban ⇄ Liste is an
  icon segment control; a folded column is a 48 px rail (U-18).
- **In-place detail**: it replaces the board, no overlay; `‹ Geri` returns with view state (U-19).
- **Chat dock**: one `ChatDock` at the app root over every screen (U-101). A round button at the
  bottom right opens a non-modal panel of at most `26rem × 38rem`, `shadow-elevation-overlay`
  (`chat-dock.tsx`). "Genişlet" turns it into a surface covering the content area only, the sidebar
  and title bar staying, corners still `rounded-panel` (U-193, U-196). Screens that scroll under the
  button end with `pb-[5rem]` clearance (`chat-dock.tsx`). The toast stack steps left of the open
  panel (U-50b).
- **Empty states are cards**, dashed, one title and one sentence (U-180; e.g. `board.empty.stage`,
  `cockpit.attention.empty` in `tr.ts`; sidebar "no project" box, U-51).
- **Toasts**: one `ToastHost`, top right, 16 px from the edges, at most three, 5 s (warn and error
  8 s), progress line, paused on hover or focus; `aria-live` polite, assertive for error (U-50).

## 7. Components in use

One line each, grouped; all in `src/presentation/components/` (headers are the source).

- **Buttons and controls**: `action-button` (three tiers), `inline-link` (tertiary, in prose),
  `segmented-control` (pick-one, current raised, U-371), `listbox` (five or more options, U-41),
  `setting-row` (title + one sentence + one control, U-29), `drag-order-list` (grip-only
  reordering, U-47), `rescan-button`, `removal-action-button`.
- **Surfaces**: `section-card` (hairline card with header and action slot), `settings-cards`,
  `window-frame` + `panel-overlay` (wizard and Settings), `detail-dialog`, `quit-dialog`,
  `permission-prompt` (modal, session-only grant, U-272…U-279), `search-palette` (centred modal,
  U-15), `info-bubble` (every ⓘ and `?`, U-27), `toast-host` (U-50), `error-boundary`.
- **Status**: `status-lamp` (8 px lamp + word), `state-badge` (chip, mono lowercase), `version-badge`,
  `provider-mark` (inline SVG in the row's text colour, U-21), `meter-list` (one row per limit,
  remaining from the left, U-44), `skeleton` (raised-tone placeholder, U-26).
- **Navigation**: `title-bar` (drag strip), `sidebar-nav`, `sidebar-tree`, `sidebar-accounts`,
  `settings-menu`, `project-menu`.
- **Board and cockpit**: `board-kanban`, `board-column`, `board-card` (code, two-line title, lamp +
  word, U-18), `board-list`, `cockpit-section` (foldable), `cockpit-attention`, `cockpit-running`,
  `cockpit-closed`, `cockpit-projects`, `cockpit-states`, `roadmap-repo-layer`.
- **Work-order detail**: `detail-strip` (ordered stage segments, U-224), `flow-strip` (read-only
  repo flow, U-290), `detail-decision-card` ("Bu aşamada senden beklenen", U-226), `detail-run-card`,
  `detail-files`, `detail-usage-line`, `detail-work-order-usage`.
- **Chat**: `chat-dock`, `chat-feed`, `chat-composer`, `chat-history`, `chat-launcher`,
  `chat-icons`, `chat-style` (shared class strings), `chat-image-preview`, `chat-image-enlarge-dialog`.
- **Settings and setup**: `account-groups`, `account-editor`, `account-editor-dialog`,
  `capability-section`, `roles-section`, `connectors-section`, `concurrency-section`,
  `limit-policy-section`, `memory-section`, `autonomy-control`, `autonomy-ceiling-control`,
  `appearance-rows`, `setup-*` (wizard steps), `new-work-order-window`.

## 8. Voice

- **Turkish first.** `DEFAULT_LOCALE` is `tr`; English is the peer, and a key missing in English
  falls back to Turkish (`src/presentation/labels/t.ts`, U-9). Both bundles carry exactly the typed
  keys (`labels/keys.ts`, `tr.ts`, `en.ts`, U-1).
- **Copy lives in the label bundles**, never inline in a component (U-279, U-199, U-383).
- **Short.** Every sentence of new copy is at most 8 words in both bundles (U-178, U-383). Older
  strings are not bound: for example `workOrder.new.openBranchesHint` is longer (`tr.ts`).
- **Plain and direct**, as the bundles read: "Senden bekleyen yok", "Bu aşamada iş yok.",
  "Henüz kapanan iş yok", "Docket AI ile birlikte kur", "Onayla ve ilerle", "Sorun var"
  (`tr.ts`; captures J-3, J-15). Empty states say what is missing in one title and one sentence.
- **One word per state** in the status badge: Hazır, Koşuyor, Onay bekliyor, Tamamlandı, Başarısız
  (U-223). A gate row prints one word, its policy ("İnsan onayı"); the rest sits in `title` (U-376).
- **Terms** are the glossary of [README.md](README.md): Sağlayıcı, Hesap, Rol, Akış, Aşama, Kapı,
  İş emri, Koşu, Kayıt. A work order is shown by its code `İE-0014` in TR, `WO-0014` in EN (U-22).
- **Sentence case** is what the bundles show; no rule states it (see [Not decided](#not-decided)).

## 9. Motion

- **Where motion is allowed**: animations and transitions are written with `motion-safe:` and carry
  a `motion-reduce:` face (opacity-only, `--motion-reduced` 80 ms) across `src/presentation`;
  the v1 sheet adds one `prefers-reduced-motion` block that stills every named animation
  (`motion.ts`, `index.css` end of file, U-198).
- **Numbers live in one file**: `src/presentation/components/motion.ts` (`MOTION`).
  Search palette: backdrop 320 ms, panel 380 ms after a 90 ms delay, rise 12 px, scale from 0.97,
  easing `cubic-bezier(0.22, 1, 0.36, 1)`, close 220 ms; results fade 180 ms, stagger 25 ms for the
  first six rows, debounce 120 ms. Board: hover 160 ms, column fold 200 ms, running lamp pulse
  1800 ms. Info bubble fade 120 ms (U-27).
- **Loading**: a skeleton appears only after 150 ms and holds at least 300 ms (U-26). A scan
  holds at least 400 ms, groups enter 40 ms apart (U-52). The thin scan line slides across its track
  (`tokens.css` `scan`, U-42).
- **Toast**: slides in from the right, its progress line drains over its own duration (`tokens.css`
  `toast-in`, `toast-drain`, U-50). **Finishing step**: its check draws itself once (`check-draw`,
  U-49); a reduced-motion page shows the finished check.
- **What moves and why** (`index.css`, comments): a lamp breathes while a state stands (amber waits,
  blue runs, green dot live); a surface entering view glides in once, ≤ 400 ms, translate and fade
  only; a status flip washes once, ≤ 400 ms; the cost counter is never animated.
- **Dialogs and panels** open with a short rise and fade (`dialog-rise` 0.15 s, `index.css`;
  palette numbers above).

## Not decided

The code and ui.md do not settle these; nothing here fills them in.

1. **A named type scale.** Sizes are inline rem values (about a dozen distinct sizes in use); only
   section titles (20/700), sidebar (14/700, 13.5–14, ≥ 12) and assistant text (14/20) are fixed
   (U-28, U-51, U-198).
2. **A spacing scale** outside the chat styles (`chat-style.tsx`) and the 12 px decision gap (U-227).
3. **Mono in headers.** `section-card.tsx` and the v1 `.readout` class draw mono uppercase headers;
   U-28, U-372 and U-376 say a section title is plain 20/700 and mono is machine data only. U-372
   says the fixes are follow-up issues.
4. **The `--remote` tool colour** (`#d879b8` dark, `#bf3989` light) exists only in the v1 sheet
   (`index.css`), not in `tokens.css`; it is not part of the token layer yet. `--exec` has no
   light value (`tokens.css`).
5. **The v1 sheet and `tokens.css` overlap.** `index.css` still declares its own `@theme` values
   (for example raised `#171717`, a white light `--bg`); `tokens.css` pins the contested names
   (`--color-bg`, `--color-raised`, `--color-signal`, `--color-exec`, fonts) but the rest agree only by
   value. Whether the v1 sheet is retired is not decided. The `tokens.css` header still says "the
   book is dark-only", while the light face and U-36 exist.
6. **Sentence case** is not written as a rule; it is what the bundles show.
7. **The 8-word limit** binds new copy only (U-178); older strings are not audited.
8. **A destructive primary.** `action-button.tsx` has a red primary (`DANGER_PRIMARY_CLASS`); U-375
   speaks of one amber primary and does not mention it.
9. **px-fixed surfaces** (Settings window, AccountEditor, Yeni proje card, palette, title bar
   controls) do not grow with the proportional scale; whether each moves to rem is the architect's
   follow-up decision (`ui.md`, constraints under U-53 … U-56).
10. **Motion tokens in CSS.** Durations are in `motion.ts` and in many literals in `index.css`;
    there is no single CSS motion token set.
