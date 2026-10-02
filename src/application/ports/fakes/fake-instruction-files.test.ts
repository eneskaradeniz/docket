// In-memory InstructionFiles — the scripted per-cwd candidate files (A-1: every port has a fake).
import { describe, expect, it } from 'vitest';

import type { RepoInstructionFile } from '../../../domain/index';

import { createFakeInstructionFiles } from './fake-instruction-files';

const FILES: readonly RepoInstructionFile[] = [
  { name: 'AGENTS.md', content: 'atolye kurallari' },
  { name: 'CONTEXT.md', content: 'proje baglami' },
];

describe('createFakeInstructionFiles', () => {
  it('A-2: answers present names in the requested order and skips absent ones', async () => {
    const files = createFakeInstructionFiles({ '/worktrees/atolye': FILES });

    const read = await files.read('/worktrees/atolye', ['CONTEXT.md', 'MISSING.md', 'AGENTS.md']);
    expect(read.map((file) => file.name)).toEqual(['CONTEXT.md', 'AGENTS.md']);
    expect(read[0]?.content).toBe('proje baglami');
  });

  it('A-2: an unknown cwd or empty script answers nothing; never writes', async () => {
    const files = createFakeInstructionFiles({ '/worktrees/atolye': FILES });

    expect(await files.read('/worktrees/other', ['AGENTS.md'])).toEqual([]);
    expect(await createFakeInstructionFiles().read('/worktrees/atolye', ['AGENTS.md'])).toEqual([]);
  });

  it('A-2: read returns copies — mutating the answer leaves the script intact', async () => {
    const files = createFakeInstructionFiles({ '/worktrees/atolye': FILES });

    const read = await files.read('/worktrees/atolye', ['AGENTS.md']);
    (read[0] as { content: string }).content = 'degistirildi';
    const again = await files.read('/worktrees/atolye', ['AGENTS.md']);
    expect(again[0]?.content).toBe('atolye kurallari');
    expect(again[0]).not.toBe(read[0]);
  });
});
