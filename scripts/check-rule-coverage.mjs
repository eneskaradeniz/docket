#!/usr/bin/env node
// Rule-coverage check — mechanical closure of the test conventions in docs/v2/domain.md,
// docs/v2/application.md, docs/v2/infrastructure.md and docs/v2/providers.md: every rule id
// defined there (`**R-n**` / `**R-n<letter>**` for the domain, `**A-n**` / `**A-n<letter>**` for the
// application, `**I-n**` / `**I-n<letter>**` for the infrastructure, `**P-n**` for the provider
// contracts, `**E-n**` / `**E-n<letter>**` for the environment rules in the domain and application
// docs, `**U-n**` for the UI rules in the ui doc) must have at
// least one test titled after it (`it('R-n: …')` / `it('A-n: …')` / `it('I-n: …')` /
// `it('P-n: …')` / `it('E-n: …')` / `it('U-n: …')`) in the layer's test files.
// A bold id in a Rules list is the definition; plain mentions in prose (`see R-16`) never define a
// rule, and a title like `R-4 edge:` does not satisfy the `R-n:` convention. Each layer's results
// are reported separately. The E rules span two docs, so each half carries its own search scope:
// domain.md's E rules are tested under src/domain, application.md's under src/application and
// src/api (the acceptance scenario lives there). The P rules are defined in providers.md and
// tested wherever the provider contract they name lives — infrastructure (defs, transports,
// forge, quota, scenarios), application (executor behaviour) and api. The U rules are defined in
// ui.md and tested under src/presentation, except U-11..U-14 whose behaviour tests live under
// src/api and src/application. Runs as part of
// `npm run check:boundaries`.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

// One entry per rule namespace: where the ids are defined and which folders carry its tests.
const SECTIONS = [
  { name: 'domain', prefix: 'R', doc: join(ROOT, 'docs', 'v2', 'domain.md'), dirs: [join(ROOT, 'src', 'domain')] },
  { name: 'application', prefix: 'A', doc: join(ROOT, 'docs', 'v2', 'application.md'), dirs: [join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api')] },
  { name: 'infrastructure', prefix: 'I', doc: join(ROOT, 'docs', 'v2', 'infrastructure.md'), dirs: [join(ROOT, 'src', 'infrastructure')] },
  { name: 'providers', prefix: 'P', doc: join(ROOT, 'docs', 'v2', 'providers.md'), dirs: [join(ROOT, 'src', 'infrastructure'), join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api')] },
  { name: 'domain environments', prefix: 'E', doc: join(ROOT, 'docs', 'v2', 'domain.md'), dirs: [join(ROOT, 'src', 'domain')] },
  { name: 'application environments', prefix: 'E', doc: join(ROOT, 'docs', 'v2', 'application.md'), dirs: [join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api')] },
  { name: 'ui', prefix: 'U', doc: join(ROOT, 'docs', 'v2', 'ui.md'), dirs: [join(ROOT, 'src', 'presentation'), join(ROOT, 'src', 'api'), join(ROOT, 'src', 'application')] },
];

// Rules whose definition landed in the docs ahead of their implementing wave (Phase 3.5 —
// Project & Repo model). An id may sit here only while no test carries it: the PR that lands
// its test removes the id in the same commit (a covered-but-still-pending id fails the check),
// and an id still pending after its issue closes is a review blocker. This list must be empty
// when the phase closes.
const PENDING = new Map([
  ['providers:P-37', '#581'],
  ['providers:P-38', '#581'],
  ['ui:U-27', '#648'],
  ['ui:U-29', '#650'],
  ['ui:U-30', '#650'],
  ['ui:U-31', '#650'],
  ['ui:U-32', '#652'],
  ['ui:U-33', '#653'],
  ['ui:U-34', '#654'],
  ['ui:U-35', '#655'],
  ['ui:U-37', '#656'],
]);

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
  const prefix = section.prefix;
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

  const pending = [...PENDING].filter(([key]) => key.startsWith(`${section.name}:`)).map(([key, issue]) => [key.slice(section.name.length + 1), issue]);
  const pendingIds = new Set(pending.map(([id]) => id));
  for (const [id, issue] of pending) {
    if (!defined.includes(id)) failures.push(`${id} is listed as pending (${issue}) but not defined in ${docRel} — fix PENDING`);
    if (covered.has(id)) failures.push(`${id} is listed as pending (${issue}) but already has a test — remove it from PENDING in the same PR`);
  }

  const missing = defined.filter((id) => !covered.has(id) && !pendingIds.has(id));
  if (missing.length) {
    failures.push(`${missing.length} of ${defined.length} rules defined in ${docRel} have no test titled after them:`);
    for (const id of missing) failures.push(`  ${id}`);
    failures.push(`add an it('${prefix}-n: …') in the owning module's colocated test file, or fix the title of the test that meant to carry the rule`);
  }
  return { failures, defined: defined.length, missing, pending: pendingIds.size };
};

let failed = false;
for (const section of SECTIONS) {
  const prefix = section.prefix;
  const { failures, defined, pending } = checkSection(section);
  if (failures.length) {
    failed = true;
    console.error(`rule coverage (${section.name}): ${failures[0]}`);
    for (const failure of failures.slice(1)) console.error(failure);
  } else if (pending > 0) {
    console.log(`rule coverage (${section.name}) clean — ${defined} rules in ${relative(ROOT, section.doc)}, ${defined - pending} tested, ${pending} pending (PENDING list)`);
  } else {
    console.log(`rule coverage (${section.name}) clean — ${defined} rules in ${relative(ROOT, section.doc)} all have an it('${prefix}-n: …') test`);
  }
}
if (failed) process.exit(1);
