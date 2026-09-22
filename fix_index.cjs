const fs = require('fs');
let content = fs.readFileSync('src/adapters/store/index.ts', 'utf8');

// 1. Imports
content = content.replace(
  "import type { RecordSessionInput, SessionOwner, SessionStore } from '../../core/session-store';",
  "import type { RecordSessionInput, SessionOwner, SessionStore, PendingFinding } from '../../core/session-store';"
);
content = content.replace(
  "import { parsePlanSteps } from '../../core/plan-steps';",
  "import { parsePlanSteps } from '../../core/plan-steps';\nimport { parseFindings } from '../../core/findings';"
);

// 2. recordStepReportRow
content = content.replace(
  "recordStepRow(db, workOrderId, idx, { status: 'done', reportPath });",
  `recordStepRow(db, workOrderId, idx, { status: 'done', reportPath });

  // WO-0099: Parse findings at record time and store them.
  const findings = parseFindings(body);
  if (findings.length > 0) {
    const sessionRow = db.prepare('SELECT id FROM session WHERE work_order_id = ? AND step_idx = ? ORDER BY id DESC LIMIT 1').get(workOrderId, idx) as { id: number } | undefined;
    if (sessionRow) {
      const insert = db.prepare('INSERT OR IGNORE INTO pending_finding (work_order_id, repo, pointer, problem, source_session_id, created_at) VALUES (?, ?, ?, ?, ?, ?)');
      const now = new Date().toISOString();
      for (const f of findings) insert.run(workOrderId, f.repo, f.path, f.problem, sessionRow.id, now);
    }
  }`
);

// 3. hydrateWorkOrder
content = content.replace(
  "    ...(closeable ? { closeable: true } : {}),",
  `    ...(closeable ? { closeable: true } : {}),
    pendingFindings: db.prepare('SELECT id, repo, pointer, problem, source_session_id as sourceSessionId, created_at as createdAt FROM pending_finding WHERE work_order_id = ? ORDER BY id ASC').all(id) as PendingFinding[],`
);

// 4. Store methods
content = content.replace(
  "clearRoadmapDraft: (workspaceId: WorkspaceId) => {",
  `pendingFindingsFor: (workOrderId: WorkOrderId) => {
      return db.prepare('SELECT id, repo, pointer, problem, source_session_id as sourceSessionId, created_at as createdAt FROM pending_finding WHERE work_order_id = ? ORDER BY id ASC').all(workOrderId) as PendingFinding[];
    },
    deletePendingFinding: (id: number) => {
      db.prepare('DELETE FROM pending_finding WHERE id = ?').run(id);
    },
    dismissPendingFinding: async (workOrderId: WorkOrderId, id: number) => {
      const finding = db.prepare('SELECT repo, pointer FROM pending_finding WHERE id = ?').get(id) as { repo: string; pointer: string } | undefined;
      if (finding) {
        db.prepare("INSERT INTO wo_event (work_order_id, kind, detail, at) VALUES (?, 'finding_dismissed', ?, ?)").run(
          workOrderId,
          \`\${finding.repo} — \${finding.pointer}\`,
          new Date().toISOString()
        );
      }
      db.prepare('DELETE FROM pending_finding WHERE id = ?').run(id);
    },
    consumePendingFinding: async (id: number) => {
      db.prepare('DELETE FROM pending_finding WHERE id = ?').run(id);
    },
    clearRoadmapDraft: (workspaceId: WorkspaceId) => {`
);

fs.writeFileSync('src/adapters/store/index.ts', content);
