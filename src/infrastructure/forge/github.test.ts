// Tests for the gh CLI Forge adapter (rule P-23). The command runner is injected, so every test
// scripts its outcomes and asserts the exact commands; nothing touches the network.
import { describe, expect, it } from 'vitest';

import type { CommandResult } from '../../application/index';
import { createFakeCommandRunner, type FakeCommandRunner } from '../../application/ports/fakes/index';
import { createGhForge } from './github';

const REPO_PATH = '/workspace/hello';
const REPO = { id: 'hello', remote: 'https://github.com/octo/hello.git', defaultBranch: 'main' } as const;

const result = (exitCode: number, outputTail = ''): CommandResult => ({ exitCode, durationMs: 1, outputTail });

const scriptGhPresent = (runner: FakeCommandRunner): void => {
  runner.script('gh --version', result(0, 'gh version 2.63.0 (2025-01-01)'));
  runner.script('gh auth status', result(0));
};

describe('gh CLI Forge adapter (P-23)', () => {
  it('P-23: capabilities are probed once — gh present and authenticated enables pull requests and checks', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);

    const forge = await createGhForge(REPO_PATH, runner);
    await forge.checks(REPO, 'feature-x'); // later calls must not re-probe

    expect(forge.kind).toBe('github');
    expect(forge.capabilities).toEqual({ pullRequests: true, checks: true, issues: false });
    const probes = runner.calls().filter((call) => call.command === 'gh --version' || call.command === 'gh auth status');
    expect(probes.map((call) => call.command)).toEqual(['gh --version', 'gh auth status']);
    expect(probes[0]?.cwd).toBe(REPO_PATH);
  });

  it('P-23: a missing gh binary probes to no capabilities', async () => {
    const runner = createFakeCommandRunner();
    runner.script('gh --version', result(127, 'spawn failed: ENOENT'));

    const forge = await createGhForge(REPO_PATH, runner);

    expect(forge.capabilities).toEqual({ pullRequests: false, checks: false, issues: false });
  });

  it('P-23: an unauthenticated gh probes to no capabilities', async () => {
    const runner = createFakeCommandRunner();
    runner.script('gh --version', result(0, 'gh version 2.63.0'));
    runner.script('gh auth status', result(1, 'to get started with GitHub, run `gh auth login`'));

    const forge = await createGhForge(REPO_PATH, runner);

    expect(forge.capabilities).toEqual({ pullRequests: false, checks: false, issues: false });
  });

  it('P-23: pushBranch pushes the branch to the repo remote with prompts disabled', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`git push '${REPO.remote}' 'feature-x'`, result(0));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.pushBranch(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: true, value: undefined });
    const push = runner.calls().find((call) => call.command.startsWith('git push'));
    expect(push?.command).toBe(`git push '${REPO.remote}' 'feature-x'`);
    expect(push?.cwd).toBe(REPO_PATH);
    expect(push?.env).toEqual({ GIT_TERMINAL_PROMPT: '0' });
  });

  it('P-23: pushBranch maps an authentication failure to auth', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`git push '${REPO.remote}' 'feature-x'`, result(128, "fatal: Authentication failed for 'https://github.com/octo/hello.git'"));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.pushBranch(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'auth' });
  });

  it('P-23: pushBranch maps an unreachable host to network', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`git push '${REPO.remote}' 'feature-x'`, result(128, 'fatal: unable to access: Could not resolve host: github.com'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.pushBranch(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'network' });
  });

  it('P-23: pushBranch maps a missing remote repository to not_found', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`git push '${REPO.remote}' 'feature-x'`, result(128, 'remote: Repository not found.\nfatal: The requested repository does not exist'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.pushBranch(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'not_found' });
  });

  it('P-23: openPullRequest opens head into base and reports the created number and url', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh pr create --repo 'octo/hello' --head 'feature-x' --base 'main' --title 'Add the thing' --body 'Does the thing.'`,
      result(0, 'https://github.com/octo/hello/pull/12\n'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.openPullRequest(REPO, { head: 'feature-x', base: 'main', title: 'Add the thing', body: 'Does the thing.' });

    expect(outcome).toEqual({ ok: true, value: { number: 12, url: 'https://github.com/octo/hello/pull/12' } });
  });

  it('P-23: openPullRequest maps HTTP 429 to rate_limited', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh pr create --repo 'octo/hello' --head 'feature-x' --base 'main' --title 'T' --body 'B'`,
      result(1, 'gh: HTTP 429: Too Many Requests'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.openPullRequest(REPO, { head: 'feature-x', base: 'main', title: 'T', body: 'B' });

    expect(outcome).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('P-23: openPullRequest maps an authentication error to auth', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh pr create --repo 'octo/hello' --head 'feature-x' --base 'main' --title 'T' --body 'B'`,
      result(4, 'gh: To get started with GitHub, run `gh auth login`'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.openPullRequest(REPO, { head: 'feature-x', base: 'main', title: 'T', body: 'B' });

    expect(outcome).toEqual({ ok: false, error: 'auth' });
  });

  it('P-23: openPullRequest maps a missing resource to not_found', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh pr create --repo 'octo/hello' --head 'feature-x' --base 'main' --title 'T' --body 'B'`,
      result(1, 'gh: HTTP 404: Not Found'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.openPullRequest(REPO, { head: 'feature-x', base: 'main', title: 'T', body: 'B' });

    expect(outcome).toEqual({ ok: false, error: 'not_found' });
  });

  it('P-23: pullRequest maps gh state and mergeable values onto the port shape', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`gh pr view 12 --repo 'octo/hello' --json state,mergeable`, result(0, '{"state":"OPEN","mergeable":"MERGEABLE"}'));
    runner.script(`gh pr view 12 --repo 'octo/hello' --json state,mergeable`, result(0, '{"state":"MERGED","mergeable":"MERGEABLE"}'));
    runner.script(`gh pr view 12 --repo 'octo/hello' --json state,mergeable`, result(0, '{"state":"CLOSED","mergeable":"CONFLICTING"}'));
    runner.script(`gh pr view 12 --repo 'octo/hello' --json state,mergeable`, result(0, '{"state":"OPEN","mergeable":"UNKNOWN"}'));
    const forge = await createGhForge(REPO_PATH, runner);

    expect(await forge.pullRequest(REPO, 12)).toEqual({ ok: true, value: { state: 'open', mergeable: true } });
    expect(await forge.pullRequest(REPO, 12)).toEqual({ ok: true, value: { state: 'merged', mergeable: true } });
    expect(await forge.pullRequest(REPO, 12)).toEqual({ ok: true, value: { state: 'closed', mergeable: false } });
    expect(await forge.pullRequest(REPO, 12)).toEqual({ ok: true, value: { state: 'open' } });
  });

  it('P-23: pullRequest maps a missing pull request to not_found', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh pr view 99 --repo 'octo/hello' --json state,mergeable`,
      result(1, 'GraphQL: Could not resolve to a PullRequest with the number 99.'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.pullRequest(REPO, 99);

    expect(outcome).toEqual({ ok: false, error: 'not_found' });
  });

  it('P-23: checks map check-run statuses to CheckRun including skipped', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh api 'repos/octo/hello/commits/feature-x/check-runs?per_page=100'`,
      result(
        0,
        JSON.stringify({
          total_count: 8,
          check_runs: [
            { name: 'lint', status: 'completed', conclusion: 'success', html_url: 'https://github.com/octo/hello/actions/runs/1' },
            { name: 'build', status: 'in_progress', conclusion: null, html_url: 'https://github.com/octo/hello/actions/runs/2' },
            { name: 'docs', status: 'queued', conclusion: null, html_url: 'https://github.com/octo/hello/actions/runs/3' },
            { name: 'unit', status: 'completed', conclusion: 'failure', html_url: 'https://github.com/octo/hello/actions/runs/4' },
            { name: 'integration', status: 'completed', conclusion: 'skipped', html_url: 'https://github.com/octo/hello/actions/runs/5' },
            { name: 'cleanup', status: 'completed', conclusion: 'cancelled', html_url: 'https://github.com/octo/hello/actions/runs/6' },
            { name: 'neutral-job', status: 'completed', conclusion: 'neutral', html_url: 'https://github.com/octo/hello/actions/runs/7' },
            { name: 'stalled', status: 'completed', conclusion: 'timed_out', html_url: 'https://github.com/octo/hello/actions/runs/8' },
          ],
        }),
      ),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.checks(REPO, 'feature-x');

    expect(outcome).toEqual({
      ok: true,
      value: [
        { name: 'lint', status: 'passed', url: 'https://github.com/octo/hello/actions/runs/1' },
        { name: 'build', status: 'running', url: 'https://github.com/octo/hello/actions/runs/2' },
        { name: 'docs', status: 'queued', url: 'https://github.com/octo/hello/actions/runs/3' },
        { name: 'unit', status: 'failed', url: 'https://github.com/octo/hello/actions/runs/4' },
        { name: 'integration', status: 'skipped', url: 'https://github.com/octo/hello/actions/runs/5' },
        { name: 'cleanup', status: 'cancelled', url: 'https://github.com/octo/hello/actions/runs/6' },
        { name: 'neutral-job', status: 'skipped', url: 'https://github.com/octo/hello/actions/runs/7' },
        { name: 'stalled', status: 'failed', url: 'https://github.com/octo/hello/actions/runs/8' },
      ],
    });
  });

  it('P-23: checks map a missing ref to not_found', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`gh api 'repos/octo/hello/commits/gone/check-runs?per_page=100'`, result(1, 'gh: HTTP 404: Not Found'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.checks(REPO, 'gone');

    expect(outcome).toEqual({ ok: false, error: 'not_found' });
  });

  it('P-23: checks map a connection failure to network', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`gh api 'repos/octo/hello/commits/feature-x/check-runs?per_page=100'`, result(1, 'gh: dial tcp 140.82.121.4:443: i/o timeout'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.checks(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'network' });
  });

  it('P-23: checks map an exceeded rate limit to rate_limited', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(
      `gh api 'repos/octo/hello/commits/feature-x/check-runs?per_page=100'`,
      result(1, 'gh: API rate limit exceeded for installation ID 1234'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.checks(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'rate_limited' });
  });

  it('P-23: unparseable check-run output maps to unknown', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`gh api 'repos/octo/hello/commits/feature-x/check-runs?per_page=100'`, result(0, 'not json at all'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.checks(REPO, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'unknown' });
  });

  it('P-23: mergePullRequest merges only when explicitly called', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`gh pr merge 12 --repo 'octo/hello' --merge`, result(0, '✓ Merged pull request #12'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.mergePullRequest(REPO, 12);

    expect(outcome).toEqual({ ok: true, value: undefined });
    const merges = runner.calls().filter((call) => call.command.startsWith('gh pr merge'));
    expect(merges.map((call) => call.command)).toEqual([`gh pr merge 12 --repo 'octo/hello' --merge`]);
  });

  it('P-23: mergePullRequest maps an authentication error to auth', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`gh pr merge 12 --repo 'octo/hello' --merge`, result(4, 'gh: authentication required'));
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.mergePullRequest(REPO, 12);

    expect(outcome).toEqual({ ok: false, error: 'auth' });
  });

  it('P-23: push, open and checks never merge', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    runner.script(`git push '${REPO.remote}' 'feature-x'`, result(0));
    runner.script(
      `gh pr create --repo 'octo/hello' --head 'feature-x' --base 'main' --title 'T' --body 'B'`,
      result(0, 'https://github.com/octo/hello/pull/12\n'),
    );
    runner.script(
      `gh pr view 12 --repo 'octo/hello' --json state,mergeable`,
      result(0, '{"state":"OPEN","mergeable":"MERGEABLE"}'),
    );
    runner.script(
      `gh api 'repos/octo/hello/commits/feature-x/check-runs?per_page=100'`,
      result(0, '{"total_count":1,"check_runs":[{"name":"lint","status":"completed","conclusion":"success"}]}'),
    );
    const forge = await createGhForge(REPO_PATH, runner);

    await forge.pushBranch(REPO, 'feature-x');
    await forge.openPullRequest(REPO, { head: 'feature-x', base: 'main', title: 'T', body: 'B' });
    await forge.pullRequest(REPO, 12);
    await forge.checks(REPO, 'feature-x');

    expect(runner.calls().some((call) => call.command.includes('pr merge'))).toBe(false);
    expect(runner.calls().some((call) => call.command.includes('--auto'))).toBe(false);
  });

  it('P-23: a remote the adapter cannot read as a GitHub repository maps to unknown', async () => {
    const runner = createFakeCommandRunner();
    scriptGhPresent(runner);
    const forge = await createGhForge(REPO_PATH, runner);

    const outcome = await forge.checks({ id: 'hello', remote: 'git@gitlab.example:octo/hello.git', defaultBranch: 'main' }, 'feature-x');

    expect(outcome).toEqual({ ok: false, error: 'unknown' });
    expect(runner.calls().filter((call) => call.command.startsWith('gh api'))).toEqual([]);
  });
});
