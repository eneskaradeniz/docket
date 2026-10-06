// e2e/report.mjs — the structured mirror of the console audits. The layout audit, the journeys and
// the smoke write every console ok/FAIL line into e2e/.out/report.json as it is printed, so a
// reviewer can read a run without scraping terminal text. The console stays the surface the
// operator reads; the JSON is an image of it, never a second opinion — no check is invented,
// softened or hidden here.
//
// File contract (consumed by hand and by tooling — keep it exact):
//   {
//     run:      { commit: string, startedAt: ISO-8601 string },
//     checks:   [{ id, screen, size, theme, status, detail }],
//     journeys: [{ id, status, steps, detail }]
//   }
// - checks.status is 'ok' | 'FAIL' | 'skipped'. Skipped lines are recorded too, because the
//   audit's console summary counts them ("N checks, M FAIL") and the report must match its counts.
// - screen/size/theme are '' when the console line carried no such dimension (the window:,
//   titlebar-plain: and skeleton: lines); the smoke records its spec title in `screen`.
// - journeys.id is the full console title ("J-1: … [1152x720 dark]"), so an entry correlates
//   1:1 with its console line; steps are the walk's shot labels in order; detail is the error's
//   first line and sits on FAIL entries only.
//
// A reporting script resets the file when it starts, so a report is always one run's world. The
// one exception is DOCKET_REPORT_APPEND=1, which test:ui:report hands to the journeys so the
// audit's checks survive in the same file.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);
export const REPORT_PATH = join(ROOT, 'e2e', '.out', 'report.json');

const freshReport = () => ({
  run: {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    startedAt: new Date().toISOString(),
  },
  checks: [],
  journeys: [],
});

const readReport = () => {
  try {
    return JSON.parse(readFileSync(REPORT_PATH, 'utf8'));
  } catch {
    return null; // absent or torn — the caller decides what that means
  }
};

const writeReport = (report) => {
  mkdirSync(dirname(REPORT_PATH), { recursive: true });
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
};

/** Start a report for this run: fresh, unless this script was asked to append (then a missing or
 *  torn file is still started fresh — an append chain must never silently extend garbage). */
export function beginReport() {
  if (process.env.DOCKET_REPORT_APPEND === '1' && existsSync(REPORT_PATH) && readReport() !== null) {
    return;
  }
  writeReport(freshReport());
}

/** Record one console result line as a check entry. */
export function appendCheck(check) {
  const report = readReport() ?? freshReport();
  report.checks.push(check);
  writeReport(report);
}

/** Record one journey outcome. */
export function appendJourney(journey) {
  const report = readReport() ?? freshReport();
  report.journeys.push(journey);
  writeReport(report);
}
