import { describe, expect, it } from 'vitest';

import { parseSlug } from '../../domain/index';
import { createFakeDeps, createFakeGitProbe } from '../ports/fakes';
import { setupCopyProposal } from './setup-copy-proposal';

const project = parseSlug<'project'>('atolye');
const source = parseSlug<'repo'>('atolye');
const other = parseSlug<'repo'>('other');
if (!project.ok || !source.ok || !other.ok) throw new Error('slug');

describe('setupCopyProposal', () => {
  it('A-383: source_not_in_project when the source slug is not in the project', async () => {
    const git = createFakeGitProbe(['/tmp/new']);
    const deps = createFakeDeps({ git });
    await deps.projects.save({ id: project.value, name: 'Atölye', repos: [source.value] });
    const result = await setupCopyProposal(deps, { project: project.value, source: other.value, path: '/tmp/new' });
    expect(result).toEqual({ ok: false, error: 'source_not_in_project' });
  });

  it('A-383: not_a_git_repo when the target path is not a work tree', async () => {
    const deps = createFakeDeps();
    await deps.projects.save({ id: project.value, name: 'Atölye', repos: [source.value] });
    const result = await setupCopyProposal(deps, { project: project.value, source: source.value, path: '/tmp/nogit' });
    expect(result).toEqual({ ok: false, error: 'not_a_git_repo' });
  });
});
