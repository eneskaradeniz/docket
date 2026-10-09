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
// The one LIVE piece is İE-0029's permission ask. A seeded ask — an event written straight to
// the store — can never be answered: only the run executor parks an ask on the in-process
// permission board, so `permission.answer` would answer not_found and the cockpit row would
// never close. The seed therefore queues the stage (enqueueStage) on the account whose provider
// the harness overrides, and the scripted design-agent asks the prototype's command over the
// real ACP transport once the launched app's dispatcher starts the run. Answering in the UI then
// resolves the board entry and the permission_answered event closes the row (#815).
//
// Determinism: a fixed clock and a zero random source. The ULID generator stays monotonic when the
// clock moves backwards, so ids follow creation order and repeat exactly run over run.
//
// Where the prototype disagrees with itself, the rev-7 screens win. A work order's code (İE-nnnn)
// is not stored anywhere: A-29 derives the number from the (createdAt, id) order, so the orders
// open in prototype code order, one minute apart, before any timeline replays — the numbers then
// follow the code order densely (1..N). The prototype's codes are sparse (İE-0002…İE-0046 with 18
// ranks absent), so a code's displayed number is its rank in code order, not its literal digits:
// the manifest's `codes` map stays keyed by the prototype code and each entry carries its real
// `number` under that rule.
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

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
import { grantSpendConsent } from '../src/application/use-cases/spend-consent';
import { openWorkOrder } from '../src/application/use-cases/work-orders';
import { DEFAULT_MODEL_CONSENT } from '../src/application/services/spend-consent';
import { enqueueStage } from '../src/application/services/dispatcher';
import { createNodeDeps } from '../src/infrastructure/compose/create-node-deps';

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

type AccountKey = 'claude-max' | 'zai-glm' | 'codex-pro' | 'antigravity' | 'copilot' | 'opencode-key';

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
  /** The command the order's LIVE stage run asks the operator about: the seed queues the stage
   *  (the ask rigging below the orders loop) and the scripted design-agent raises the ask when
   *  the launched app's executor starts the run. No seeded event carries it. */
  readonly ask?: string;
}

// Two antero-api orders the prototype shows running sit `ready` here, beside İE-0029's queued
// stage: still-active seeded runs count against the dispatcher's limits (global 4, per-repo 3),
// and the live ask's queue item needs a free slot on both counts or the launched app would hold
// it waiting forever. İE-0014 stays running — its detail is the one the audits walk.
const ORDERS: readonly OrderPlan[] = [
  // antreo-api — the board every screen lands on
  { code: 'İE-0034', repo: 'antreo-api', title: 'Rol matrisi', stage: 0, state: 'ready', minutes: 30, account: 'claude-max' },
  { code: 'İE-0038', repo: 'antreo-api', title: 'Önbellek', stage: 1, state: 'running', minutes: 4, account: 'codex-pro', usd: 0.42 },
  { code: 'İE-0014', repo: 'antreo-api', title: 'Fatura raporu', stage: 2, state: 'running', minutes: 6, account: 'zai-glm', usd: 0.31 },
  {
    // The ask's command keeps the prototype's `dotnet ef database update` head (J-1 waits on the
    // text) and carries a ~170-character tail with no break opportunity at all — the shape of a
    // real run's ask that every surface showing an ask (the cockpit row, the live pane, the
    // detail's ask column) must contain.
    code: 'İE-0029', repo: 'antreo-api', title: 'Hız sınırı', stage: 2, state: 'ready', minutes: 9, account: 'zai-glm',
    usd: 0.09,
    ask: 'dotnet ef database update --bundle /Users/eneskaradeniz/.docket-test/antreo-api/ef-bundles/migrations/20261008091800_InvoiceReconciliationIndexes/InvoiceReconciliationBackgroundServiceIndexesBundle.csproj',
  },
  { code: 'İE-0033', repo: 'antreo-api', title: 'Log düzeni', stage: 2, state: 'ready', minutes: 25, account: 'zai-glm' },
  { code: 'İE-0015', repo: 'antreo-api', title: 'Stok uyarısı', stage: 3, state: 'ready', minutes: 3, account: 'claude-max', usd: 0.22 },
  { code: 'İE-0032', repo: 'antreo-api', title: 'Swagger belgeleri', stage: 4, state: 'ready', minutes: 14, account: 'antigravity', usd: 0.18 },
  { code: 'İE-0046', repo: 'antreo-api', title: 'Swagger staging testi', stage: 4, state: 'awaiting', minutes: 12, account: 'antigravity', usd: 0.27 },
  { code: 'İE-0009', repo: 'antreo-api', title: 'Müşteri etiketi', stage: 5, state: 'done', minutes: 1300, account: 'claude-max', usd: 0.6 },
  { code: 'İE-0036', repo: 'antreo-api', title: 'Webhook doğrulaması', stage: 5, state: 'done', minutes: 1500, account: 'opencode-key', usd: 0.4 },
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
  { code: 'İE-0039', repo: 'dateapp-api', title: 'Eşleşme puanı', stage: 2, state: 'ready', minutes: 35, account: 'copilot' },
  { code: 'İE-0040', repo: 'telerelay', title: 'Webhook yeniden deneme', stage: 3, state: 'ready', minutes: 45, account: 'copilot' },
  { code: 'İE-0012', repo: 'kadife-odoo', title: 'Teslim tarihi', stage: 4, state: 'awaiting', minutes: 12, account: 'copilot', usd: 0.25 },
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
    key: 'copilot', label: 'Copilot', provider: 'copilot', authMode: 'subscription',
    windows: [{ label: 'Haftalık pencere', kind: 'week', percent: 91, resetsAt: WEEK_RESET }],
  },
  {
    key: 'opencode-key', label: 'OpenCode API', provider: 'opencode', authMode: 'api_key',
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

// The live stream's unbreakable witness (#831): a real run's tool targets are long absolute
// paths with no break opportunities — exactly the text that widened `main` during live runs, and
// the one the layout audit's L-14 must see on the detail screen it walks.
const LONG_TARGET =
  '/Users/eneskaradeniz/source/antreo/antreo-api/test/Antero.Api.ReconciliationTests/V2/Invoices/Reconciliation/InvoiceReconciliationBackgroundServiceTests/Antero.Api.ReconciliationBackgroundServiceTests.cs';

const liveEvents = (plan: OrderPlan, startedAt: EpochMs): readonly AgentEvent[] => {
  const events: AgentEvent[] = [
    { type: 'session_started', at: startedAt, sessionRef: `oturum-${plan.code.toLowerCase()}` },
    { type: 'text', at: startedAt + MINUTE, delta: `${plan.title}: dosyalar okunuyor.` },
    { type: 'tool_call', at: startedAt + 2 * MINUTE, id: 'okuma-1', name: 'Read', target: 'src/service.ts' },
    { type: 'tool_result', at: startedAt + 2 * MINUTE + 5_000, id: 'okuma-1', ok: true },
    { type: 'tool_call', at: startedAt + 2 * MINUTE + 10_000, id: 'komut-1', name: 'Bash', target: LONG_TARGET },
    { type: 'tool_result', at: startedAt + 2 * MINUTE + 20_000, id: 'komut-1', ok: true },
    { type: 'text', at: startedAt + 3 * MINUTE, delta: 'Plan hazır, değişiklikler yazılıyor.' },
  ];
  if (plan.usd !== undefined) {
    events.push({ type: 'usage', at: startedAt + 4 * MINUTE, inputTokens: 18_200, outputTokens: 2_400, costUsd: plan.usd, costKind: 'reported' });
  }
  // No seeded permission_ask: only the executor's board can answer one, so an ask written here
  // would strand the cockpit row. The one ask of this world rides the live queued run instead.
  return events;
};

const codes: Record<string, { id: WorkOrderId; number: number; project: string; repo: string; title: string; stage: string; state: PlanState }> = {};
const spendLedger = new Map<AccountKey, number>();

// Phase 1 — every order opens in prototype code order, one minute apart: the A-29 numbers then
// follow the code order (the ids ascend with the clock, so createdAt alone fixes the rank). The
// anchor predates every replayed timeline and postdates the project attachments.
const ORDERS_BY_CODE = [...ORDERS].sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
const openedIds = new Map<string, WorkOrderId>();
let createdClock: EpochMs = NOW - 21 * DAY;
for (const plan of ORDERS_BY_CODE) {
  setClock(createdClock);
  const project = projectOfRepo.get(plan.repo);
  assert(project !== undefined, `${plan.code}: repo ${plan.repo} belongs to no project`);
  const opened = await openWorkOrder(deps, {
    project: project as ProjectSlug,
    repo: plan.repo as RepoSlug,
    title: plan.title,
    ...(plan.task === undefined ? {} : { task: plan.task as TaskSlug }),
    actor: OPERATOR,
  });
  assert(opened.ok, `${plan.code} did not open: ${opened.ok ? '' : opened.error}`);
  openedIds.set(plan.code, opened.value);
  createdClock += MINUTE;
}

// Phase 2 — each order's timeline replays at its own absolute times; the order the phases run in
// changes nothing the screens derive (states, ages and closes all read the events, not createdAt).
for (const plan of ORDERS_BY_CODE) {
  const id = openedIds.get(plan.code);
  assert(id !== undefined, `${plan.code} did not open`);
  const project = projectOfRepo.get(plan.repo);
  assert(project !== undefined, `${plan.code}: repo ${plan.repo} belongs to no project`);
  const entry = stageEntry(plan);
  // Earlier stages complete an hour apart, the last of them handing over exactly at `entry`.
  const decisionAt = (stage: number): EpochMs => entry - (plan.stage - 1 - stage) * HOUR;

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
  const number = await deps.workOrders.number(id);
  assert(number !== undefined, `${plan.code} did not number`);
  codes[plan.code] = {
    id,
    number,
    project,
    repo: plan.repo,
    title: plan.title,
    stage: STAGES[plan.stage].id,
    state: plan.state,
  };
}

// The API-key accounts show this month's spend against their cap; one earlier order carries the
// remainder so the totals read exactly 12,40 $ and 8,90 $.
const carriers: Readonly<Partial<Record<AccountKey, string>>> = { 'zai-glm': 'İE-0021', 'opencode-key': 'İE-0036' };
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

// --- the live permission ask -----------------------------------------------------------------------
// İE-0029's stage is queued, never pre-run: the launched app's dispatcher starts it on its own
// cadence, the scripted design-agent asks the plan's command over the real ACP transport, and the
// executor parks the ask on the in-process permission board — the same production entry every
// run uses. The UI's answer then resolves the board entry and the permission_answered event
// closes the cockpit row (#815). Three facts make the start possible at all:
//   - the route: a work-order-scoped binding hands this one order's stage role to the OpenCode
//     account, the only provider whose binary the design harness overrides — every other order
//     keeps the world's usual accounts;
//   - the consent: an api-key route without recorded consent is refused before any write, so the
//     account carries the default-model marker its cap already backs;
//   - the queue item itself, written by the production use-case the UI's own enqueue command uses.
const askingPlan = ORDERS.find((plan) => plan.ask !== undefined);
assert(askingPlan !== undefined, 'no order carries the live ask');
const askCommand = askingPlan.ask;
assert(askCommand !== undefined, 'the asking plan carries its command');
assert(askingPlan.code === 'İE-0029' && askingPlan.state === 'ready', 'the asking order must be İE-0029, ready at its stage');
const askingOrder = codes[askingPlan.code];
assert(askingOrder !== undefined, `${askingPlan.code} is seeded`);
setClock(ago(askingPlan.minutes)); // queued the moment the stage stood ready
const scopedBinding = await saveBinding(
  deps,
  {
    scope: { level: 'workOrder', workOrderId: askingOrder.id },
    binding: { role: ROLE_OF(askingPlan.stage), accounts: [{ accountId: accountOf('opencode-key') }] },
    actor: OPERATOR,
  },
);
assert(scopedBinding.ok, `the asking order's route did not bind: ${scopedBinding.ok ? '' : scopedBinding.error}`);
const consented = await grantSpendConsent(deps, { accountId: accountOf('opencode-key'), model: DEFAULT_MODEL_CONSENT, actor: OPERATOR });
assert(consented.ok, `the OpenCode account's consent did not record: ${consented.ok ? '' : consented.error}`);
const queuedAsk = await enqueueStage(deps, { id: askingOrder.id });
assert(queuedAsk.ok, `the asking stage did not enqueue: ${queuedAsk.ok ? '' : queuedAsk.error}`);

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

// A-29: the prototype's code order is exactly the number order — every code numbers its rank
// among the opened orders, and the manifest entry agrees with the port.
for (const [index, plan] of ORDERS_BY_CODE.entries()) {
  const seeded = codes[plan.code];
  assert(seeded !== undefined, `${plan.code} is seeded`);
  assert.equal(await deps.workOrders.number(seeded.id), index + 1, `${plan.code} must number ${index + 1}`);
  assert.equal(seeded.number, index + 1, `${plan.code} manifest number`);
}

const api = createApi(deps);
const cockpit = (await api.query({ type: 'cockpit' })) as {
  readonly attention: readonly { readonly workOrderId: string; readonly kind: string }[];
  readonly running: readonly unknown[];
  readonly recentlyClosed: readonly { readonly workOrderId: string }[];
};
const attentionIds = new Set(cockpit.attention.map((item) => item.workOrderId));
for (const code of ['İE-0012', 'İE-0031']) {
  const seeded = codes[code];
  assert(seeded !== undefined && attentionIds.has(seeded.id), `${code} must wait on the operator in the cockpit`);
}
// Nothing asks at seed time: the ask belongs to the live run the launched app starts. A
// permission_ask row here would be the #815 defect again — listed forever, never answerable.
assert.equal(cockpit.attention.filter((item) => item.kind === 'permission_ask').length, 0, 'no ask may exist before the app runs');
assert(!attentionIds.has(askingOrder.id), 'the asking order must not sit in attention before its run asks');

// The live rig, read back through the ports: one queued stage on the OpenCode account, no run
// for the asking order, and dispatch room on both limit counts (global 4, per-repo 3) — the
// world the launched app's dispatcher needs to start the item on its first tick.
const queueItems = await deps.queue.list();
assert.equal(queueItems.length, 1, 'exactly one queued stage');
const [askItem] = queueItems;
assert.equal(askItem.workOrderId, askingOrder.id, 'the queued stage belongs to the asking order');
assert.equal(askItem.stage, stageSlug(askingPlan.stage), 'the queued stage is the asking one');
assert.equal(askItem.route.accountId, accountOf('opencode-key'), 'the queued stage rides the OpenCode account');
// Earlier stages may carry their finished runs; the ASKING stage must carry none — a seeded run
// there would hold the work order busy and race the live attempt the dispatcher starts.
const askingStageRuns = (await deps.runs.listForWorkOrder(askingOrder.id)).filter(
  (run) => run.stage === stageSlug(askingPlan.stage),
);
assert.equal(askingStageRuns.length, 0, 'the asking stage carries no seeded run');
const activeRuns = await deps.runs.listActive();
assert.ok(activeRuns.length <= 3, `${activeRuns.length} active runs leave the dispatcher no global slot for the queued stage`);
const repoOfOrder = new Map(Object.values(codes).map((entry) => [entry.id as string, entry.repo] as const));
let activeOnAskingRepo = 0;
for (const run of activeRuns) {
  if (repoOfOrder.get(run.workOrderId) === askingPlan.repo) activeOnAskingRepo += 1;
}
assert.ok(activeOnAskingRepo <= 2, `${activeOnAskingRepo} active runs on ${askingPlan.repo} leave the dispatcher no repo slot`);
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
// Generated, not copied: the smoke's agent belongs to the smoke, and this world's ask must name
// İE-0029's command so the cockpit's code band reads the prototype's. Same ACP contract as the
// smoke's (initialize → session/new → one request_permission → the answer ends the turn), so the
// live run parks with an open, answerable ask and no timeout races anywhere.
const designAgentScript = (command: string): string => `#!/usr/bin/env node
// design-agent — generated by e2e/seed-design.ts. Speaks the Agent Client Protocol over stdio
// (newline-delimited JSON-RPC 2.0) exactly as the app's ACP transport expects:
//   --version              → print one line, exit 0 (discovery's probe)
//   initialize             → protocolVersion 1, no optional capabilities
//   session/new            → a fixed session id
//   session/prompt         → emit ONE session/request_permission for the seeded command, then wait
//   answer to that request → answer the prompt turn with stopReason end_turn, exit 0
const PERMISSION_RPC_ID = 1001;

if (process.argv.includes('--version')) {
  process.stdout.write('docket-design-agent 1.0.0\\n');
  process.exit(0);
}

const send = (message) => {
  process.stdout.write(JSON.stringify(message) + '\\n');
};

import { createInterface } from 'node:readline';

let promptRpcId = null;

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const text = line.trim();
  if (text === '') return;
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return; // not JSON-RPC; ignored like any agent would
  }

  if (typeof message.id === 'number' && typeof message.method === 'string') {
    if (message.method === 'initialize') {
      send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {} } });
      return;
    }
    if (message.method === 'session/new') {
      send({ jsonrpc: '2.0', id: message.id, result: { sessionId: 'tasarim-session-1' } });
      return;
    }
    if (message.method === 'session/prompt') {
      promptRpcId = message.id;
      send({
        jsonrpc: '2.0',
        id: PERMISSION_RPC_ID,
        method: 'session/request_permission',
        params: {
          toolCall: {
            name: 'Bash',
            title: 'Hız sınırı: ${command}',
            toolCallId: 'komut-1',
            locations: [{ path: '${command}' }],
          },
          options: [
            { optionId: 'allow-once', kind: 'allow_once' },
            { optionId: 'reject-once', kind: 'reject_once' },
          ],
        },
      });
      return;
    }
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown method ' + message.method } });
    return;
  }

  if (message.id === PERMISSION_RPC_ID && message.result !== undefined && promptRpcId !== null) {
    send({ jsonrpc: '2.0', id: promptRpcId, result: { stopReason: 'end_turn' } });
    process.exit(0);
  }
});
`;
const agentBin = join(home, 'bin', 'design-agent');
mkdirSync(dirname(agentBin), { recursive: true });
writeFileSync(agentBin, designAgentScript(askCommand));
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
