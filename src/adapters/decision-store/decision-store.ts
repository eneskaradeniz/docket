// src/adapters/decision-store — the first place Docket WRITES to the decision store's working tree
// (WO-0015). Authors `order.md` into `<decisionStorePath>/docs/work-orders/WO-NNNN-<slug>/`. Docket
// does NOT commit — the operator reviews and commits, exactly as for a scaffolded `workspace.yaml`
// (ADR-0009 "Add" + its M2 addendum). No git invocation here: a working-tree write only.
//
// Lives in src/adapters (not main) so electron/main.ts stays a 1:1 IPC delegate and fs sits beside the
// store's existing gitRemote/execFileSync side-effect (boundary check permits node:fs in adapters).
// Brand-clean: no woid/tid here — those stay in the store, which calls these helpers.
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FlowMode, PermissionRule, ReviewMode } from '../../core/source';

const WORK_ORDERS_DIR = ['docs', 'work-orders'];

/** Raised when the decision-store path is not set and cannot be resolved. */
export class DecisionStoreUnavailable extends Error {
  constructor(public readonly workspaceId: string) {
    super(`No decision-store path for workspace ${workspaceId}`);
    this.name = 'DecisionStoreUnavailable';
  }
}

// Locate a work order's directory by id prefix (e.g. 'WO-0016') without storing a slug. Scans the
// work-orders dir for `${id}-*` directories — the same pattern nextWorkOrderNumber uses. First match
// wins (single-operator desktop; a duplicate prefix is the operator's authoring error).
export function findWorkOrderDir(decisionStorePath: string, id: string): string | undefined {
  const dir = join(decisionStorePath, ...WORK_ORDERS_DIR);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    if (!name.startsWith(`${id}-`)) continue;
    try {
      if (statSync(join(dir, name)).isDirectory()) return join(dir, name);
    } catch {
      continue;
    }
  }
  return undefined;
}

// Scan <decisionStorePath>/docs/work-orders/ for /^WO-(\d{4})-/ and return max+1, zero-padded to 4.
// Uses max (not count) so the real sequence continues across gaps — for the Docket workspace today the
// on-disk WO-0001..0014 yield WO-0015. No matches / missing dir → WO-0001. Single-operator desktop, so
// the TOCTOU between create and the next create is not a concern.
export function nextWorkOrderNumber(decisionStorePath: string): string {
  const dir = join(decisionStorePath, ...WORK_ORDERS_DIR);
  let max = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return 'WO-0001'; // dir absent — nothing authored yet
  }
  for (const name of entries) {
    const m = /^WO-(\d{4})-/.exec(name);
    if (!m) continue;
    // Confirm it is a directory (a stray WO-NNNN file is not a work order).
    try {
      if (!statSync(join(dir, name)).isDirectory()) continue;
    } catch {
      continue;
    }
    max = Math.max(max, Number(m[1]));
  }
  return `WO-${String(max + 1).padStart(4, '0')}`;
}

export interface OrderMdInput {
  id: string; // 'WO-0015'
  title: string;
  workspaceSlug: string; // the workspace's slug, e.g. 'docket'
  description: string; // → Objective (the architect session's first prompt)
  trackRepos: string[]; // repo slug strings (code repos only — never the decision store)
  reviewMode: ReviewMode; // → front-matter review_mode
  flowMode?: FlowMode; // → front-matter flow_mode (WO-0045); emitted only when 'manual' — silence IS auto
  contextFiles: string[]; // local file paths → Context
  permissionRule?: PermissionRule; // → front-matter permission_rule (WO-0031c); the WO carries its own rule
}

// Compose the order.md body. Follows docs/work-orders/TEMPLATE.md + the WO-0013/0014 front-matter
// convention. `review_mode` is new (distinct from `mode` plan|direct and the `review` cadence key);
// WO-0016's architect runtime reads it. Document text lives in git, not the DB (ADR-0010 rule 1).
export function buildOrderMd(input: OrderMdInput): string {
  const tracks = input.trackRepos.length
    ? input.trackRepos.map((r) => `  - repo: ${r}\n    depends_on: []`).join('\n')
    : '  []';
  const context =
    input.contextFiles.length > 0
      ? input.contextFiles.map((p) => `- ${p}`).join('\n')
      : '- _(added during planning)_';
  const objective = input.description.trim() || '_(describe the objective — this becomes the architect session’s first prompt)_';
  return `---
id: ${input.id}
title: ${input.title}
workspace: ${input.workspaceSlug}
status: draft
mode: plan
review: light
review_mode: ${input.reviewMode}
${input.flowMode === 'manual' ? `flow_mode: manual\n` : ''}${input.permissionRule ? `permission_rule: ${input.permissionRule}\n` : ''}tracks:
${tracks}
---

# ${input.id} — ${input.title}

## Objective

${objective}

## Context

${context}

## Scope

In scope:
-

Out of scope:
-

## Acceptance criteria

1.

## Evidence required

- plan_approval: architect verdict, \`plan.md\` committed
- pr_open: PR URL, head sha
- ci_green: all required checks \`success\`
- verification: verifier report, all \`path:line\` pointers resolve at head sha
- closure: all tracks merged, \`ROADMAP.md\` + \`docs/tech-debt.md\` updated (commit sha)

## Notes

Created via Docket.
`;
}

// mkdir -p the WO dir and write order.md. Returns the written path. No git. The operator commits.
export function writeOrderMd(decisionStorePath: string, id: string, slug: string, body: string): string {
  const dir = join(decisionStorePath, ...WORK_ORDERS_DIR, `${id}-${slug}`);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'order.md');
  writeFileSync(path, body, 'utf8');
  return path;
}

// Write plan.md into the WO's existing directory (discovered by id, not slug — robust to title edits).
// On approval the architect's proposed plan lands here; Docket does not commit. Returns the written path,
// or throws if the WO dir is missing (order.md must exist first).
export function writePlanMdById(decisionStorePath: string, id: string, body: string): string {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) throw new Error(`writePlanMdById: no work-order directory for ${id}`);
  const path = join(dir, 'plan.md');
  writeFileSync(path, body, 'utf8');
  return path;
}

// Overwrite order.md in the WO's EXISTING directory (discovered by id — WO-0025 closure note append).
// The caller supplies the full body (front matter preserved by the reader); throws if the dir is missing.
export function writeOrderMdById(decisionStorePath: string, id: string, body: string): string {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) throw new Error(`writeOrderMdById: no work-order directory for ${id}`);
  const path = join(dir, 'order.md');
  writeFileSync(path, body, 'utf8');
  return path;
}

// Read order.md + plan.md from the WO's directory. Missing dir or file → '' for that doc. No git; reads
// the working tree at view time (ADR-0010 — document text is never stored in the DB).
export function readWoDocs(decisionStorePath: string, id: string): { order: string; plan: string } {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) return { order: '', plan: '' };
  const read = (name: string): string => {
    try {
      return readFileSync(join(dir, name), 'utf8');
    } catch {
      return '';
    }
  };
  return { order: read('order.md'), plan: read('plan.md') };
}

// Write a step's report into the WO's reports/ dir (WO-0017). Docket writes this server-side at turn_complete
// — the agent does NOT write its own report (mirrors writePlanMdById; the fence is never involved). No commit;
// the operator commits reports alongside plan.md. Returns the path relative to the WO dir
// ("reports/step-NN-<role>.md") so the store records a pointer, not an absolute path (ADR-0001).
export function writeStepReport(decisionStorePath: string, id: string, idx: number, role: string, body: string): string {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) throw new Error(`writeStepReport: no work-order directory for ${id}`);
  const reportsDir = join(dir, 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const name = `step-${String(idx).padStart(2, '0')}-${role}.md`;
  writeFileSync(join(reportsDir, name), body, 'utf8');
  return `reports/${name}`;
}

// Read one step report from the WO's reports/ dir (WO-0017). Lazy per-step read at view time (ADR-0010 — the
// report text lives in git, not the DB). Missing dir/file → ''.
export function readStepReport(decisionStorePath: string, id: string, idx: number, role: string): string {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) return '';
  try {
    return readFileSync(join(dir, 'reports', `step-${String(idx).padStart(2, '0')}-${role}.md`), 'utf8');
  } catch {
    return '';
  }
}

// Write the architect's verdict for a step into the WO's verdicts/ dir (WO-0020). Docket writes this server-side
// from the captured review result — the agent does NOT write its own verdict (mirrors writeStepReport). No
// commit. Returns the path relative to the WO dir ("verdicts/step-NN.md") for the DB pointer (ADR-0001).
export function writeStepVerdict(decisionStorePath: string, id: string, idx: number, body: string): string {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) throw new Error(`writeStepVerdict: no work-order directory for ${id}`);
  const verdictsDir = join(dir, 'verdicts');
  mkdirSync(verdictsDir, { recursive: true });
  const name = `step-${String(idx).padStart(2, '0')}.md`;
  writeFileSync(join(verdictsDir, name), body, 'utf8');
  return `verdicts/${name}`;
}

// Read a step verdict from the WO's verdicts/ dir (WO-0020). Lazy per-step read at view time (ADR-0010). '' if
// absent (step not yet reviewed).
export function readStepVerdict(decisionStorePath: string, id: string, idx: number): string {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) return '';
  try {
    return readFileSync(join(dir, 'verdicts', `step-${String(idx).padStart(2, '0')}.md`), 'utf8');
  } catch {
    return '';
  }
}

// Remove a work order's whole directory (order.md/plan.md/reports) by id (WO-0020). No-op if absent. A
// working-tree delete only — Docket does NOT commit the removal (the operator commits), mirroring the
// authoring helpers. Idempotent (force + recursive).
export function removeWorkOrderDir(decisionStorePath: string, id: string): void {
  const dir = findWorkOrderDir(decisionStorePath, id);
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
}
