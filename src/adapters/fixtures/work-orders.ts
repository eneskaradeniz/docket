// Raw-state fixtures covering the six states WO-0002 requires (AC2). These are the same data
// the UI renders, and the same data core tests assert against (AC9 relaxed).
import type { WorkOrder, WorkOrderId } from '../../core/types';
import { REPOS, tid, WORKSPACES, woid } from './ids';

// 1. Stopped and asking — implementer session halted at a named gate, question pinned.
export const woStoppedAsking: WorkOrder = {
  id: woid('WO-1001'),
  title: 'Token refresh on resume',
  workspace: WORKSPACES.docket,
  mode: 'plan',
  stage: 'implementation',
  tracks: [
    {
      id: tid('wo-1001-app'),
      repo: REPOS.docketApp,
      dependsOn: [],
      stage: 'implementation',
      ci: { kind: 'run', state: 'running', checks: [] },
    },
  ],
  sessions: [
    {
      role: 'implementer',
      status: 'stopped_asking',
      scope: tid('wo-1001-app'),
      transcript: [
        { speaker: 'assistant', text: 'Refreshing the token requires touching the auth middleware.' },
      ],
      stopAndAsk: {
        question: 'Rotate the token on resume, or keep it and re-issue lazily on first use?',
        gate: 'tool-permission',
      },
      cost: { tokensIn: 184_000, tokensOut: 21_000, usd: 1.12 },
    },
  ],
  gateInputs: { planApproved: true },
  cost: { tokensIn: 184_000, tokensOut: 21_000, usd: 1.12 },
  sources: [
    { kind: 'adr', label: 'ADR-0002', ref: 'docs/adr/ADR-0002-session-roles-and-lifetimes.md' },
    { kind: 'tech_debt', label: 'TD-001', ref: 'docs/tech-debt.md' },
  ],
};

// 2. Failed CI — pulled back to your turn, failing check named.
export const woFailedCi: WorkOrder = {
  id: woid('WO-1002'),
  title: 'Trim stale workspace cache',
  workspace: WORKSPACES.docket,
  mode: 'direct',
  stage: 'implementation',
  tracks: [
    {
      id: tid('wo-1002-app'),
      repo: REPOS.docketApp,
      dependsOn: [],
      stage: 'ci',
      pr: { url: 'https://github.com/eneskaradeniz/docket/pull/42', headSha: 'a1b2c3d' },
      ci: {
        kind: 'run',
        state: 'failed',
        checks: [
          { name: 'build', conclusion: 'failure' },
          { name: 'lint', conclusion: 'success' },
        ],
      },
    },
  ],
  sessions: [
    {
      role: 'implementer',
      status: 'idle',
      scope: tid('wo-1002-app'),
      transcript: [{ speaker: 'assistant', text: 'Opened PR #42; CI started.' }],
      cost: { tokensIn: 96_000, tokensOut: 12_000, usd: 0.61 },
    },
  ],
  gateInputs: { planApproved: true },
  cost: { tokensIn: 96_000, tokensOut: 12_000, usd: 0.61 },
  sources: [{ kind: 'adr', label: 'ADR-0001', ref: 'docs/adr/ADR-0001-evidence-gated-pipeline.md' }],
};

// 3. Missing evidence — a stage the operator wants to pass but cannot; primary action absent.
export const woMissingEvidence: WorkOrder = {
  id: woid('WO-1003'),
  title: 'Evidence pointer resolver',
  workspace: WORKSPACES.docket,
  mode: 'plan',
  stage: 'architect_approval',
  tracks: [
    {
      id: tid('wo-1003-app'),
      repo: REPOS.docketApp,
      dependsOn: [],
      stage: 'not_started',
      ci: { kind: 'run', state: 'running', checks: [] },
    },
  ],
  sessions: [
    {
      role: 'architect',
      status: 'idle',
      transcript: [{ speaker: 'assistant', text: 'Plan is sound; awaiting the committed plan.md to approve.' }],
      cost: { tokensIn: 142_000, tokensOut: 18_000, usd: 0.94 },
    },
  ],
  gateInputs: { planApproved: false },
  cost: { tokensIn: 142_000, tokensOut: 18_000, usd: 0.94 },
  sources: [{ kind: 'adr', label: 'ADR-0001', ref: 'docs/adr/ADR-0001-evidence-gated-pipeline.md' }],
};

// 4. Closure gate open — all tracks merged, docs not yet updated, work order still open.
export const woClosureOpen: WorkOrder = {
  id: woid('WO-1004'),
  title: 'Closure gate provenance',
  workspace: WORKSPACES.docket,
  mode: 'direct',
  stage: 'closure',
  tracks: [
    {
      id: tid('wo-1004-app'),
      repo: REPOS.docketApp,
      dependsOn: [],
      stage: 'merged',
      pr: { url: 'https://github.com/eneskaradeniz/docket/pull/39', headSha: '9f8e7d6' },
      ci: { kind: 'run', state: 'success', checks: [{ name: 'build', conclusion: 'success' }] },
      merge: { at: '2026-08-01T14:22:00Z' },
    },
  ],
  sessions: [
    {
      role: 'architect',
      status: 'idle',
      transcript: [
        { speaker: 'assistant', text: 'Tracks merged. ROADMAP and tech-debt still need the closure commit.' },
      ],
      cost: { tokensIn: 220_000, tokensOut: 26_000, usd: 1.48 },
    },
  ],
  gateInputs: { planApproved: true, verifierReport: { resolvablePointers: true } },
  cost: { tokensIn: 220_000, tokensOut: 26_000, usd: 1.48 },
  sources: [
    { kind: 'roadmap', label: 'ROADMAP', ref: 'ROADMAP.md' },
    { kind: 'tech_debt', label: 'tech-debt', ref: 'docs/tech-debt.md' },
  ],
};

// 5. Multi-track — DateApp, api + mobile, mobile depends on api; mobile's merge does not exist yet.
export const woMultitrack: WorkOrder = {
  id: woid('WO-1005'),
  title: 'Date picker shared contract',
  workspace: WORKSPACES.dateapp,
  mode: 'plan',
  stage: 'implementation',
  tracks: [
    {
      id: tid('wo-1005-api'),
      repo: REPOS.dateappApi,
      dependsOn: [],
      stage: 'ci',
      pr: { url: 'https://github.com/dateapp/api/pull/128', headSha: 'b0t1c2e' },
      ci: { kind: 'run', state: 'running', checks: [{ name: 'api-tests', conclusion: 'pending' }] },
    },
    {
      id: tid('wo-1005-mobile'),
      repo: REPOS.dateappMobile,
      dependsOn: [tid('wo-1005-api')],
      stage: 'not_started',
      ci: { kind: 'run', state: 'running', checks: [] },
    },
  ],
  sessions: [
    {
      role: 'implementer',
      status: 'idle',
      scope: tid('wo-1005-api'),
      transcript: [{ speaker: 'assistant', text: 'API contract PR open; waiting on CI.' }],
      cost: { tokensIn: 310_000, tokensOut: 39_000, usd: 2.07 },
    },
    { role: 'implementer', status: 'none', scope: tid('wo-1005-mobile'), transcript: [] },
  ],
  gateInputs: { planApproved: true },
  cost: { tokensIn: 310_000, tokensOut: 39_000, usd: 2.07 },
  sources: [{ kind: 'contract', label: 'date contract', ref: 'docs/contracts/date.md' }],
};

// 6. CI exempt — folded in as a track attribute (not a seventh work order). Hosted on a running
//    DateApp-docs work order: the docs repo has no CI, shown as an explicit exemption.
export const woRunning: WorkOrder = {
  id: woid('WO-1006'),
  title: 'Docs site search index',
  workspace: WORKSPACES.dateapp,
  mode: 'direct',
  stage: 'implementation',
  tracks: [
    {
      id: tid('wo-1006-docs'),
      repo: REPOS.dateappDocs,
      dependsOn: [],
      stage: 'implementation',
      ci: { kind: 'exempt', reason: 'No CI configured for the docs repository' },
    },
  ],
  sessions: [
    {
      role: 'implementer',
      status: 'running',
      scope: tid('wo-1006-docs'),
      transcript: [{ speaker: 'assistant', text: 'Building the search index from the markdown front-matter.' }],
      cost: { tokensIn: 73_000, tokensOut: 9_000, usd: 0.44 },
    },
  ],
  gateInputs: { planApproved: true },
  cost: { tokensIn: 73_000, tokensOut: 9_000, usd: 0.44 },
  sources: [{ kind: 'adr', label: 'ADR-0003', ref: 'docs/adr/ADR-0003-workspace-configuration-in-git.md' }],
};

export const workOrders: WorkOrder[] = [
  woStoppedAsking,
  woFailedCi,
  woMissingEvidence,
  woClosureOpen,
  woMultitrack,
  woRunning,
];

export const workOrderById: Map<WorkOrderId, WorkOrder> = new Map(workOrders.map((wo) => [wo.id, wo]));
