// compose/instruction-files.test.ts — the real InstructionFiles adapter: the scanner's limits at
// the worktree root, reads only, absent names skipped (P-37's port comment).
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodeInstructionFiles } from './instruction-files';

let scratch = '';

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-instruction-files-'));
});

afterEach(async () => {
  await rm(scratch, { recursive: true, force: true });
});

describe('createNodeInstructionFiles', () => {
  it('reads the present names in caller order and skips absent ones', async () => {
    await writeFile(join(scratch, 'AGENTS.md'), 'guide', 'utf8');
    await writeFile(join(scratch, 'CLAUDE.md'), 'rules', 'utf8');

    const files = await createNodeInstructionFiles().read(scratch, ['CLAUDE.md', 'MISSING.md', 'AGENTS.md']);

    expect(files).toEqual([
      { name: 'CLAUDE.md', content: 'rules' },
      { name: 'AGENTS.md', content: 'guide' },
    ]);
  });

  it('skips a file over 1 MiB and a file with a NUL byte in the first 8 KiB', async () => {
    await writeFile(join(scratch, 'huge.md'), 'x'.repeat(1_048_577), 'utf8');
    await writeFile(join(scratch, 'nul-early.md'), `a\n\u0000\n${'b'.repeat(100)}`, 'utf8');
    await writeFile(join(scratch, 'nul-late.md'), `${'c'.repeat(9_000)}\u0000tail`, 'utf8');

    const files = await createNodeInstructionFiles().read(scratch, ['huge.md', 'nul-early.md', 'nul-late.md']);

    // The scanner's limits: size over 1 MiB and a NUL in the first 8 KiB are skipped; a NUL past
    // the first 8 KiB is not the binary-file signal.
    expect(files.map((file) => file.name)).toEqual(['nul-late.md']);
  });

  it('skips a name that is a directory, and never writes anything', async () => {
    await mkdir(join(scratch, 'AGENTS.md.d'), { recursive: true });
    await writeFile(join(scratch, 'AGENTS.md'), 'guide', 'utf8');
    const before = (await readdir(scratch)).sort();

    const files = await createNodeInstructionFiles().read(scratch, ['AGENTS.md.d', 'AGENTS.md']);

    expect(files).toEqual([{ name: 'AGENTS.md', content: 'guide' }]);
    expect((await readdir(scratch)).sort()).toEqual(before);
  });

  it('A-54: a name that exists only through case-insensitive aliasing is skipped like an absent name', async () => {
    await writeFile(join(scratch, 'AGENTS.md'), 'guide', 'utf8');

    const files = await createNodeInstructionFiles().read(scratch, ['AGENTS.md', 'Agents.md', 'MISSING.md']);

    // On a case-insensitive filesystem `Agents.md` stats through to the real `AGENTS.md`; only the
    // exact-case spelling counts as present, so the variant and the absent name are both skipped.
    expect(files).toEqual([{ name: 'AGENTS.md', content: 'guide' }]);
  });

  it('A-54: exact-case variants that truly exist are all returned', async () => {
    await writeFile(join(scratch, 'AGENTS.md'), 'upper', 'utf8');
    await writeFile(join(scratch, 'Agents.md'), 'mixed', 'utf8');
    const listing = await readdir(scratch);

    const files = await createNodeInstructionFiles().read(scratch, ['AGENTS.md', 'Agents.md']);

    // A case-sensitive filesystem keeps both spellings and returns both; a case-insensitive one
    // folded the second write into the first file, whose directory entry keeps its original case.
    // Either way the answer is the same rule: the names the listing spells exactly.
    expect(files.map((file) => file.name)).toEqual(['AGENTS.md', 'Agents.md'].filter((name) => listing.includes(name)));
    for (const file of files) expect(file.content.length).toBeGreaterThan(0);
  });

  it('A-54: a nested name checks the listing of its own parent directory', async () => {
    await mkdir(join(scratch, 'rules'), { recursive: true });
    await writeFile(join(scratch, 'rules', 'AGENTS.md'), 'nested', 'utf8');

    const files = await createNodeInstructionFiles().read(scratch, ['rules/AGENTS.md', 'rules/agents.md', 'AGENTS.md']);

    // The nested exact-case name is present; its case variant is only an alias, and the root name
    // is absent outright.
    expect(files).toEqual([{ name: 'rules/AGENTS.md', content: 'nested' }]);
  });
});
