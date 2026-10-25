// route-env — the environment a run rides (I-34). These tests pin the subscription seat adoption
// leaves directory-less: the machine login and the scanned default config directory
// (<home>/.claude) must both keep the config directory variable unset — on macOS the live login
// lives in the unsuffixed keychain item, which the CLI reads only while the variable is unset.
import { describe, expect, it } from 'vitest';

import { createFakeSecretVault } from '../../../../application/ports/fakes/index';
import type { AccountRecord } from '../../../../application/index';
import { parseUlid, type AccountId } from '../../../../domain/index';

import { buildRouteEnvironment } from './route-env';

const idOf = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const subscription = (overrides?: Partial<AccountRecord>): AccountRecord => ({
  id: idOf('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  provider: 'claude-code',
  label: 'main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  routeKind: 'anthropic-subscription',
  ...(overrides ?? {}),
});

describe('buildRouteEnvironment: the directory-less subscription seat', () => {
  it('a record with no identityDir (machine login or the default home) sets no config directory', async () => {
    const result = await buildRouteEnvironment(subscription(), {
      secrets: createFakeSecretVault(),
      baseEnv: { SHELL: '/bin/zsh' },
    });
    if (!result.ok) throw new Error('the route environment must build');
    expect(result.value.env).toEqual({ SHELL: '/bin/zsh', CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' });
  });

  it('a record with an identityDir still names it as the config directory', async () => {
    const result = await buildRouteEnvironment(subscription({ identityDir: '/Users/fixture/.claude-work' }), {
      secrets: createFakeSecretVault(),
      baseEnv: { SHELL: '/bin/zsh' },
    });
    if (!result.ok) throw new Error('the route environment must build');
    expect(result.value.env.CLAUDE_CONFIG_DIR).toBe('/Users/fixture/.claude-work');
  });
});
