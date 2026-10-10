#!/usr/bin/env node
// v2 layer checks — mechanical enforcement of docs/v2/architecture.md, the module dependency map
// in docs/v2/domain.md, and the infrastructure rules and module map in docs/v2/infrastructure.md.
// Runs as part of `npm run check:boundaries`. Every violation names its rule.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SRC = join(ROOT, 'src');
const INFRA = join(SRC, 'infrastructure');
const INFRA_BARREL = join(INFRA, 'index.ts');

const V2_LAYERS = ['domain', 'application', 'api', 'infrastructure', 'presentation'];

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
  definitions: ['shared', 'budget'],
  quota: ['shared'],
  budget: ['shared'],
  proposal: ['shared'],
  pages: ['shared'],
  resolver: ['shared', 'definitions', 'quota'],
  gates: ['shared', 'definitions'],
  providers: ['shared', 'quota', 'definitions'],
  library: ['shared', 'definitions'],
  flow: ['shared', 'definitions', 'gates'],
  dispatch: ['shared', 'quota', 'budget'],
  roadmap: ['shared', 'flow', 'definitions'],
  // Cross-module scenario tests only (no production code): may import every module.
  scenarios: ['shared', 'definitions', 'quota', 'budget', 'proposal', 'resolver', 'gates', 'providers', 'library', 'flow', 'dispatch', 'roadmap'],
};
// Module dependency map inside src/infrastructure (docs/v2/infrastructure.md).
const INFRA_MODULES = {
  system: [],
  'storage/sqlite': ['system'],
  'storage/keychain': ['system', 'storage/sqlite'],
  'storage/definitions-yaml': ['system'],
  vcs: ['system'],
  gates: ['system', 'vcs'],
  forge: ['system'],
  providers: ['system'],
  compose: ['system', 'storage/sqlite', 'storage/keychain', 'storage/definitions-yaml', 'vcs', 'gates', 'providers'],
  scenarios: ['system', 'storage/sqlite', 'storage/keychain', 'storage/definitions-yaml', 'vcs', 'gates', 'providers', 'compose'],
};
// Module id per docs/v2/infrastructure.md: storage/<x> under storage/, else the first folder
// under src/infrastructure/. The layer barrel (src/infrastructure/index.ts) is handled separately.
const infraModuleId = (absPath) => {
  const parts = relative(INFRA, absPath).split(sep);
  if (parts.length === 1) return parts[0];
  return parts[0] === 'storage' && parts.length > 2 ? `storage/${parts[1]}` : parts[0];
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
        if (!LAYER_ALLOW[layer].includes(tl)) { report(file, ln, 'L1 layer', `${layer} may not import ${tl}: ${spec}`); continue; }
        if (layer === 'domain') checkDomainModule(file, target, spec, ln);
        else if (layer === 'infrastructure' && tl === 'infrastructure') checkInfraModule(file, target, spec, ln);
        else if (tl === 'domain' && target !== join(SRC, 'domain', 'index.ts')) {
          report(file, ln, 'D6 domain-barrel', `import the domain only through src/domain/index.ts: ${spec}`);
        }
      } else {
        if (test && spec === 'vitest') continue;
        if (spec === 'electron' || spec.startsWith('electron/')) {
          report(file, ln, 'N1 electron', 'v2 code never imports electron — Electron objects are injected by electron/main.ts');
          continue;
        }
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
      if (!test && VENDOR_RE.test(t)) {
        // Inside src/infrastructure/ the vendor-name ban holds everywhere but providers/ (N2);
        // outside infrastructure it is C4 for every layer.
        if (layer !== 'infrastructure' || relative(INFRA, file).split(sep)[0] !== 'providers') {
          const rule = layer === 'infrastructure' ? 'N2 vendor-scope' : 'C4 vendor';
          report(file, ln, rule, `agent-vendor name outside src/infrastructure/providers/: "${t.trim().slice(0, 80)}"`);
        }
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

// src/infrastructure/scenarios holds cross-module scenario tests only.
for (const file of walk(join(SRC, 'infrastructure', 'scenarios'))) {
  if (!isTest(file)) report(file, 1, 'N5 infra-scenarios', 'src/infrastructure/scenarios may contain *.test.ts files only');
}

function checkInfraModule(file, target, spec, ln) {
  if (target === INFRA_BARREL) {
    if (file !== INFRA_BARREL) report(file, ln, 'N3 infra-module', 'modules must not import src/infrastructure/index.ts');
    return;
  }
  const toId = infraModuleId(target);
  if (!INFRA_MODULES[toId]) {
    report(file, ln, 'N3 infra-module', `unknown infrastructure module "${toId}" — add it to docs/v2/infrastructure.md first`);
    return;
  }
  if (file === INFRA_BARREL) return; // the layer barrel re-exports every module
  const fromId = infraModuleId(file);
  const allowed = INFRA_MODULES[fromId];
  if (!allowed) {
    report(file, ln, 'N3 infra-module', `unknown infrastructure module "${fromId}" — add it to docs/v2/infrastructure.md first`);
    return;
  }
  if (fromId === toId) return;
  if (!allowed.includes(toId)) {
    report(file, ln, 'N3 infra-module', `infrastructure/${fromId} may not import infrastructure/${toId}: ${spec}`);
    return;
  }
  const parts = relative(INFRA, target).split(sep);
  const base = parts[parts.length - 1];
  if (base !== 'index.ts' && base !== 'index.tsx') {
    report(file, ln, 'N4 infra-index', `import infrastructure/${toId} through its index.ts only: ${spec}`);
  }
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

if (violations.length) {
  console.error(`v2 layer checks: ${violations.length} violation(s)\n` + violations.map((v) => `  ${v}`).join('\n'));
  process.exit(1);
}
console.log('v2 layer checks clean');
