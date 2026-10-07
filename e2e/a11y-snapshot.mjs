// e2e/a11y-snapshot.mjs — `node e2e/a11y-snapshot.mjs` (after npm run build; the third leg of
// test:ui:report). For every audited screen — the audit's own SCREENS list — it writes the
// accessibility tree of the BUILT app to e2e/.out/a11y/<screen>.json, so a reviewer can read what
// a screen contains, and diff two runs, without launching anything.
//
// Source of the tree: playwright's aria snapshot of <body>, parsed into JSON nodes. The playwright
// this repo pins (1.62) no longer carries the old page.accessibility JSON API, and its snapshot
// grammar is the supported surface — so the YAML string is parsed with a reader for exactly that
// grammar. The snapshot knows no `focusable` flag; the honest fields are role, name, text, level,
// disabled and the remaining bracket attributes (expanded, checked, …) kept verbatim, in the
// tree's own order, which is DOM order.
//
// File contract: { screen, size, theme, nodes }, every node
//   { role: string, name: string, text: string, attrs: string[], level: number | null,
//     disabled: boolean, children: node[] }
// — the same shape for every node, so a consumer never branches on which keys exist.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, launchDesignApp, screenNavigator, setWindow } from './design-app.mjs';
import { acquireE2eLock } from './lock.mjs';
import { resolveSizes, SCREENS } from './layout-rules.mjs';

const OUT = join(ROOT, 'e2e', '.out', 'a11y');

/** Read one aria-snapshot line's body (the `- ` prefix already gone) into a node. The name is the
 *  quoted span taken verbatim, so a `[` or `:` inside a name can never be read as an attribute or
 *  a content colon. */
const parseNode = (line) => {
  const node = { role: '', name: '', text: '', attrs: [], level: null, disabled: false, children: [] };
  let i = 0;
  const role = /^[^\s[:"']*/.exec(line)[0];
  node.role = role;
  i = role.length;
  if (line[i] === ' ' && line[i + 1] === '"') {
    i += 2;
    let name = '';
    for (; i < line.length && line[i] !== '"'; i += 1) {
      // A backslash only escapes the character that follows it inside the quotes.
      if (line[i] === '\\' && i + 1 < line.length) i += 1;
      name += line[i];
    }
    i += 1; // the closing quote
    node.name = name;
  }
  while (line[i] === ' ' && line[i + 1] === '[') {
    i += 1;
    const end = line.indexOf(']', i);
    if (end === -1) break; // an unterminated group is not ours to guess at — drop it
    const attr = line.slice(i + 1, end);
    i = end + 1;
    if (attr === 'disabled') node.disabled = true;
    else if (attr.startsWith('level=')) node.level = Number(attr.slice('level='.length));
    else node.attrs.push(attr);
  }
  if (line[i] === ':') {
    node.text = line.slice(i + 1).trim();
    if (node.text.startsWith('"') && node.text.endsWith('"') && node.text.length >= 2) {
      node.text = node.text.slice(1, -1);
    }
  }
  return node;
};

/** Parse an aria snapshot (YAML string) into the node tree. The grammar is two spaces of indent
 *  per level and one node per `- ` line; anything else is a shape this reader must not guess at. */
const parseAriaSnapshot = (yaml) => {
  const roots = [];
  const stack = [{ depth: -1, children: roots }];
  for (const raw of yaml.split('\n')) {
    if (raw.trim() === '') continue;
    const depth = Math.floor((raw.length - raw.trimStart().length) / 2);
    const line = raw.trim();
    if (!line.startsWith('- ')) throw new Error(`unparsable aria-snapshot line: ${raw}`);
    const node = parseNode(line.slice(2));
    while (stack[stack.length - 1].depth >= depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push({ depth, children: node.children });
  }
  return roots;
};

const countRoles = function* countRoles(nodes, wanted) {
  for (const node of nodes) {
    if (wanted.includes(node.role)) yield node.role;
    yield* countRoles(node.children, wanted);
  }
};

const countNodes = (nodes) => nodes.reduce((n, node) => n + 1 + countNodes(node.children), 0);

mkdirSync(OUT, { recursive: true });
await acquireE2eLock(ROOT);
const handle = await launchDesignApp();
// The audit's default standing — the default window, dark — so the file shows the screen the way
// the operator's first look at it goes.
const { size } = (await resolveSizes(handle.app)).find((s) => s.name === 'default');
const [width, height] = size;
await setWindow(handle, size, 'dark');
const goto = screenNavigator(handle.page);

let failures = 0;
/** Walk one screen, snapshot it, write its file. Returns true when the file landed. */
const capture = async (screen, reach) => {
  const { page } = handle;
  try {
    await reach();
    // A fixed settle is not enough under load: right after the audit and the journeys the machine
    // is busy, and a cockpit snapshot taken mid-load shrinks to its skeleton. The app's own
    // loaded-signal — no [data-skeleton] left — is waited for first, so two runs of this file
    // describe the same standing; a timeout still snapshots what is honestly there.
    await page
      .waitForFunction(() => document.querySelectorAll('[data-skeleton]').length === 0, null, { timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForTimeout(450); // the settle the audit grants every screen
    const nodes = parseAriaSnapshot(await page.locator('body').ariaSnapshot());
    const buttons = [...countRoles(nodes, ['button'])].length;
    const headings = [...countRoles(nodes, ['heading'])].length;
    // The acceptance's own gate: a tree with neither a button nor a heading is a screen the
    // snapshot failed to read, and the run must say so instead of shipping an empty file quietly.
    const ok = buttons + headings > 0;
    if (!ok) failures += 1;
    writeFileSync(
      join(OUT, `${screen}.json`),
      `${JSON.stringify({ screen, size: `${width}x${height}`, theme: 'dark', nodes }, null, 2)}\n`,
    );
    console.log(`a11y: ${screen} ${width}x${height} dark ${ok ? 'ok' : 'FAIL'} ${countNodes(nodes)} nodes, ${buttons} button / ${headings} heading`);
    return true;
  } catch (error) {
    failures += 1;
    console.log(`a11y: ${screen} ${width}x${height} dark FAIL unreachable: ${String(error).split('\n')[0]}`);
    return false;
  }
};

for (const screen of SCREENS.filter((s) => s !== 'hesap')) {
  await capture(screen, async () => {
    await goto[screen]();
    // The board's view choice persists per repo, so the Kanban standing must be re-entered the
    // way the audit's show() does — otherwise `pano` could land on what `liste` left behind.
    if (screen === 'pano') {
      await handle.page.getByRole('button', { name: 'Kanban' }).first().click({ timeout: 1500 });
    }
  });
}
// `hesap` walks last, on its own patient path. The account reader's re-query after any navigation
// is the slow one this branch still carries — its catalog skip is a separate open issue — so the
// card is waited out explicitly instead of riding the shared navigator's fast click budget.
await capture('hesap', async () => {
  const { page } = handle;
  const collapsed = await page
    .locator('[data-accounts-body]')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height <= 1)
    .catch(() => true);
  if (collapsed) {
    await page.getByRole('button', { name: 'Hesapları gizle / göster' }).first().click({ timeout: 4000 });
  }
  await page.waitForFunction(() => document.querySelectorAll('[data-provider-mark]').length > 0, null, { timeout: 20_000 });
  await page.locator('nav button').filter({ hasText: 'Claude Max' }).first().click({ timeout: 4000 });
});
await handle.app.close();
console.log(`a11y: snapshots in ${OUT}`);
process.exit(failures === 0 ? 0 : 1);
