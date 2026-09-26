#!/usr/bin/env node
// Boundary checks — mechanical enforcement of the layering and identity rules (ADR-0006/0003/0001/0007).
// Origin WO-0005; extended by WO-0007 to cover the Electron shell (electron/ + src/renderer/); extended by
// WO-0006 (branded-type cast ban, all Node builtins, disabled object-key/data-disabled forms); extended by
// WO-0070 (c7 literal colours in src/ui, c8 non-ASCII display copy in src/ui — the ADR-0007 border checks
// over the labels allowlist). Each violation names the rule and its ADR. Runs in CI and locally
// (`npm run check:boundaries`). See CLAUDE.md and ADR-0011.
//
// The checks are deliberately name-independent where the rule must outlive a data-source change: the
// workspace-identity check matches the branded-identity *constructors* and a fixed historical literal, never a
// list read from fixtures (ADR-0003).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');

const VENDORS = ['claude', 'anthropic', 'cursor', 'copilot', 'gemini', 'openai', 'gpt'];
// NOTE: `cursor`/`gpt` are short and may collide with non-vendor usage (a Tailwind `cursor-pointer` class;
// base64 data). A hit on those is a stop-and-ask report (ADR-0011 gate 1), not a reason to narrow the list.
const BRAND = ['wid', 'rid', 'woid', 'tid']; // branded-identity constructors, defined in src/adapters/
// Node builtins as bare specifiers (the `node:` prefix is caught separately in c3). `electron` is the
// runtime, not a Node builtin, so it rides along. WO-0006 widened this from a 4-name list to every builtin.
const NODE_BUILTINS = new Set(builtinModules);
const isNodeSpecifier = (spec) => spec.startsWith('node:') || NODE_BUILTINS.has(spec) || spec === 'electron';
const COMPOSITION_ROOTS = new Set(['electron/main.ts']); // a composition root imports an adapter (ADR-0006; WO-0024's CLI root removed by WO-0073 — the one root is the Electron main)

// v1 rules apply to v1 code only; v2 layers (src/domain, application, api, infrastructure, presentation)
// are checked by scripts/check-layers.mjs.
const V2_DIRS = ['domain', 'application', 'api', 'infrastructure', 'presentation'].map((d) => join(SRC, d));
const files = [...walk(SRC), ...walk(join(ROOT, 'electron'))].filter((f) => !V2_DIRS.some((d) => f.startsWith(d + '/')));
const read = (f) => readFileSync(f, 'utf8').split('\n');
const rel = (f) => relative(ROOT, f);
const isTest = (r) => r.includes('/__tests__/') || /\.test\.[tj]sx?$/.test(r);
const isComment = (t) => { const s = t.trimStart(); return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'); };
const lineNo = (text, idx) => text.slice(0, idx).split('\n').length;
// Captures a module specifier after `from`, `import(`, `require(`, or a bare side-effect `import 'x'`.
const SPEC_RE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
const specOf = (m) => m[1] || m[2] || m[3] || m[4];
// `adapters` as a path *segment*, not a substring: './adapters/fixtures' yes, './adaptershelpers' no.
const importsAdapter = (spec) => spec.split('/').some((seg) => seg === 'adapters');

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.[tj]sx?$/.test(name)) acc.push(p);
  }
  return acc;
}

// 1 — no agent-vendor name in src/ outside the provider-adapter layer (ADR-0006).
//    ADR-0006 line 74-75 permits a vendor name "inside a provider adapter and its
//    configuration"; `src/adapters/` is that layer — the one place a provider SDK is
//    imported by its real package name. core/ui/renderer and electron/ stay vendor-neutral.
//    WO-0031c carve-out (architect ruling): the agent-CONFIGURATION surface literals `CLAUDE.md` and
//    `.claude/` are stripped before the test — core/risky.ts matches those exact paths to classify
//    writes; naming the config file is not naming the vendor's product in code.
const c1 = [];
const VENDOR_RE = new RegExp(`(${VENDORS.join('|')})`, 'i');
for (const f of files) {
  const r = rel(f);
  if (r.startsWith('src/adapters/')) continue;
  read(f).forEach((ln, i) => {
    const stripped = ln.replace(/claude\.md/gi, '').replace(/\.claude/g, '');
    const m = VENDOR_RE.exec(stripped);
    if (m) c1.push([f, i + 1, `agent-vendor name "${m[1].toLowerCase()}" (ADR-0006)`]);
  });
}

// 2a — no branded-identity constructor outside src/adapters/ (ADR-0003); tests may build identities
const c2a = [];
const BRAND_RE = new RegExp(`\\b(${BRAND.join('|')})\\s*\\(`);
for (const f of files) {
  const r = rel(f);
  if (r.startsWith('src/adapters/') || isTest(r) || COMPOSITION_ROOTS.has(r)) continue;
  read(f).forEach((ln, i) => {
    const m = BRAND_RE.exec(ln);
    if (m) c2a.push([f, i + 1, `branded-identity constructor '${m[1]}(' outside src/adapters/ (ADR-0003)`]);
  });
}

// 2b — pilot project name 'dateapp' nowhere in src/core/ or src/ui/ (ADR-0003; WO-0002 AC5)
const c2b = [];
const DATEAPP_RE = /dateapp/i;
for (const f of files) {
  const r = rel(f);
  if (!(r.startsWith('src/core/') || r.startsWith('src/ui/'))) continue;
  read(f).forEach((ln, i) => {
    if (DATEAPP_RE.test(ln)) c2b.push([f, i + 1, `pilot project name "dateapp" in core/ui (ADR-0003)`]);
  });
}

// 2c — no branded-type `as` cast outside src/adapters/ (ADR-0003); the cast form complements the
//    constructor check (2a). core/ui must not construct OR forge an identity; tests may build identities.
const c2c = [];
const CAST_RE = /\bas\s+(WorkspaceId|RepoId|WorkOrderId|TrackId)\b/;
for (const f of files) {
  const r = rel(f);
  if (r.startsWith('src/adapters/') || isTest(r) || COMPOSITION_ROOTS.has(r)) continue;
  read(f).forEach((ln, i) => {
    const m = CAST_RE.exec(ln);
    if (m) c2c.push([f, i + 1, `'as ${m[1]}' identity cast outside src/adapters/ (ADR-0003)`]);
  });
}

// 3 — no Node/Electron import in src/core/, src/ui/ or src/renderer/ (ADR-0006); specifier match, not substring
const c3 = [];
for (const f of files) {
  const r = rel(f);
  if (!(r.startsWith('src/core/') || r.startsWith('src/ui/') || r.startsWith('src/renderer/'))) continue;
  const text = readFileSync(f, 'utf8');
  SPEC_RE.lastIndex = 0;
  for (let m; (m = SPEC_RE.exec(text));) {
    const spec = specOf(m);
    if (spec && isNodeSpecifier(spec)) {
      c3.push([f, lineNo(text, m.index), `Node/Electron import "${spec}" in core/ui/renderer (ADR-0006)`]);
    }
  }
}

// 4 — no adapter import outside the composition root (ADR-0006); tests may import fixtures
const c4 = [];
for (const f of files) {
  const r = rel(f);
  if (r.startsWith('src/adapters/') || isTest(r) || COMPOSITION_ROOTS.has(r)) continue;
  const text = readFileSync(f, 'utf8');
  SPEC_RE.lastIndex = 0;
  for (let m; (m = SPEC_RE.exec(text));) {
    const spec = specOf(m);
    if (spec && importsAdapter(spec)) {
      c4.push([f, lineNo(text, m.index), `adapter import "${spec}" outside composition root (ADR-0006)`]);
    }
  }
}

// 5 — no disabled/aria-disabled/data-disabled control in src/ui/ (ADR-0001); excludes Tailwind `disabled:` variant
const c5 = [];
const DISABLED_RE = /(?<!-)\bdisabled\b(?!:)/; // boolean shorthand `disabled` or prop `disabled=`; not aria-disabled, not Tailwind `disabled:`
const ARIA_DISABLED_RE = /\baria-disabled\b(?!:)/;
const DISABLED_KEY_RE = /\bdisabled\s*:\s*(?:true|false)\b/; // object-key form `{ disabled: true }` / `{...{ disabled: false }}` — a Tailwind variant is followed by a utility, never a boolean
const DATA_DISABLED_RE = /\bdata-disabled\b/; // the `(?<!-)` lookbehind above lets `data-disabled` through on purpose; this closes it
for (const f of files) {
  if (!rel(f).startsWith('src/ui/')) continue;
  read(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (DISABLED_RE.test(ln) || ARIA_DISABLED_RE.test(ln) || DISABLED_KEY_RE.test(ln) || DATA_DISABLED_RE.test(ln))
      c5.push([f, i + 1, `disabled/aria-disabled/data-disabled control in src/ui (ADR-0001)`]);
  });
}

// 6 — .replace( in src/ui is a PROXY for "no raw identifier rendered as display text" (ADR-0007)
const c6 = [];
const REPLACE_RE = /\.replace\(/;
const PROXY = `.replace( in src/ui — PROXY for ADR-0007 (no raw identifier rendered as display text; a \${value} template literal is another shape this does not catch). A legitimate use is an architect decision, not a workaround`;
for (const f of files) {
  if (!rel(f).startsWith('src/ui/')) continue;
  read(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    if (REPLACE_RE.test(ln)) c6.push([f, i + 1, PROXY]);
  });
}

// WO-0070 — the two display-vocabulary BORDER checks (ADR-0007, WO-0035). Both scan src/ui ONLY and
// exempt `src/ui/data/` (the labels/marks home — the check guards the border, not the dictionary) and
// test files. Both are proxies in the c5/c6 shape: greppable, deterministic, no JSX parser.
const uiOnly = files.filter((f) => rel(f).startsWith('src/ui/') && !rel(f).startsWith('src/ui/data/') && !isTest(rel(f)));

// 7 — no literal COLOUR in src/ui (ADR-0007): the palette lives in CSS tokens (`var(--…)`); a
//    #hex / rgb( / hsl( literal is a colour the tokens do not know. Tailwind arbitrary-value tokens
//    (`text-[var(--x)]`) do not match; `#fff` inside a className does. Comment lines are skipped.
const c7 = [];
const COLOUR_RE = /(#[0-9A-Fa-f]{3,8}\b|rgba?\(|hsla?\()/;
for (const f of uiOnly) {
  read(f).forEach((ln, i) => {
    if (isComment(ln)) return;
    const m = COLOUR_RE.exec(ln);
    if (m) c7.push([f, i + 1, `literal colour "${m[1]}" in src/ui — the palette is CSS tokens, var(--…) (ADR-0007)`]);
  });
}

// 8 — no NON-ASCII display copy in src/ui (ADR-0007): Turkish copy lives in src/ui/data/labels/ —
//    the cheap deterministic proxy for "a word a human reads" is a Latin-letter outside ASCII
//    (À-ɏ Latin-1 supplement + Latin extended — ı ğ ş ç ö ü are all inside — plus
//    ؀-ۿ); the local-independent glyphs (· — → ✓ ✦ ⏎) sit above U+024F and pass.
//    Whole-line comments AND comment tails / JSX `{/* … */}` blocks are stripped first (a comment is
//    never display copy); a per-line stripper keeps it deterministic without a JSX parser.
const c8 = [];
const NON_ASCII_RE = /[À-ɏ؀-ۿ]/;
// Stateful across a file's lines: a `/*` opened on one line stays open until its `*/`.
const commentStripper = () => {
  let inBlock = false;
  return (line) => {
    let out = '';
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf('*/', i);
        if (end === -1) { i = line.length; } else { inBlock = false; i = end + 2; }
        continue;
      }
      const open = line.indexOf('/*', i);
      const lineC = line.indexOf('//', i);
      if (lineC !== -1 && (open === -1 || lineC < open)) return out; // the rest is a line comment
      if (open !== -1) { out += line.slice(i, open); inBlock = true; i = open + 2; continue; }
      out += line.slice(i);
      break;
    }
    return out;
  };
};
for (const f of uiOnly) {
  const strip = commentStripper();
  read(f).forEach((ln, i) => {
    const m = NON_ASCII_RE.exec(strip(ln));
    if (m) c8.push([f, i + 1, `non-ASCII character "${m[0]}" (U+${m[0].codePointAt(0).toString(16).toUpperCase()}) in src/ui — display copy lives in src/ui/data/labels/ (ADR-0007)`]);
  });
}

const checks = [
  ['agent-vendor names (ADR-0006)', c1],
  ['branded-identity constructors (ADR-0003)', c2a],
  ['branded-type casts (ADR-0003)', c2c],
  ['dateapp literal (ADR-0003)', c2b],
  ['Node/Electron imports (ADR-0006)', c3],
  ['adapter imports (ADR-0006)', c4],
  ['disabled / aria-disabled / data-disabled (ADR-0001)', c5],
  ['.replace( proxy (ADR-0007)', c6],
  ['literal colours in src/ui (ADR-0007)', c7],
  ['non-ASCII display copy in src/ui (ADR-0007)', c8],
];

console.log('\nwo-0005 boundary checks');
let total = 0;
for (const [name, v] of checks) {
  total += v.length;
  if (v.length) {
    console.log(`\n[FAIL] ${name}`);
    for (const [f, line, msg] of v) console.log(`  ${rel(f)}:${line}  ${msg}`);
  } else {
    console.log(`[ ok ] ${name}`);
  }
}
console.log(`\n${total === 0 ? 'boundary checks clean' : `${total} boundary violation(s)`}`);
process.exit(total === 0 ? 0 : 1);
