// src/adapters/decision-store — the first place Docket WRITES to the decision store's working tree
// (WO-0015). Authors `order.md` into `<decisionStorePath>/docs/work-orders/WO-NNNN-<slug>/`. Docket
// does NOT commit — the operator reviews and commits, exactly as for a scaffolded `workspace.yaml`
// (ADR-0009 "Add" + its M2 addendum). No git invocation here: a working-tree write only.
//
// Lives in src/adapters (not main) so electron/main.ts stays a 1:1 IPC delegate and fs sits beside the
// store's existing gitRemote/execFileSync side-effect (boundary check permits node:fs in adapters).
// Brand-clean: no woid/tid here — those stay in the store, which calls these helpers.
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const WORK_ORDERS_DIR = ['docs', 'work-orders'];

export type ReviewMode = 'gates' | 'every-step';

/** Raised when the decision-store path is not set and cannot be resolved. */
export class DecisionStoreUnavailable extends Error {
  constructor(public readonly workspaceId: string) {
    super(`No decision-store path for workspace ${workspaceId}`);
    this.name = 'DecisionStoreUnavailable';
  }
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
  contextFiles: string[]; // local file paths → Context
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
tracks:
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
