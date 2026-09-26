#!/usr/bin/env node
// Rule-coverage check — mechanical closure of the test conventions in docs/v2/domain.md and
// docs/v2/application.md: every rule id defined there (`**R-n**` / `**R-n<letter>**` for the
// domain, `**A-n**` / `**A-n<letter>**` for the application) must have at least one test titled
// after it (`it('R-n: …')` / `it('A-n: …')`) in the layer's test files. A bold id in a Rules list
// is the definition; plain mentions in prose (`see R-16`) never define a rule, and a title like
// `R-4 edge:` does not satisfy the `R-n:` convention. Domain and application results are reported
// separately. Runs as part of `npm run check:boundaries`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// One entry per rule namespace: where the ids are defined and which folders carry its tests.
const SECTIONS = [
  { name: 'domain', doc: join(ROOT, 'docs', 'v2', 'domain.md'), dirs: [join(ROOT, 'src', 'domain')] },
  { name: 'application', doc: join(ROOT, 'docs', 'v2', 'application.md'), dirs: [join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api')] },
];

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

const checkSection = (section) => {
  const prefix = section.name === 'domain' ? 'R' : 'A';
  const definedRe = new RegExp(`\\*\\*(${prefix}-\\d+[a-z]?)\\*\\*`, 'g');
  const testedRe = new RegExp(`\\bit\\(\\s*['"]${prefix}-(\\d+[a-z]?):`, 'g');

  const failures = [];
  const docRel = relative(ROOT, section.doc);

  const defined = [...new Set([...readFileSync(section.doc, 'utf8').matchAll(definedRe)].map((m) => m[1]))].sort(byRuleId);
  if (defined.length === 0) {
    failures.push(`no **${prefix}-n** ids found in ${docRel} — the doc or the pattern moved`);
    return { failures, defined: 0, missing: [] };
  }

  const covered = new Set();
  for (const dir of section.dirs) {
    for (const file of walk(dir)) {
      for (const m of readFileSync(file, 'utf8').matchAll(testedRe)) covered.add(`${prefix}-${m[1]}`);
    }
  }
  if (covered.size === 0) {
    failures.push(`no it('${prefix}-n: …') titles found under ${section.dirs.map((dir) => relative(ROOT, dir)).join(' or ')} — no rule can be covered`);
    return { failures, defined: defined.length, missing: defined };
  }

  const missing = defined.filter((id) => !covered.has(id));
  if (missing.length) {
    failures.push(`${missing.length} of ${defined.length} rules defined in ${docRel} have no test titled after them:`);
    for (const id of missing) failures.push(`  ${id}`);
    failures.push(`add an it('${prefix}-n: …') in the owning module's colocated test file, or fix the title of the test that meant to carry the rule`);
  }
  return { failures, defined: defined.length, missing };
};

let failed = false;
for (const section of SECTIONS) {
  const prefix = section.name === 'domain' ? 'R' : 'A';
  const { failures, defined } = checkSection(section);
  if (failures.length) {
    failed = true;
    console.error(`rule coverage (${section.name}): ${failures[0]}`);
    for (const failure of failures.slice(1)) console.error(failure);
  } else {
    console.log(`rule coverage (${section.name}) clean — ${defined} rules in ${relative(ROOT, section.doc)} all have an it('${prefix}-n: …') test`);
  }
}
if (failed) process.exit(1);
