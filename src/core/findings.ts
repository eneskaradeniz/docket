// src/core/findings.ts — pure parser for the ```bulgular fence in report.md (WO-0099).

export interface FindingSpec {
  repo: string;
  path: string;
  problem: string;
}

function lastBulgularFence(md: string): string | null {
  const re = /```bulgular\s*\n([\s\S]*?)```/g;
  let last: string | null = null;
  for (let m: RegExpExecArray | null; (m = re.exec(md));) last = m[1]!;
  return last;
}

/**
 * Parse a report's ```bulgular fence into a validated `FindingSpec[]`.
 * Returns `[]` when there is no fence, the body is not valid JSON, the JSON is not an array,
 * or ANY element fails validation (missing repo, path, or problem). Never throws, never partial.
 */
export function parseFindings(md: string): FindingSpec[] {
  const body = lastBulgularFence(md ?? '');
  if (body == null) return [];
  
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  
  if (!Array.isArray(parsed)) return [];
  
  const out: FindingSpec[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const e = parsed[i] as Record<string, unknown> | null;
    const repo = typeof e?.repo === 'string' ? e.repo.trim() : '';
    const path = typeof e?.path === 'string' ? e.path.trim() : '';
    const problem = typeof e?.problem === 'string' ? e.problem.trim() : '';
    
    // Any single bad element invalidates the whole list — all-or-nothing
    if (!repo || !path || !problem) return [];
    
    out.push({ repo, path, problem });
  }
  
  return out;
}
