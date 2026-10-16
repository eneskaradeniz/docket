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
// src/api (the acceptance scenario lives there). The A rules are tested under src/application
// and src/api, and a caller-side contract — which query shape a screen's reader sends — lives
// with its store under src/presentation. The P rules are defined in providers.md and
// tested wherever the provider contract they name lives — the domain (the pure catalog merge and
// effort mapping), infrastructure (defs, transports, forge, quota, scenarios), application
// (executor behaviour) and api. The U rules are defined in
// ui.md and tested under src/presentation, except U-11..U-14 whose behaviour tests live under
// src/api and src/application, and the quiet-window rules whose pure function and source scan
// live under electron/ (the shell is outside src/). Runs as part of
// `npm run check:boundaries`.
import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const DOCS_V2 = join(ROOT, 'docs', 'v2');

/** Lines that define a rule: `- **X-n** (added …)`. Amended bullets are not definitions. */
const RULE_DEFINITION_LINE_RE = /^- \*\*([A-Z]-\d+)\*\* \(added/;

export function duplicateRuleDefinitionIds(text) {
  const counts = new Map();
  const ingest = (source) => {
    for (const line of source.split('\n')) {
      const m = RULE_DEFINITION_LINE_RE.exec(line);
      if (!m) continue;
      counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    }
  };
  if (text === undefined) {
    for (const name of readdirSync(DOCS_V2)) {
      if (!name.endsWith('.md')) continue;
      ingest(readFileSync(join(DOCS_V2, name), 'utf8'));
    }
  } else {
    ingest(text);
  }
  return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id).sort();
}

// One entry per rule namespace: where the ids are defined and which folders carry its tests.
const SECTIONS = [
  { name: 'domain', prefix: 'R', doc: join(ROOT, 'docs', 'v2', 'domain.md'), dirs: [join(ROOT, 'src', 'domain')] },
  { name: 'application', prefix: 'A', doc: join(ROOT, 'docs', 'v2', 'application.md'), dirs: [join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api'), join(ROOT, 'src', 'presentation')] },
  { name: 'infrastructure', prefix: 'I', doc: join(ROOT, 'docs', 'v2', 'infrastructure.md'), dirs: [join(ROOT, 'src', 'infrastructure')] },
  {
    name: 'providers',
    prefix: 'P',
    doc: join(ROOT, 'docs', 'v2', 'providers.md'),
    definitionDocs: [join(ROOT, 'docs', 'v2', 'providers.md'), join(ROOT, 'docs', 'v2', 'provider-capabilities.md')],
    dirs: [join(ROOT, 'src', 'domain'), join(ROOT, 'src', 'infrastructure'), join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api')],
  },
  { name: 'domain environments', prefix: 'E', doc: join(ROOT, 'docs', 'v2', 'domain.md'), dirs: [join(ROOT, 'src', 'domain')] },
  { name: 'application environments', prefix: 'E', doc: join(ROOT, 'docs', 'v2', 'application.md'), dirs: [join(ROOT, 'src', 'application'), join(ROOT, 'src', 'api')] },
  { name: 'ui', prefix: 'U', doc: join(ROOT, 'docs', 'v2', 'ui.md'), dirs: [join(ROOT, 'src', 'presentation'), join(ROOT, 'src', 'api'), join(ROOT, 'src', 'application'), join(ROOT, 'electron')] },
];

// Rules whose definition landed in the docs ahead of their implementing wave (Phase 3.5 —
// Project & Repo model). An id may sit here only while no test carries it: the PR that lands
// its test removes the id in the same commit (a covered-but-still-pending id fails the check),
// and an id still pending after its issue closes is a review blocker. This list must be empty
// when the phase closes.
const PENDING = new Map([

  // #1006 — agent capabilities: library, provider translation, memory, machine import

  // #1008: Phase 7 surfaces — settings, setup, repo, work orders, versions, quit
  // #1047 — planner stage-skip derive rule, supplements R-133 (#1025 implements)

  // #1191 — D-10 autonomy contracts, docs-first. Each id names the D-10 split issue that
  // implements it; that issue removes the id from this list in the same commit as its test.
  // The 4/5 risk table (#1200/#1202) landed R-172; the 2a slice (#1201) landed R-167/R-169/R-171
  // and A-394…A-396; the 2b slice (#1204) landed R-168/R-170. I-107 stays: its serialization law
  // is the adapters' own test, not the executor wiring that consumes the typed error.
  ['infrastructure:I-107', '#1191 (the adapters parse stored levels; the typed read landed with 2a)'],

  // #1225 — D-10 chain widening contracts, docs-first. Each id names the chain step that
  // implements it — (a) set-level commands and UI, (b) the flow layer, (c) the stage layer and
  // the ceiling; that issue removes the id from this list in the same commit as its test.
  ['domain:R-154', '#1225 (chain c — clampAutonomy and the ceilings)'],
  ['application:A-406', '#1225 (chain c — the ceiling homes)'],
  ['ui:U-335', '#1225 (chain b — the suggestion banner and library tag)'],
  ['ui:U-336', '#1225 (chain c — the stage tag and the ceiling controls)'],

  // #1226 — provider conformance checklist (P-65): the audit landed docs-only; the rule gains its
  // enforcement test when step 2 of the series closes the checklist gaps.
  ['providers:P-65', '#1226 (docs-only audit; step 2 lands the test)'],

  // #1232 — D-10 chain-widening contract fixes from the review of #1228, docs-first. Additive
  // amendments to the #1225 contracts; the four new ids name the chain step that implements
  // each, and the implementing issue removes the id with its test, as above.

]);

// Rules whose implementing code and tests were removed while the definition and dated addenda stay
// in the docs as history; a retired id is exempt from needing an it('X-n: …') title.
const RETIRED = new Map([
  ['infrastructure:I-90', { issue: '#1057', reason: 'The one-time legacy import was removed and its test went with the code.' }],
  ['infrastructure:I-97', { issue: '#1057', reason: 'The one-time legacy import was removed and its test went with the code.' }],
  ['infrastructure:I-33', { issue: '#1058', reason: 'Migrations 1–11 were consolidated into a single clean schema and the v1/v10 upgrade tests were removed.' }],
  ['infrastructure:I-93', { issue: '#1058', reason: 'Migrations 1–11 were consolidated into a single clean schema and the v1/v10 upgrade tests were removed.' }],
  ['ui:U-175', { issue: '#1106', reason: 'The orphan guard deleted the dead role-row tree and the global empty assistant-order card went with the code.' }],
  ['application:A-88', { issue: '#1108', reason: 'The dead stage-file read queries were removed and their tests went with the code.' }],
  ['application:A-89', { issue: '#1108', reason: 'The dead stage-file read queries were removed and their tests went with the code.' }],
  ['ui:U-57', { issue: '#1108', reason: 'The dead stage-file read queries were removed and their tests went with the code.' }],
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

const sectionEntries = (map, sectionName) =>
  [...map]
    .filter(([key]) => key.startsWith(`${sectionName}:`))
    .map(([key, value]) => [key.slice(sectionName.length + 1), value]);

/** @param {{ pending?: Map, retired?: Map, defined?: string[], covered?: Set<string> }} overrides */
export const checkSection = (section, overrides = {}) => {
  const prefix = section.prefix;
  const definedRe = new RegExp(`\\*\\*(${prefix}-\\d+[a-z]?)\\*\\*`, 'g');
  const testedRe = new RegExp(`\\bit\\(\\s*['"]${prefix}-(\\d+[a-z]?):`, 'g');

  const failures = [];
  const docRel = relative(ROOT, section.doc);

  const pendingMap = overrides.pending ?? PENDING;
  const retiredMap = overrides.retired ?? RETIRED;

  const definitionSources = section.definitionDocs ?? [section.doc];
  const defined =
    overrides.defined ??
    [
      ...new Set(
        definitionSources.flatMap((path) => [...readFileSync(path, 'utf8').matchAll(definedRe)].map((m) => m[1])),
      ),
    ].sort(byRuleId);
  if (defined.length === 0) {
    failures.push(`no **${prefix}-n** ids found in ${definitionSources.map((p) => relative(ROOT, p)).join(' or ')} — the doc or the pattern moved`);
    return { failures, defined: 0, missing: [] };
  }

  const covered = overrides.covered ?? new Set();
  if (!overrides.covered) {
    for (const dir of section.dirs) {
      for (const file of walk(dir)) {
        for (const m of readFileSync(file, 'utf8').matchAll(testedRe)) covered.add(`${prefix}-${m[1]}`);
      }
    }
  }

  const pending = sectionEntries(pendingMap, section.name).map(([id, issue]) => [id, issue]);
  const pendingIds = new Set(pending.map(([id]) => id));
  for (const [id, issue] of pending) {
    if (!defined.includes(id)) failures.push(`${id} is listed as pending (${issue}) but not defined in ${docRel} — fix PENDING`);
    if (covered.has(id)) failures.push(`${id} is listed as pending (${issue}) but already has a test — remove it from PENDING in the same PR`);
  }

  const retired = sectionEntries(retiredMap, section.name);
  const retiredIds = new Set(retired.map(([id]) => id));
  for (const [id, entry] of retired) {
    const issue = entry?.issue ?? '';
    if (!issue) failures.push(`${id} is listed as retired but has no issue — fix RETIRED`);
    if (!entry?.reason?.trim()) failures.push(`${id} is listed as retired but has no reason — fix RETIRED`);
    if (!defined.includes(id)) failures.push(`${id} is listed as retired (${issue}) but not defined in ${docRel} — fix RETIRED`);
    if (covered.has(id)) failures.push(`${id} is listed as retired (${issue}) but has a test — remove the test or remove it from RETIRED`);
  }

  if (covered.size === 0 && !overrides.covered) {
    failures.push(`no it('${prefix}-n: …') titles found under ${section.dirs.map((dir) => relative(ROOT, dir)).join(' or ')} — no rule can be covered`);
    return { failures, defined: defined.length, missing: defined };
  }

  const missing = defined.filter((id) => !covered.has(id) && !pendingIds.has(id) && !retiredIds.has(id));
  if (missing.length) {
    failures.push(`${missing.length} of ${defined.length} rules defined in ${docRel} have no test titled after them:`);
    for (const id of missing) failures.push(`  ${id}`);
    failures.push(`add an it('${prefix}-n: …') in the owning module's colocated test file, or fix the title of the test that meant to carry the rule`);
  }
  return { failures, defined: defined.length, missing, pending: pendingIds.size, retired: retiredIds.size };
};

const isMain = process.argv[1] && SELF === process.argv[1];
if (isMain) {
  const selfTest = spawnSync(process.execPath, ['--test', join(ROOT, 'scripts/check-rule-coverage.test.mjs')], {
    stdio: 'inherit',
  });
  if (selfTest.status !== 0) process.exit(selfTest.status ?? 1);

  const dupes = duplicateRuleDefinitionIds();
  if (dupes.length) {
    console.error(`rule definitions: duplicate (added) ids in docs/v2: ${dupes.join(', ')}`);
    console.error('each **X-n** (added …) bullet must appear once; use amended bullets or a cross-link for aliases');
    process.exit(1);
  }
}

if (isMain) {
  let failed = false;
  for (const section of SECTIONS) {
    const prefix = section.prefix;
    const { failures, defined, pending, retired } = checkSection(section);
    if (failures.length) {
      failed = true;
      console.error(`rule coverage (${section.name}): ${failures[0]}`);
      for (const failure of failures.slice(1)) console.error(failure);
    } else if (pending > 0) {
      console.log(`rule coverage (${section.name}) clean — ${defined} rules in ${relative(ROOT, section.doc)}, ${defined - pending - (retired ?? 0)} tested, ${pending} pending (PENDING list)`);
    } else if ((retired ?? 0) > 0) {
      console.log(`rule coverage (${section.name}) clean — ${defined} rules in ${relative(ROOT, section.doc)}, ${defined - (retired ?? 0)} tested, ${retired} retired (RETIRED list)`);
    } else {
      console.log(`rule coverage (${section.name}) clean — ${defined} rules in ${relative(ROOT, section.doc)} all have an it('${prefix}-n: …') test`);
    }
  }
  if (failed) process.exit(1);
  if (PENDING.size === 0) console.log('rule coverage: PENDING empty');
}
