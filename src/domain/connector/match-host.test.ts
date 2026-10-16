import { describe, expect, it } from 'vitest';
import type { ConnectorId } from '../shared';
import { matchConnectorHost, type ConnectorManifest } from './manifest';

const onHosts = (hostMatch: readonly string[]): ConnectorManifest => ({
  id: 'github' as ConnectorId,
  name: 'GitHub',
  version: '1.2.3',
  apiVersion: 1,
  provides: ['forge'],
  hostMatch,
  network: ['api.github.com'],
  settings: [],
});

describe('matchConnectorHost', () => {
  it('R-183: matches an https remote with and without a trailing .git', () => {
    const m = onHosts(['github.com']);
    expect(matchConnectorHost(m, 'https://github.com/docket/repo.git')).toBe(true);
    expect(matchConnectorHost(m, 'https://github.com/docket/repo')).toBe(true);
  });

  it('R-183: strips userinfo and port from https and ssh remotes', () => {
    const m = onHosts(['github.com']);
    expect(matchConnectorHost(m, 'https://user:token@github.com/docket/repo.git')).toBe(true);
    expect(matchConnectorHost(m, 'https://github.com:443/docket/repo.git')).toBe(true);
    expect(matchConnectorHost(m, 'ssh://git@github.com:22/docket/repo.git')).toBe(true);
    expect(matchConnectorHost(m, 'ssh://git@github.com/docket/repo.git')).toBe(true);
  });

  it('R-183: matches scp-like remotes', () => {
    const m = onHosts(['github.com']);
    expect(matchConnectorHost(m, 'git@github.com:docket/repo.git')).toBe(true);
    expect(matchConnectorHost(m, 'github.com:docket/repo.git')).toBe(true);
  });

  it('R-183: compares hosts case-insensitively', () => {
    expect(matchConnectorHost(onHosts(['github.com']), 'https://GitHub.COM/docket/repo.git')).toBe(true);
    expect(matchConnectorHost(onHosts(['GitHub.Com']), 'https://github.com/docket/repo.git')).toBe(true);
    expect(matchConnectorHost(onHosts(['*.GitHub.com']), 'git@Gist.GitHub.COM:docket/repo.git')).toBe(true);
  });

  it('R-183: never matches on a non-label boundary', () => {
    const m = onHosts(['github.com']);
    expect(matchConnectorHost(m, 'https://evil-github.com/owner/repo')).toBe(false);
    expect(matchConnectorHost(m, 'https://github.com.evil.io/owner/repo')).toBe(false);
    // A bare entry never covers subdomains either.
    expect(matchConnectorHost(m, 'https://gist.github.com/owner/repo')).toBe(false);
  });

  it('R-183: matches *.host suffix entries on subdomains only', () => {
    const m = onHosts(['*.github.com']);
    expect(matchConnectorHost(m, 'https://gist.github.com/owner/repo')).toBe(true);
    expect(matchConnectorHost(m, 'git@github.com:owner/repo.git')).toBe(false);
    expect(matchConnectorHost(m, 'https://api.github.com.evil.io/owner/repo')).toBe(false);
    // A look-alike label never satisfies the dot boundary the suffix requires.
    expect(matchConnectorHost(onHosts(['*.github.com']), 'https://x.gist-github.com/owner/repo')).toBe(false);
  });

  it('R-183: answers false for an unparsable or hostless remote', () => {
    const m = onHosts(['github.com']);
    for (const remote of ['not a remote', 'file:///tmp/repo', '/local/path', '../repo', 'https:///no-host', '']) {
      expect(matchConnectorHost(m, remote)).toBe(false);
    }
  });

  it('R-183: answers false when hostMatch is empty', () => {
    expect(matchConnectorHost(onHosts([]), 'https://github.com/docket/repo.git')).toBe(false);
  });
});
