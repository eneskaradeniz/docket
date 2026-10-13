// electron/quiet-launch.test.ts — the e2e launcher's central default for the quit confirmation:
// every suite launch answers the prompt unless a suite (managed-quit.mjs) sets its own value.
import { describe, expect, it } from 'vitest';

type Env = Record<string, string | undefined>;
interface QuietLaunch {
  readonly withQuietEnv: (env: Env) => Env;
}

const specifier = '../e2e/quiet-launch.mjs';
const { withQuietEnv } = (await import(/* @vite-ignore */ specifier)) as QuietLaunch;

describe('quiet launcher quit default', () => {
  it('U-294: every launch auto-accepts the quit prompt by default', () => {
    expect(withQuietEnv({}).DOCKET_QUIT_CONFIRM).toBe('accept');
    expect(withQuietEnv({ DOCKET_E2E_VISIBLE: '1' }).DOCKET_QUIT_CONFIRM).toBe('accept');
  });

  it('U-294: a suite that sets the switch keeps its value, an empty one included', () => {
    expect(withQuietEnv({ DOCKET_QUIT_CONFIRM: 'cancel' }).DOCKET_QUIT_CONFIRM).toBe('cancel');
    expect(withQuietEnv({ DOCKET_QUIT_CONFIRM: '' }).DOCKET_QUIT_CONFIRM).toBe('');
  });

  it('does not mutate the caller env', () => {
    const env: Env = {};
    withQuietEnv(env);
    expect(env).toEqual({});
  });
});
