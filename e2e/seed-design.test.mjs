// e2e/seed-design.test.mjs — the design seed, proven by running it for real (node:test; vitest
// covers src/ only). Run: npm run test:seed-design
//
// It asserts the three promises of the seed: the same world every run, never the operator's data
// dir, and the prototype's codes under the same project and repo everywhere.
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

const seed = () => {
  const out = execFileSync('npx', ['tsx', 'e2e/seed-design.ts'], { cwd: ROOT, encoding: 'utf8' });
  const line = out.trim().split('\n').find((candidate) => candidate.startsWith('SEED='));
  assert.ok(line, 'the seed printed no SEED= line');
  return JSON.parse(line.slice(5));
};

// Every table of the seeded database as text, with the run's own temp path masked out: what is
// left is exactly what must repeat between runs.
const dumpDatabase = (manifest) => {
  const db = new DatabaseSync(join(manifest.dataDir, 'docket.db'), { readOnly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    const dump = {};
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM "${table}"`).all().map((row) => JSON.stringify(row));
      dump[table] = rows.sort().map((row) => row.split(manifest.home).join('<home>'));
    }
    return dump;
  } finally {
    db.close();
  }
};

const worlds = [];
const seedTwice = () => {
  if (worlds.length === 0) {
    for (let i = 0; i < 2; i += 1) {
      const manifest = seed();
      worlds.push({ manifest, dump: dumpDatabase(manifest) });
    }
  }
  return worlds;
};

test.after(() => {
  for (const { manifest } of worlds) rmSync(manifest.home, { recursive: true, force: true });
});

test('two runs produce the same world', () => {
  const [first, second] = seedTwice();
  assert.notEqual(first.manifest.home, second.manifest.home, 'each run needs its own throwaway home');
  assert.deepEqual(first.dump, second.dump);
  assert.deepEqual(first.manifest.codes, second.manifest.codes);
  assert.deepEqual(first.manifest.accounts, second.manifest.accounts);
  assert.equal(first.manifest.fixedNow, second.manifest.fixedNow);
});

test('the data dir is a throwaway one, never the operator data dir', () => {
  const [{ manifest }] = seedTwice();
  const operatorDirs = [join(homedir(), '.docket'), process.env.DOCKET_DATA_DIR].filter(Boolean);
  assert.ok(manifest.dataDir.startsWith(manifest.home), 'the data dir lives inside the seed home');
  assert.ok(manifest.home.startsWith(tmpdir()) || manifest.home.startsWith('/tmp') || manifest.home.startsWith('/var'), manifest.home);
  for (const operatorDir of operatorDirs) assert.notEqual(resolve(manifest.dataDir), resolve(operatorDir));
  assert.ok(existsSync(join(manifest.dataDir, 'docket.db')));
  assert.ok(statSync(manifest.agentBin).mode & 0o111, 'the agent binary is executable');
});

test('projects and repos: five projects, each main repo carries project.yaml', () => {
  const [{ manifest }] = seedTwice();
  const sizes = Object.fromEntries(Object.entries(manifest.projects).map(([id, project]) => [id, project.repos.length]));
  assert.deepEqual(sizes, { antero: 7, docket: 2, 'date-app': 3, telerelay: 1, 'kadife-odoo': 1 });
  assert.equal(manifest.projects.antero.main, 'antreo-docs');

  for (const [id, project] of Object.entries(manifest.projects)) {
    for (const repo of project.repos) {
      assert.ok(existsSync(join(manifest.repos[repo], '.git')), `${repo} is a real git repo`);
      assert.equal(
        existsSync(join(manifest.repos[repo], '.docket', 'project.yaml')),
        repo === project.main,
        `${id}/${repo}: project.yaml belongs to the main repo only`,
      );
    }
  }
  const roadmap = readFileSync(join(manifest.repos['antreo-docs'], '.docket', 'roadmap.yaml'), 'utf8');
  assert.match(roadmap, /mobil-login/);
});

test('the prototype codes sit under the same project and repo', () => {
  const [{ manifest }] = seedTwice();
  const expected = {
    'İE-0012': ['kadife-odoo', 'kadife-odoo', 'staging'],
    'İE-0014': ['antero', 'antreo-api', 'gelistir'],
    'İE-0015': ['antero', 'antreo-api', 'test'],
    'İE-0029': ['antero', 'antreo-api', 'gelistir'],
    'İE-0031': ['docket', 'docket', 'analiz'],
    'İE-0032': ['antero', 'antreo-api', 'staging'],
    'İE-0033': ['antero', 'antreo-api', 'gelistir'],
    'İE-0034': ['antero', 'antreo-api', 'analiz'],
    'İE-0038': ['antero', 'antreo-api', 'cozum'],
    'İE-0044': ['antero', 'antreo-api', 'yayin'],
    'İE-0045': ['antero', 'antreo-mobile', 'test'],
    'İE-0046': ['antero', 'antreo-api', 'staging'],
  };
  for (const [code, [project, repo, stage]] of Object.entries(expected)) {
    const seeded = manifest.codes[code];
    assert.ok(seeded, `${code} is seeded`);
    assert.deepEqual([seeded.project, seeded.repo, seeded.stage], [project, repo, stage], code);
  }
  for (const code of ['İE-0009', 'İE-0036', 'İE-0007', 'İE-0003', 'İE-0002']) {
    assert.equal(manifest.codes[code]?.state, 'done', `${code} is closed`);
  }
  assert.equal(manifest.codes['İE-0044'].state, 'done');
  assert.equal(manifest.codes['İE-0045'].state, 'ready');
  const ids = Object.values(manifest.codes).map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length, 'every code has its own id');
});

test('six accounts with 5-hour, weekly and monthly windows and spend', () => {
  const [{ dump }] = seedTwice();
  assert.equal(dump.accounts.length, 6);
  const labels = dump.meters.map((row) => JSON.parse(JSON.parse(row).data).label);
  for (const label of ['5 saatlik pencere', 'Haftalık pencere', 'Aylık pencere']) {
    assert.ok(labels.includes(label), `a "${label}" meter exists`);
  }
  assert.ok(dump.spend.length > 0, 'spend is recorded');
});
