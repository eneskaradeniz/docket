// boot-sweep wiring test — the one ordering invariant A-400 has at the composition root: the
// orphan sweep is awaited before the dispatch timer exists, so the first tick can never count a
// swept row. main.ts itself imports Electron and cannot be loaded here; the guard reads the
// wiring as text, the same discipline the spawn-registration test keeps over electron/main.ts.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

const isComment = (line: string): boolean => {
  const trimmed = line.trimStart();
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*');
};

describe('startApp boot sweep wiring', () => {
  it('A-400: the sweep is awaited before the first dispatcher tick', () => {
    if (!existsSync(MAIN)) throw new Error('electron/main.ts is gone — move this ordering guard with the wiring');
    const lines = readFileSync(MAIN, 'utf8').split('\n');
    const sweepLine = lines.findIndex((line) => !isComment(line) && line.includes('await sweepOrphanedRuns('));
    const tickLine = lines.findIndex((line) => !isComment(line) && line.includes('dispatchTimer = setInterval'));
    // Both must exist, and the sweep must be awaited (not fired and forgotten) strictly before
    // the tick timer exists — a later sweep could race the first tick into counting an orphan.
    expect(sweepLine).toBeGreaterThanOrEqual(0);
    expect(tickLine).toBeGreaterThanOrEqual(0);
    expect(sweepLine).toBeLessThan(tickLine);
  });
});
