// seed-design.ts — the deterministic design seed: the world of the frozen rev-8 prototype, built
// into a throwaway data dir. Run with `npx tsx e2e/seed-design.ts`; it prints a `SEED={json}`
// line in the same shape as seed-smoke.ts (`dataDir`, `agentBin`, plus the maps below).
//
// What it builds, and why each piece exists:
//   <home>/.docket/             the data dir handed to the app as DOCKET_DATA_DIR — never the
//                               operator's own ~/.docket
//   <home>/repos/<slug>/        one real git repo per repo; a project's main repo also carries
//                               .docket/project.yaml and .docket/roadmap.yaml
//   <home>/bin/design-agent     the scripted agent binary, so a launched app has something to point at
//
// The database is written through the app's own composition (createNodeDeps) and use-cases:
// projects through attachProject, work orders through openWorkOrder, human gates through
// decideHumanGate. The only direct port writes are the facts no use-case produces at seed time:
// finished agent runs, quota windows and recorded spend.
//
// Determinism: a fixed clock and a zero random source. The ULID generator stays monotonic when the
// clock moves backwards, so ids follow creation order and repeat exactly run over run.
//
// Where the prototype disagrees with itself, the rev-7 screens win; the work-order codes (İE-nnnn)
// are not stored anywhere — the app names a work order by its id — so the manifest's `codes` map
// is the code → id key the journeys read.
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import assert from 'node:assert';
import { stringify } from 'yaml';

import type {
  AccountId,
  Actor,
  AgentEvent,
  EpochMs,
  GateSlug,
  Meter,
  Pool,
  ProjectSlug,
  RepoSlug,
  RoleSlug,
  RunId,
  StageSlug,
  TaskSlug,
  WorkOrderId,
} from '../src/domain/index';
import { deriveWorkOrderState } from '../src/domain/index';
import { createApi } from '../src/api/index';
import type { AccountRecord } from '../src/application/index';
import { saveAccount, saveBinding } from '../src/application/use-cases/accounts';
import { decideHumanGate } from '../src/application/use-cases/gates';
import { attachProject } from '../src/application/use-cases/projects';
import { openWorkOrder } from '../src/application/use-cases/work-orders';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

const here = dirname(fileURLToPath(import.meta.url));

if (process.platform === 'win32') {
  throw new Error('the design seed relies on POSIX paths and script shebangs');
}

// --- the clock -----------------------------------------------------------------------------------
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
// 12:18 in the prototype's Istanbul time (UTC+3): the 5-hour window then resets at 14:30, "2 sa 12
// dk kaldı", exactly as the account screen reads.
const NOW = Date.UTC(2026, 8, 29, 9, 18, 0);
let clockNow: EpochMs = NOW;
const setClock = (at: EpochMs): void => {
  clockNow = at;
};
const ago = (minutes: number): EpochMs => NOW - minutes * MINUTE;

const OPERATOR: Actor = { kind: 'user', id: 'enes', label: 'Enes' };

// --- the world -----------------------------------------------------------------------------------
interface ProjectPlan {
  readonly id: string;
  readonly name: string;
  readonly main: string;
  readonly repos: readonly string[];
  readonly budgetUsd?: number;
}

const PROJECTS: readonly ProjectPlan[] = [
  {
    id: 'antero',
    name: 'Antero',
    main: 'antreo-docs',
    repos: ['antreo-docs', 'antreo-api', 'antreo-mobile', 'antreo-web', 'antreo-devops', 'antreo-admin-web', 'antreo-shared'],
    budgetUsd: 300,
  },
  { id: 'docket', name: 'Docket', main: 'docket', repos: ['docket', 'docket-mobile'] },
  { id: 'date-app', name: 'date-app', main: 'dateapp-docs', repos: ['dateapp-api', 'dateapp-mobile', 'dateapp-docs'] },
  { id: 'telerelay', name: 'telerelay', main: 'telerelay', repos: ['telerelay'] },
  { id: 'kadife-odoo', name: 'Kadife Odoo', main: 'kadife-odoo', repos: ['kadife-odoo'] },
];

// One flow for every repo: the prototype's "Standart akış". Every stage has a role — staging and
// release are agent deployments followed by a person's verdict — so a run can sit in any column.
const STAGES = [
  { id: 'analiz', name: 'Analiz', role: 'analist', gate: { id: 'plan-onayi', label: 'Plan onayı' } },
  { id: 'cozum', name: 'Çözüm', role: 'cozumleyici', gate: undefined },
  { id: 'gelistir', name: 'Geliştir', role: 'gelistirici', gate: { id: 'insan-onayi', label: 'İnsan onayı' } },
  { id: 'test', name: 'Test', role: 'test-muhendisi', gate: undefined },
  { id: 'staging', name: 'Staging', role: 'yayinci', gate: { id: 'staging-testi', label: 'Staging testi' } },
  { id: 'yayin', name: 'Yayın', role: 'yayinci', gate: { id: 'yayin-onayi', label: 'Yayın onayı' } },
] as const;
const FLOW_ID = 'standart-akis';

type AccountKey = 'claude-max' | 'zai-glm' | 'codex-pro' | 'antigravity' | 'gemini' | 'kimi';

/** running: an unfinished run in `stage`; awaiting: the stage's run finished and its human gate
 *  is open; ready: the stage is entered, nothing started; done: the whole flow finished. */
type PlanState = 'running' | 'awaiting' | 'ready' | 'done';

interface OrderPlan {
  readonly code: string;
  readonly repo: string;
  readonly title: string;
  readonly stage: number; // index into STAGES (the last one for `done`)
  readonly state: PlanState;
  /** Minutes the current state has lasted; for `done`, minutes since it finished. */
  readonly minutes: number;
  readonly account: AccountKey;
  readonly usd?: number;
  readonly task?: string;
  readonly ask?: string; // an open permission ask on the running run: the command asked about
}

const ORDERS: readonly OrderPlan[] = [
  // antreo-api — the board every screen lands on
  { code: 'İE-0034', repo: 'antreo-api', title: 'Rol matrisi', stage: 0, state: 'ready', minutes: 30, account: 'claude-max' },
  { code: 'İE-0038', repo: 'antreo-api', title: 'Önbellek', stage: 1, state: 'running', minutes: 4, account: 'codex-pro', usd: 0.42 },
  { code: 'İE-0014', repo: 'antreo-api', title: 'Fatura raporu', stage: 2, state: 'running', minutes: 6, account: 'zai-glm', usd: 0.31 },
  {
    code: 'İE-0029', repo: 'antreo-api', title: 'Hız sınırı', stage: 2, state: 'running', minutes: 9, account: 'zai-glm',
    usd: 0.09, ask: 'dotnet ef database update',
  },
  { code: 'İE-0033', repo: 'antreo-api', title: 'Log düzeni', stage: 2, state: 'ready', minutes: 25, account: 'zai-glm' },
  { code: 'İE-0015', repo: 'antreo-api', title: 'Stok uyarısı', stage: 3, state: 'running', minutes: 3, account: 'claude-max', usd: 0.22 },
  { code: 'İE-0032', repo: 'antreo-api', title: 'Swagger belgeleri', stage: 4, state: 'running', minutes: 14, account: 'antigravity', usd: 0.18 },
  { code: 'İE-0046', repo: 'antreo-api', title: 'Swagger staging testi', stage: 4, state: 'awaiting', minutes: 12, account: 'antigravity', usd: 0.27 },
  { code: 'İE-0009', repo: 'antreo-api', title: 'Müşteri etiketi', stage: 5, state: 'done', minutes: 1300, account: 'claude-max', usd: 0.6 },
  { code: 'İE-0036', repo: 'antreo-api', title: 'Webhook doğrulaması', stage: 5, state: 'done', minutes: 1500, account: 'kimi', usd: 0.4 },
  { code: 'İE-0007', repo: 'antreo-api', title: 'Sipariş e-postası', stage: 5, state: 'done', minutes: 4300, account: 'claude-max', usd: 0.7 },
  // the cross-repo "Mobil login" task: İE-0044 (api) finished, İE-0045 (mobile) waits in Test
  { code: 'İE-0044', repo: 'antreo-api', title: 'Mobil login', stage: 5, state: 'done', minutes: 13_000, account: 'claude-max', usd: 1.1, task: 'mobil-login' },
  { code: 'İE-0045', repo: 'antreo-mobile', title: 'Mobil login', stage: 3, state: 'ready', minutes: 20, account: 'claude-max', usd: 0.35, task: 'mobil-login' },
  // the roadmap's finished tasks
  { code: 'İE-0021', repo: 'antreo-api', title: 'Auth endpoint', stage: 5, state: 'done', minutes: 20_500, account: 'zai-glm', usd: 0.9, task: 'auth-endpoint' },
  { code: 'İE-0022', repo: 'antreo-api', title: 'Şifre sıfırlama', stage: 5, state: 'done', minutes: 19_800, account: 'claude-max', usd: 0.8, task: 'sifre-sifirlama' },
  { code: 'İE-0023', repo: 'antreo-api', title: 'Oturum yönetimi', stage: 5, state: 'done', minutes: 19_000, account: 'claude-max', usd: 0.7, task: 'oturum-yonetimi' },
  { code: 'İE-0024', repo: 'antreo-api', title: 'Aylık özet verisi', stage: 5, state: 'done', minutes: 15_000, account: 'codex-pro', usd: 0.5, task: 'aylik-ozet-verisi' },
  // the rest of Antero
  { code: 'İE-0041', repo: 'antreo-mobile', title: 'Uygulama simgesi', stage: 0, state: 'ready', minutes: 50, account: 'claude-max' },
  { code: 'İE-0042', repo: 'antreo-devops', title: 'CI önbelleği', stage: 1, state: 'ready', minutes: 70, account: 'codex-pro' },
  { code: 'İE-0043', repo: 'antreo-devops', title: 'Sertifika yenileme', stage: 0, state: 'ready', minutes: 90, account: 'codex-pro' },
  // Docket
  { code: 'İE-0031', repo: 'docket', title: 'Kullanıcı rolleri', stage: 0, state: 'awaiting', minutes: 4, account: 'codex-pro', usd: 0.2 },
  { code: 'İE-0035', repo: 'docket', title: 'Kota panosu', stage: 2, state: 'ready', minutes: 40, account: 'zai-glm' },
  { code: 'İE-0037', repo: 'docket-mobile', title: 'Bildirim kanalı', stage: 1, state: 'ready', minutes: 55, account: 'zai-glm' },
  { code: 'İE-0002', repo: 'docket', title: 'Kurulum betiği', stage: 5, state: 'done', minutes: 10_000, account: 'claude-max', usd: 0.3 },
  // date-app, telerelay, Kadife Odoo
  { code: 'İE-0039', repo: 'dateapp-api', title: 'Eşleşme puanı', stage: 2, state: 'ready', minutes: 35, account: 'gemini' },
  { code: 'İE-0040', repo: 'telerelay', title: 'Webhook yeniden deneme', stage: 3, state: 'ready', minutes: 45, account: 'gemini' },
  { code: 'İE-0012', repo: 'kadife-odoo', title: 'Teslim tarihi', stage: 4, state: 'awaiting', minutes: 12, account: 'gemini', usd: 0.25 },
  { code: 'İE-0003', repo: 'kadife-odoo', title: 'Stok senkronu', stage: 5, state: 'done', minutes: 9000, account: 'claude-max', usd: 0.45 },
];

interface RoadmapTaskPlan {
  readonly id: string;
  readonly title: string;
  readonly targets: readonly string[];
}
interface RoadmapPhasePlan {
  readonly id: string;
  readonly name: string;
  readonly tasks: readonly RoadmapTaskPlan[];
}

const ROADMAPS: Readonly<Record<string, readonly RoadmapPhasePlan[]>> = {
  antero: [
    {
      id: 'faz-1',
      name: 'Faz 1: Kullanıcı yönetimi',
      tasks: [
        { id: 'auth-endpoint', title: 'Auth endpoint', targets: ['antreo-api'] },
        { id: 'sifre-sifirlama', title: 'Şifre sıfırlama', targets: ['antreo-api'] },
        { id: 'oturum-yonetimi', title: 'Oturum yönetimi', targets: ['antreo-api'] },
        { id: 'mobil-login', title: 'Mobil login', targets: ['antreo-api', 'antreo-mobile'] },
        { id: 'rol-yetkilendirme', title: 'Rol yetkilendirme', targets: ['antreo-api'] },
      ],
    },
    {
      id: 'faz-2',
      name: 'Faz 2: Bildirimler',
      tasks: [
        { id: 'push-altyapisi', title: 'Push altyapısı', targets: ['antreo-mobile'] },
        { id: 'eposta-sablonlari', title: 'E-posta şablonları', targets: ['antreo-api'] },
        { id: 'bildirim-tercihleri', title: 'Bildirim tercihleri', targets: ['antreo-web'] },
        { id: 'ozet-raporu', title: 'Özet raporu', targets: ['antreo-api'] },
      ],
    },
    {
      id: 'faz-3',
      name: 'Faz 3: Raporlama',
      tasks: [
        { id: 'aylik-ozet-verisi', title: 'Aylık özet verisi', targets: ['antreo-api'] },
        { id: 'grafik-ekrani', title: 'Grafik ekranı', targets: ['antreo-web'] },
      ],
    },
  ],
  docket: [
    {
      id: 'faz-1',
      name: 'Faz 1: Çekirdek',
      tasks: [
        { id: 'proje-katmani', title: 'Proje katmanı', targets: ['docket'] },
        { id: 'mobil-bildirim', title: 'Mobil bildirim', targets: ['docket', 'docket-mobile'] },
      ],
    },
  ],
  'date-app': [
    {
      id: 'faz-1',
      name: 'Faz 1: Eşleşme',
      tasks: [
        { id: 'eslesme-puani', title: 'Eşleşme puanı', targets: ['dateapp-api'] },
        { id: 'profil-ekrani', title: 'Profil ekranı', targets: ['dateapp-mobile'] },
      ],
    },
  ],
};

interface AccountPlan {
  readonly key: AccountKey;
  readonly label: string;
  readonly provider: string;
  readonly authMode: 'subscription' | 'api_key';
  readonly plan?: string;
  /** Windows in the order the account frame lists them; `percent` is the used share. */
  readonly windows: readonly WindowPlan[];
  /** Monthly spend already recorded, in USD, and its cap. */
  readonly monthUsd?: number;
  readonly capUsd?: number;
}
interface WindowPlan {
  readonly label: string;
  readonly kind: 'five_hour' | 'week' | 'month';
  readonly percent: number;
  readonly resetsAt: EpochMs;
}

// Istanbul is UTC+3: 14:30 local is 11:30 UTC, Sunday 00:00 local is Saturday 21:00 UTC.
const FIVE_HOUR_RESET: EpochMs = Date.UTC(2026, 8, 29, 11, 30, 0);
const WEEK_RESET: EpochMs = Date.UTC(2026, 9, 3, 21, 0, 0);
const MONTH_RESET: EpochMs = Date.UTC(2026, 9, 1, 0, 0, 0);

const ACCOUNTS: readonly AccountPlan[] = [
  {
    key: 'claude-max', label: 'Claude Max', provider: 'claude-code', authMode: 'subscription', plan: 'Max',
    windows: [
      { label: '5 saatlik pencere', kind: 'five_hour', percent: 41, resetsAt: FIVE_HOUR_RESET },
      { label: 'Haftalık pencere', kind: 'week', percent: 12, resetsAt: WEEK_RESET },
    ],
  },
  {
    key: 'zai-glm', label: 'z.ai GLM', provider: 'claude-code', authMode: 'api_key',
    windows: [{ label: 'Aylık pencere', kind: 'month', percent: 25, resetsAt: MONTH_RESET }],
    monthUsd: 12.4, capUsd: 50,
  },
  {
    key: 'codex-pro', label: 'Codex Pro', provider: 'codex', authMode: 'subscription', plan: 'Pro',
    windows: [
      { label: '5 saatlik pencere', kind: 'five_hour', percent: 88, resetsAt: FIVE_HOUR_RESET },
      { label: 'Haftalık pencere', kind: 'week', percent: 64, resetsAt: WEEK_RESET },
    ],
  },
  {
    key: 'antigravity', label: 'Antigravity', provider: 'agy', authMode: 'subscription',
    windows: [
      { label: '5 saatlik pencere', kind: 'five_hour', percent: 64, resetsAt: FIVE_HOUR_RESET },
      { label: 'Haftalık pencere', kind: 'week', percent: 38, resetsAt: WEEK_RESET },
    ],
  },
  {
    key: 'gemini', label: 'Gemini', provider: 'gemini', authMode: 'subscription',
    windows: [{ label: 'Haftalık pencere', kind: 'week', percent: 91, resetsAt: WEEK_RESET }],
  },
  {
    key: 'kimi', label: 'Kimi', provider: 'opencode', authMode: 'api_key',
    windows: [{ label: 'Aylık pencere', kind: 'month', percent: 99, resetsAt: MONTH_RESET }],
    monthUsd: 8.9, capUsd: 9,
  },
];

// --- helpers -------------------------------------------------------------------------------------
const run = (command: string, args: readonly string[], cwd: string): void => {
  execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
};
const GIT_IDENTITY = ['-c', 'user.name=Docket Design Seed', '-c', 'user.email=seed@docket.local'];

const writeYaml = (dir: string, relative: string, value: unknown): void => {
  const target = join(dir, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, stringify(value));
};

const flowDefinition = {
  id: FLOW_ID,
  name: 'Standart akış',
  stages: STAGES.map((stage) => ({
    id: stage.id,
    name: stage.name,
    role: stage.role,
    exit: stage.gate === undefined ? [] : [{ kind: 'human', id: stage.gate.id, label: stage.gate.label }],
  })),
};

const roleDefinition = (id: string, name: string) => ({
  id,
  name,
  instructions: `${name} olarak iş emrinin bu aşamasını yürüt.`,
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
});

// --- the repos -----------------------------------------------------------------------------------
const home = mkdtempSync(join(tmpdir(), 'docket-design-home-'));
const dataDir = join(home, '.docket');
mkdirSync(dataDir, { recursive: true });
const repoPath = (slug: string): string => join(home, 'repos', slug);

for (const project of PROJECTS) {
  for (const slug of project.repos) {
    const dir = repoPath(slug);
    mkdirSync(dir, { recursive: true });
    try {
      run('git', ['init', '--quiet', '--initial-branch=main'], dir);
    } catch {
      // An older git without --initial-branch: any branch has a HEAD to anchor a worktree to.
      run('git', ['init', '--quiet'], dir);
    }
    writeFileSync(join(dir, 'README.md'), `# ${slug}\n\nSeeded repo of ${project.name}.\n`);

    writeYaml(dir, '.docket/repo.yaml', {
      id: slug,
      name: slug,
      flows: [FLOW_ID],
      defaultFlow: FLOW_ID,
      commandSets: {},
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    });
    writeYaml(dir, `.docket/flows/${FLOW_ID}.yaml`, flowDefinition);
    for (const role of STAGES.map((stage) => stage.role)) {
      writeYaml(dir, `.docket/roles/${role}.yaml`, roleDefinition(role, role));
    }

    if (slug === project.main) {
      writeYaml(dir, '.docket/project.yaml', {
        id: project.id,
        name: project.name,
        mainRepo: project.main,
        repos: project.repos,
        ...(project.budgetUsd === undefined ? {} : { budget: { amountUsd: project.budgetUsd, warnPercent: 80 } }),
      });
      const phases = ROADMAPS[project.id];
      if (phases !== undefined) {
        writeYaml(dir, '.docket/roadmap.yaml', {
          phases: phases.map((phase) => ({
            id: phase.id,
            name: phase.name,
            blockedBy: [],
            tasks: phase.tasks.map((task) => ({
              id: task.id,
              title: task.title,
              dependsOn: [],
              acceptance: [`${task.title} tamamlandı`],
              targets: task.targets,
            })),
          })),
        });
      }
    }
    run('git', [...GIT_IDENTITY, 'add', '-A'], dir);
    run('git', [...GIT_IDENTITY, 'commit', '--quiet', '-m', 'seed'], dir);
  }
}

// --- the database, through the app's own composition ----------------------------------------------
const node = createNodeDeps({
  dataDir,
  // Cipher and transport stubs: the seed stores no secrets and starts no run — the launched app
  // brings the real ones.
  cipher: {
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(plain, 'utf8'),
    decryptString: (blob: Uint8Array) => Buffer.from(blob).toString('utf8'),
  },
  transports: { forAccount: async () => undefined },
  notifier: { notify: () => undefined },
  commandEnv: {},
  clock: { now: () => clockNow },
  random: (length: number) => new Uint8Array(length),
});
if (!node.ok) throw new Error(`seed could not open deps: ${JSON.stringify(node.error)}`);
const deps = node.value.deps;

// Accounts come first so their ids sort before everything else.
setClock(ago(40 * 24 * 60));
const accountIds = new Map<AccountKey, AccountId>();
const accountOf = (key: AccountKey): AccountId => {
  const id = accountIds.get(key);
  assert(id !== undefined, `account ${key} is not seeded`);
  return id;
};
for (const plan of ACCOUNTS) {
  const id = deps.ids.next<'account'>();
  accountIds.set(plan.key, id);
  const record: AccountRecord = {
    id,
    provider: plan.provider,
    label: plan.label,
    authMode: plan.authMode,
    ...(plan.plan === undefined ? {} : { plan: plan.plan }),
    limitPolicy: 'wait_resume',
    caps: plan.capUsd === undefined ? [] : [{ scope: 'account_month', cap: { amountUsd: plan.capUsd, warnPercent: 80 } }],
  };
  const saved = await saveAccount(deps, { record, actor: OPERATOR });
  assert(saved.ok, `account ${plan.label} did not save`);

  const pool: Pool = { id: deps.ids.next<'pool'>(), accountId: id, label: plan.label, kind: 'allowance', appliesTo: 'all' };
  await deps.accounts.savePools(id, [pool]);
  for (const window of plan.windows) {
    const isMoney = window.kind === 'month' && plan.capUsd !== undefined;
    const limit = isMoney ? (plan.capUsd ?? 100) : 100;
    const used = isMoney ? Math.round(limit * window.percent) / 100 : window.percent;
    const meter: Meter = {
      id: deps.ids.next<'meter'>(),
      poolId: pool.id,
      label: window.label,
      cadence: window.kind === 'five_hour' ? 'rolling_from_first_use' : window.kind === 'week' ? 'fixed' : 'billing_cycle',
      durationMs: window.kind === 'five_hour' ? 5 * HOUR : window.kind === 'week' ? 7 * DAY : 30 * DAY,
      unit: isMoney ? 'usd' : 'percent',
      used,
      limit,
      remaining: limit - used,
      resetsAt: window.resetsAt,
      resetPrecision: 'exact',
      observedAt: NOW,
      source: 'polled',
      // Far beyond any review session: a stale meter would collapse the bar the audit measures.
      staleAfterMs: 365 * DAY,
    };
    await deps.accounts.saveMeter(meter);
  }
}

// Every role prefers Claude Max, then the API-key accounts.
for (const stage of STAGES) {
  const bound = await saveBinding(deps, {
    scope: { level: 'global' },
    binding: {
      role: stage.role as RoleSlug,
      accounts: [{ accountId: accountOf('claude-max') }, { accountId: accountOf('zai-glm') }],
    },
    actor: OPERATOR,
  });
  assert(bound.ok, `binding for ${stage.role} did not save`);
}

setClock(ago(30 * 24 * 60));
for (const project of PROJECTS) {
  const extras = project.repos
    .filter((slug) => slug !== project.main)
    .map((slug) => ({ repo: slug as RepoSlug, path: repoPath(slug) }));
  const attached = await attachProject(deps, { path: repoPath(project.main), actor: OPERATOR, repos: extras });
  assert(attached.ok, `project ${project.id} did not attach: ${attached.ok ? '' : attached.error}`);
}
const projectOfRepo = new Map<string, string>();
for (const project of PROJECTS) for (const slug of project.repos) projectOfRepo.set(slug, project.id);

// --- the work orders -----------------------------------------------------------------------------
const stageEntry = (plan: OrderPlan): EpochMs => {
  // Running and awaiting orders are anchored on their run; a ready one on the stage entry itself.
  if (plan.state === 'running') return ago(plan.minutes);
  if (plan.state === 'awaiting') return ago(plan.minutes) - 10 * MINUTE;
  if (plan.state === 'ready') return ago(plan.minutes);
  return ago(plan.minutes) - 12 * MINUTE; // done: the last stage's run started 12 minutes before it closed
};

const ROLE_OF = (stage: number): RoleSlug => STAGES[stage].role as RoleSlug;
const stageSlug = (stage: number): StageSlug => STAGES[stage].id as StageSlug;

const finishedRun = async (
  workOrderId: WorkOrderId,
  plan: OrderPlan,
  stage: number,
  startedAt: EpochMs,
  endedAt: EpochMs,
): Promise<void> => {
  const runId = deps.ids.next<'run'>();
  await deps.runs.create({
    id: runId,
    workOrderId,
    stage: stageSlug(stage),
    attempt: 1,
    role: ROLE_OF(stage),
    route: { accountId: accountOf(plan.account) },
    startedAt,
    endedAt,
    outcome: 'succeeded',
    autoResumesUsed: 0,
  });
  await deps.workOrders.appendEvent(workOrderId, { type: 'run_started', at: startedAt, runId, stage: stageSlug(stage), attempt: 1 });
  await deps.workOrders.appendEvent(workOrderId, { type: 'run_finished', at: endedAt, runId, outcome: 'succeeded' });
};

const approve = async (workOrderId: WorkOrderId, stage: number, at: EpochMs): Promise<void> => {
  const gate = STAGES[stage].gate;
  if (gate === undefined) return;
  setClock(at);
  const decided = await decideHumanGate(deps, {
    id: workOrderId,
    gate: gate.id as GateSlug,
    decision: 'approved',
    actor: OPERATOR,
  });
  assert(decided.ok, `gate ${gate.id} did not pass: ${decided.ok ? '' : decided.error}`);
};

const liveEvents = (plan: OrderPlan, startedAt: EpochMs): readonly AgentEvent[] => {
  const events: AgentEvent[] = [
    { type: 'session_started', at: startedAt, sessionRef: `oturum-${plan.code.toLowerCase()}` },
    { type: 'text', at: startedAt + MINUTE, delta: `${plan.title}: dosyalar okunuyor.` },
    { type: 'tool_call', at: startedAt + 2 * MINUTE, id: 'okuma-1', name: 'Read', target: 'src/service.ts' },
    { type: 'tool_result', at: startedAt + 2 * MINUTE + 5_000, id: 'okuma-1', ok: true },
    { type: 'text', at: startedAt + 3 * MINUTE, delta: 'Plan hazır, değişiklikler yazılıyor.' },
  ];
  if (plan.usd !== undefined) {
    events.push({ type: 'usage', at: startedAt + 4 * MINUTE, inputTokens: 18_200, outputTokens: 2_400, costUsd: plan.usd, costKind: 'reported' });
  }
  if (plan.ask !== undefined) {
    events.push({ type: 'tool_call', at: NOW - 30_000, id: 'komut-1', name: 'Bash', target: plan.ask });
    events.push({ type: 'permission_ask', at: NOW, id: `izin-${plan.code.toLowerCase()}`, tool: 'Bash', target: plan.ask, options: ['allow', 'deny'] });
  }
  return events;
};

const codes: Record<string, { id: WorkOrderId; project: string; repo: string; title: string; stage: string; state: PlanState }> = {};
const spendLedger = new Map<AccountKey, number>();

for (const plan of ORDERS) {
  const project = projectOfRepo.get(plan.repo);
  assert(project !== undefined, `${plan.code}: repo ${plan.repo} belongs to no project`);
  const entry = stageEntry(plan);
  // Earlier stages complete an hour apart, the last of them handing over exactly at `entry`.
  const decisionAt = (stage: number): EpochMs => entry - (plan.stage - 1 - stage) * HOUR;
  const firstStart = plan.stage === 0 ? entry : decisionAt(0) - 11 * MINUTE;

  setClock(firstStart - 5 * MINUTE);
  const opened = await openWorkOrder(deps, {
    project: project as ProjectSlug,
    repo: plan.repo as RepoSlug,
    title: plan.title,
    ...(plan.task === undefined ? {} : { task: plan.task as TaskSlug }),
    actor: OPERATOR,
  });
  assert(opened.ok, `${plan.code} did not open: ${opened.ok ? '' : opened.error}`);
  const id = opened.value;

  for (let stage = 0; stage < plan.stage; stage += 1) {
    await finishedRun(id, plan, stage, decisionAt(stage) - 11 * MINUTE, decisionAt(stage) - MINUTE);
    await approve(id, stage, decisionAt(stage));
  }

  if (plan.state === 'running') {
    const runId: RunId = deps.ids.next<'run'>();
    await deps.runs.create({
      id: runId,
      workOrderId: id,
      stage: stageSlug(plan.stage),
      attempt: 1,
      role: ROLE_OF(plan.stage),
      route: { accountId: accountOf(plan.account) },
      startedAt: entry,
      autoResumesUsed: 0,
    });
    await deps.runs.appendEvents(runId, liveEvents(plan, entry));
    await deps.workOrders.appendEvent(id, { type: 'run_started', at: entry, runId, stage: stageSlug(plan.stage), attempt: 1 });
  } else if (plan.state === 'awaiting' || plan.state === 'done') {
    await finishedRun(id, plan, plan.stage, entry, entry + 10 * MINUTE);
    if (plan.state === 'done') await approve(id, plan.stage, ago(plan.minutes));
  }

  if (plan.usd !== undefined) {
    await deps.accounts.recordSpend({
      accountId: accountOf(plan.account),
      project: project as ProjectSlug,
      repo: plan.repo as RepoSlug,
      workOrderId: id,
      at: Math.min(NOW, entry + 2 * MINUTE),
      usd: plan.usd,
    });
    spendLedger.set(plan.account, (spendLedger.get(plan.account) ?? 0) + plan.usd);
  }
  codes[plan.code] = {
    id,
    project,
    repo: plan.repo,
    title: plan.title,
    stage: STAGES[plan.stage].id,
    state: plan.state,
  };
}

// The API-key accounts show this month's spend against their cap; one earlier order carries the
// remainder so the totals read exactly 12,40 $ and 8,90 $.
const carriers: Readonly<Partial<Record<AccountKey, string>>> = { 'zai-glm': 'İE-0021', kimi: 'İE-0036' };
for (const plan of ACCOUNTS) {
  const carrier = carriers[plan.key];
  if (plan.monthUsd === undefined || carrier === undefined) continue;
  const order = codes[carrier];
  assert(order !== undefined, `carrier ${carrier} is not seeded`);
  const remainder = Math.round((plan.monthUsd - (spendLedger.get(plan.key) ?? 0)) * 100) / 100;
  assert(remainder >= 0, `${plan.label} spend already exceeds its month total`);
  await deps.accounts.recordSpend({
    accountId: accountOf(plan.key),
    project: order.project as ProjectSlug,
    repo: order.repo as RepoSlug,
    workOrderId: order.id,
    at: NOW - 20 * DAY,
    usd: remainder,
  });
}

// --- self-checks: the seed refuses to hand out a world that differs from the plan -----------------------
const EXPECTED_STATUS: Readonly<Record<PlanState, string>> = {
  running: 'running',
  awaiting: 'awaiting_human',
  ready: 'ready',
  done: 'done',
};
for (const plan of ORDERS) {
  const seeded = codes[plan.code];
  assert(seeded !== undefined);
  const loaded = await deps.definitions.load(plan.repo as RepoSlug);
  assert(loaded.ok, `${plan.code}: definitions did not load`);
  const flow = loaded.value.flows.find((candidate) => candidate.id === FLOW_ID);
  assert(flow !== undefined, `${plan.code}: the standard flow is missing`);
  const state = deriveWorkOrderState(flow, await deps.workOrders.events(seeded.id));
  assert.equal(state.status, EXPECTED_STATUS[plan.state], `${plan.code} derived ${state.status}`);
  assert.equal(state.stage, plan.state === 'done' ? null : STAGES[plan.stage].id, `${plan.code} stage`);
}

const api = createApi(deps);
const cockpit = (await api.query({ type: 'cockpit' })) as {
  readonly attention: readonly { readonly workOrderId: string; readonly kind: string }[];
  readonly running: readonly unknown[];
  readonly recentlyClosed: readonly { readonly workOrderId: string }[];
};
const attentionIds = new Set(cockpit.attention.map((item) => item.workOrderId));
for (const code of ['İE-0029', 'İE-0012', 'İE-0031']) {
  const seeded = codes[code];
  assert(seeded !== undefined && attentionIds.has(seeded.id), `${code} must wait on the operator in the cockpit`);
}
assert.equal(cockpit.attention.find((item) => item.workOrderId === codes['İE-0029']?.id)?.kind, 'permission_ask');
assert.deepEqual(
  cockpit.recentlyClosed.map((item) => item.workOrderId),
  ['İE-0009', 'İE-0036', 'İE-0007', 'İE-0003', 'İE-0002'].map((code) => codes[code]?.id),
  'the five most recent closes',
);
const tree = (await api.query({ type: 'project.tree' })) as readonly { readonly project: string; readonly repos: readonly unknown[] }[];
assert.deepEqual(
  tree.map((item) => [item.project, item.repos.length]),
  [['antero', 7], ['date-app', 3], ['docket', 2], ['kadife-odoo', 1], ['telerelay', 1]],
);

node.value.close();

// --- the scripted agent binary -----------------------------------------------------------------------
const agentBin = join(home, 'bin', 'design-agent');
mkdirSync(dirname(agentBin), { recursive: true });
copyFileSync(resolve(here, 'smoke-agent.mjs'), agentBin);
chmodSync(agentBin, 0o755);

const manifest = {
  home,
  dataDir,
  agentBin,
  fixedNow: NOW,
  repos: Object.fromEntries(PROJECTS.flatMap((project) => project.repos.map((slug) => [slug, repoPath(slug)] as const))),
  projects: Object.fromEntries(PROJECTS.map((project) => [project.id, { name: project.name, main: project.main, repos: project.repos }])),
  accounts: Object.fromEntries(ACCOUNTS.map((plan) => [plan.label, accountIds.get(plan.key)])),
  codes,
};
console.log(`# home ${home}`);
console.log(`# ${Object.keys(codes).length} work orders in ${PROJECTS.length} projects`);
console.log(`SEED=${JSON.stringify(manifest)}`);
