const fs = require('fs');
let content = fs.readFileSync('src/adapters/store/index.ts', 'utf8');

// Fix 1: as unknown as PendingFinding[]
content = content.replace(
  "all(id) as PendingFinding[],",
  "all(id) as unknown as PendingFinding[],"
);
content = content.replace(
  "all(workOrderId) as PendingFinding[];",
  "all(workOrderId) as unknown as PendingFinding[];"
);

// Fix 2: Duplicate findings. I'll just regex remove the second block if it exists.
let found = 0;
content = content.replace(/  \/\/ WO-0099: Parse findings at record time and store them\.\n  const findings = parseFindings\(body\);\n  if \(findings\.length > 0\) \{\n    const sessionRow = db\.prepare\('SELECT id FROM session WHERE work_order_id = \? AND step_idx = \? ORDER BY id DESC LIMIT 1'\)\.get\(workOrderId, idx\) as \{ id: number \} \| undefined;\n    if \(sessionRow\) \{\n      const insert = db\.prepare\('INSERT OR IGNORE INTO pending_finding \(work_order_id, repo, pointer, problem, source_session_id, created_at\) VALUES \(\?, \?, \?, \?, \?, \?\)'\);\n      const now = new Date\(\)\.toISOString\(\);\n      for \(const f of findings\) insert\.run\(workOrderId, f\.repo, f\.path, f\.problem, sessionRow\.id, now\);\n    \}\n  \}\n/g, (match) => {
  found++;
  if (found === 1) return match; // keep the first one
  return ''; // remove the second one
});

fs.writeFileSync('src/adapters/store/index.ts', content);
