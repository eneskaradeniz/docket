#!/usr/bin/env node
// v2 layer checks — mechanical enforcement of docs/v2/architecture.md and the module dependency map
// in docs/v2/domain.md. Runs as part of `npm run check:boundaries`. Every violation names its rule.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');

const V2_LAYERS = ['domain', 'application', 'api', 'infrastructure', 'presentation'];
const V1_DIRS = ['core', 'adapters', 'ui', 'renderer'];

// Which layers a layer may import from (relative imports inside src/).
const LAYER_ALLOW = {
  domain: ['domain'],
  application: ['domain', 'application'],
  api: ['domain', 'application', 'api'],
  infrastructure: ['domain', 'application', 'api', 'infrastructure'],
  presentation: ['domain', 'api', 'presentation'],
};
// Bare (package) specifiers a layer may import.
const PACKAGE_ALLOW = {
  domain: () => false,
  application: () => false,
  api: () => false,
  infrastructure: () => true,
  presentation: (spec) => spec === 'react' || spec.startsWith('react/') || spec === 'react-dom' || spec.startsWith('react-dom/'),
};
// Module dependency map inside src/domain (docs/v2/domain.md).
const DOMAIN_MODULES = {
  shared: [],
  definitions: ['shared'],
  quota: ['shared'],
  budget: ['shared'],
  proposal: ['shared'],
  resolver: ['shared', 'definitions', 'quota'],
  gates: ['shared', 'definitions'],
  providers: ['shared', 'quota'],
  library: ['shared', 'definitions'],
  flow: ['shared', 'definitions', 'gates'],
  dispatch: ['shared', 'quota', 'budget'],
  roadmap: ['shared', 'flow'],
  // Cross-module scenario tests only (no production code): may import every module.
  scenarios: ['shared', 'definitions', 'quota', 'budget', 'proposal', 'resolver', 'gates', 'providers', 'library', 'flow', 'dispatch', 'roadmap'],
};
const VENDOR_RE = /\b(claude|anthropic|codex|openai|gpt|gemini|antigravity|cursor|copilot)\b/i;
const IMPURE_RE = /\bDate\.now\b|\bnew Date\b|\bMath\.random\b|\bcrypto\b|\bperformance\.now\b/;
const ANY_RE = /(:\s*any\b|\bas\s+any\b|<any>|\bany\[\])/;
const DEFAULT_EXPORT_RE = /\bexport\s+default\b/;
const SPEC_RE = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]|\bimport\s+['"]([^'"]+)['"]/g;
const NODE_BUILTINS = new Set(builtinModules);
const isNodeSpec = (s) => s.startsWith('node:') || NODE_BUILTINS.has(s) || s === 'electron';

const violations = [];
const report = (file, line, rule, detail) => violations.push(`${relative(ROOT, file)}:${line}  [${rule}] ${detail}`);

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|mjs|js)$/.test(name)) acc.push(p);
  }
  return acc;
}
const isTest = (f) => /\.test\.tsx?$/.test(f);
const isCommentLine = (t) => { const s = t.trimStart(); return s.startsWith('//') || s.startsWith('*') || s.startsWith('/*'); };
const topDir = (absPath) => relative(SRC, absPath).split(sep)[0];
const lineOf = (text, idx) => text.slice(0, idx).split('\n').length;

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return base; // unresolved: still classify by path
}

// --- v2 files ---------------------------------------------------------------------------------------
for (const layer of V2_LAYERS) {
  for (const file of walk(join(SRC, layer))) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    const test = isTest(file);

    for (const m of text.matchAll(SPEC_RE)) {
      const spec = m[1] || m[2] || m[3] || m[4];
      const ln = lineOf(text, m.index);
      if (spec.startsWith('.')) {
        const target = resolveRelative(file, spec);
        if (!target.startsWith(SRC + sep)) { report(file, ln, 'L1 layer', `import leaves src/: ${spec}`); continue; }
        const tl = topDir(target);
        if (V1_DIRS.includes(tl)) { report(file, ln, 'L2 v1-isolation', `v2 code imports v1 code (${tl}/): ${spec}`); continue; }
        if (!LAYER_ALLOW[layer].includes(tl)) { report(file, ln, 'L1 layer', `${layer} may not import ${tl}: ${spec}`); continue; }
        if (layer === 'domain') checkDomainModule(file, target, spec, ln);
        else if (tl === 'domain' && target !== join(SRC, 'domain', 'index.ts')) {
          report(file, ln, 'D6 domain-barrel', `import the domain only through src/domain/index.ts: ${spec}`);
        }
      } else {
        if (test && spec === 'vitest') continue;
        if (isNodeSpec(spec) && layer !== 'infrastructure') { report(file, ln, 'L3 node', `${layer} imports a Node builtin: ${spec}`); continue; }
        if (!PACKAGE_ALLOW[layer](spec)) report(file, ln, 'L4 package', `${layer} imports a package: ${spec}`);
      }
    }

    lines.forEach((t, i) => {
      const ln = i + 1;
      if (DEFAULT_EXPORT_RE.test(t)) report(file, ln, 'C1 default-export', 'use named exports');
      if (!isCommentLine(t) && ANY_RE.test(t)) report(file, ln, 'C2 any', 'no `any` in v2 code');
      if (!test && (layer === 'domain' || layer === 'application') && !isCommentLine(t) && IMPURE_RE.test(t)) {
        report(file, ln, 'C3 purity', 'time/randomness/crypto come through the Clock / IdGen ports');
      }
      if (!test && layer !== 'infrastructure' && VENDOR_RE.test(t)) {
        report(file, ln, 'C4 vendor', `agent-vendor name outside src/infrastructure/providers/: "${t.trim().slice(0, 80)}"`);
      }
    });
  }
}

function checkDomainModule(file, target, spec, ln) {
  const fromMod = relative(join(SRC, 'domain'), file).split(sep)[0];
  const relTarget = relative(join(SRC, 'domain'), target).split(sep);
  const toMod = relTarget[0];
  if (fromMod === toMod) return;
  if (toMod.endsWith('.ts')) return; // the top-level barrel may re-export modules; modules never import it (below)
  if (fromMod.endsWith('.ts')) return; // src/domain/index.ts barrel
  const allowed = DOMAIN_MODULES[fromMod];
  if (!allowed) { report(file, ln, 'D1 module', `unknown domain module "${fromMod}" — add it to docs/v2/domain.md first`); return; }
  if (!allowed.includes(toMod)) { report(file, ln, 'D2 module-deps', `domain/${fromMod} may not import domain/${toMod}: ${spec}`); return; }
  const isIndex = relTarget.length === 2 && /^index\.tsx?$/.test(relTarget[1]);
  if (!isIndex) report(file, ln, 'D3 module-index', `import domain/${toMod} through its index.ts only: ${spec}`);
}

// src/domain/scenarios holds cross-module scenario tests only.
for (const file of walk(join(SRC, 'domain', 'scenarios'))) {
  if (!isTest(file)) report(file, 1, 'D5 scenarios', 'src/domain/scenarios may contain *.test.ts files only');
}

// Domain modules must not import the top-level barrel.
for (const file of walk(join(SRC, 'domain'))) {
  if (relative(join(SRC, 'domain'), file).split(sep).length < 2) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(SPEC_RE)) {
    const spec = m[1] || m[2] || m[3] || m[4];
    if (!spec.startsWith('.')) continue;
    const target = resolveRelative(file, spec);
    if (target === join(SRC, 'domain', 'index.ts')) report(file, lineOf(text, m.index), 'D4 barrel', 'modules must not import src/domain/index.ts');
  }
}

// --- v1 files must not import v2 --------------------------------------------------------------------
for (const dir of V1_DIRS) {
  for (const file of walk(join(SRC, dir))) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(SPEC_RE)) {
      const spec = m[1] || m[2] || m[3] || m[4];
      if (!spec.startsWith('.')) continue;
      const target = resolveRelative(file, spec);
      if (target.startsWith(SRC + sep) && V2_LAYERS.includes(topDir(target))) {
        report(file, lineOf(text, m.index), 'L2 v1-isolation', `v1 code imports v2 code: ${spec}`);
      }
    }
  }
}

if (violations.length) {
  console.error(`v2 layer checks: ${violations.length} violation(s)\n` + violations.map((v) => `  ${v}`).join('\n'));
  process.exit(1);
}
console.log('v2 layer checks clean');
