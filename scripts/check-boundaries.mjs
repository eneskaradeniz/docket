#!/usr/bin/env node
// Boundary check for the Electron shell. The v2 layer rules (src/domain, application, api,
// infrastructure, presentation) live in scripts/check-layers.mjs; electron/ sits outside those layers,
// so the one rule that still has to reach it is kept here: no agent-vendor name outside the provider
// layer (a hit is a stop-and-ask report, not a reason to narrow the list).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const VENDOR_RE = /\b(claude|anthropic|codex|openai|gpt|gemini|antigravity|cursor|copilot)\b/i;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.[tj]sx?$/.test(name)) acc.push(p);
  }
  return acc;
}

const violations = [];
for (const f of walk(join(ROOT, 'electron'))) {
  readFileSync(f, 'utf8').split('\n').forEach((ln, i) => {
    // `CLAUDE.md` and `.claude/` name the agent-configuration surface, not the vendor's product.
    const stripped = ln.replace(/claude\.md/gi, '').replace(/\.claude/g, '');
    const m = VENDOR_RE.exec(stripped);
    if (m) violations.push(`${relative(ROOT, f)}:${i + 1}  agent-vendor name "${m[1].toLowerCase()}"`);
  });
}

if (violations.length) {
  console.log('[FAIL] agent-vendor names in electron/');
  for (const v of violations) console.log(`  ${v}`);
  console.log(`\n${violations.length} boundary violation(s)`);
  process.exit(1);
}
console.log('[ ok ] agent-vendor names in electron/\nboundary checks clean');
