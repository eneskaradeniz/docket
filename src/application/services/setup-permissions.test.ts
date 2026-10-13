import { describe, expect, it } from 'vitest';

import { redactSecretShapes } from '../../domain/index';

import {
  decideRead,
  isPathInside,
  isSecretShapedPath,
  normalizeAbsolutePath,
  SetupReadGrants,
  type ReadContext,
  type ReadScope,
} from './setup-permissions';

const HOME = '/Users/op/.docket';
const REPO = '/Users/op/work/acme';
const CTX: ReadContext = { repoFolder: REPO, docketHome: HOME };
const SCOPE: ReadScope = { paths: [REPO, HOME], sessionOnly: true };

describe('setup permissions', () => {
  it('A-334: decideRead allows paths within repoFolder and ~/.docket; asks for other paths; grants never wider than requested', () => {
    const grants = new SetupReadGrants();
    expect(decideRead(SCOPE, `${REPO}/src/index.ts`, CTX, grants).kind).toBe('allow');
    expect(decideRead(SCOPE, `${HOME}/library/roles/dev/v1.yaml`, CTX, grants).kind).toBe('allow');
    expect(decideRead(SCOPE, `${REPO}/../other/file.ts`, CTX, grants, normalizeAbsolutePath('/Users/op/work/other/file.ts')).kind).toBe(
      'ask',
    );
    const outside = decideRead(SCOPE, '/etc/hosts', CTX, grants);
    expect(outside).toEqual({ kind: 'ask', path: '/etc/hosts' });

    grants.grant('/tmp/one-file.txt');
    expect(grants.list()).toEqual(['/tmp/one-file.txt']);
    expect(decideRead(SCOPE, '/tmp/one-file.txt', CTX, grants).kind).toBe('allow');
    expect(decideRead(SCOPE, '/tmp/other.txt', CTX, grants).kind).toBe('ask');
    grants.grant(`${REPO}/extra`);
    expect(decideRead(SCOPE, `${REPO}/extra/nested/readme.md`, CTX, grants).kind).toBe('allow');
    expect(decideRead(SCOPE, `${REPO}/extra`, CTX, grants).kind).toBe('allow');
    expect(decideRead(SCOPE, REPO, CTX, grants).kind).toBe('allow');
  });

  it('A-335: path grants are session-only in memory, never persisted to disk, and read-only', () => {
    const grants = new SetupReadGrants();
    grants.grant('/tmp/granted');
    expect(grants.list()).toEqual(['/tmp/granted']);
    grants.clear();
    expect(grants.list()).toEqual([]);
    expect(grants.allows('/tmp/granted')).toBe(false);
  });

  it('A-336: secret-shaped paths denied unconditionally; content read redacted through shared secret redaction', () => {
    expect(isSecretShapedPath(`${REPO}/.env`, CTX)).toBe(true);
    expect(isSecretShapedPath(`${REPO}/secrets/id_rsa_test`, CTX)).toBe(true);
    expect(isSecretShapedPath(`${HOME}/.ssh/config`, CTX)).toBe(true);
    expect(isSecretShapedPath(`${HOME}/docket.db`, CTX)).toBe(true);
    expect(decideRead(SCOPE, `${REPO}/.env`, CTX, new SetupReadGrants())).toEqual({ kind: 'deny', reason: 'secret_shaped' });
    const grants = new SetupReadGrants();
    grants.grant(`${REPO}/.env`);
    expect(decideRead(SCOPE, `${REPO}/.env`, CTX, grants)).toEqual({ kind: 'deny', reason: 'secret_shaped' });
    expect(redactSecretShapes('sk-abcdefghijklmnopqrstuvwxyz123456')).toContain('[redacted]');
    expect(isPathInside(`${REPO}/src`, REPO)).toBe(true);
    expect(normalizeAbsolutePath(`${REPO}/./src/../lib`)).toBe(`${REPO}/lib`);
  });
});
