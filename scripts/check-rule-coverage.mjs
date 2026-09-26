#!/usr/bin/env node
// Rule-coverage check — mechanical closure of the Phase 1 test convention in docs/v2/domain.md:
// every rule id defined there (`**R-n**` / `**R-n<letter>**`) must have at least one test titled
// after it (`it('R-n: …')`) in src/domain/**/*.test.ts. A bold id in a Rules list is the definition;
// plain mentions in prose (`see R-16`) never define a rule, and a title like `R-4 edge:` does not
// satisfy the `R-n:` convention. Runs as part of `npm run check:boundaries`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const DOC = join(ROOT, 'docs', 'v2', 'domain.md');
const DOMAIN = join(ROOT, 'src', 'domain');

const DEFINED_RE = /\*\*(R-\d+[a-z]?)\*\*/g;
const TESTED_RE = /\bit\(\s*['"]R-(\d+[a-z]?):/g;

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, acc);
    else if (/\.test\.ts$/.test(name)) acc.push(p);
  }
  return acc;
}

const ruleKey = (id) => [Number(id.match(/\d+/)[0]), id.match(/[a-z]$/)?.[0] ?? ''];
const byRuleId = (a, b) => {
  const [na, la] = ruleKey(a);
  const [nb, lb] = ruleKey(b);
  return na - nb || (la < lb ? -1 : la > lb ? 1 : 0);
};

const defined = [...new Set([...readFileSync(DOC, 'utf8').matchAll(DEFINED_RE)].map((m) => m[1]))].sort(byRuleId);
if (defined.length === 0) {
  console.error(`rule coverage: no **R-n** ids found in ${relative(ROOT, DOC)} — the doc or the pattern moved`);
  process.exit(1);
}

const covered = new Set();
for (const file of walk(DOMAIN)) {
  for (const m of readFileSync(file, 'utf8').matchAll(TESTED_RE)) covered.add(`R-${m[1]}`);
}
if (covered.size === 0) {
  console.error(`rule coverage: no it('R-n: …') titles found under ${relative(ROOT, DOMAIN)} — no rule can be covered`);
  process.exit(1);
}

const missing = defined.filter((id) => !covered.has(id));
if (missing.length) {
  console.error(`rule coverage: ${missing.length} of ${defined.length} rules defined in docs/v2/domain.md have no test titled after them:`);
  for (const id of missing) console.error(`  ${id}`);
  console.error("add an it('R-n: …') in the owning module's colocated test file, or fix the title of the test that meant to carry the rule");
  process.exit(1);
}
console.log(`rule coverage clean — ${defined.length} rules in docs/v2/domain.md all have an it('R-n: …') test`);
