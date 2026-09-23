# WO-0098 probe — does an injected env steer the SDK spawn?

Measured 2026-09-22 on the operator's machine, `@anthropic-ai/claude-agent-sdk` 0.3.221 (bundled CLI
2.1.221). Script: `probe.mjs` (this folder). Raw logs: `raw/*.log`: one JSON line per observation.
The logs name environment keys and paths only. They never contain a value from the environment
(no token, no key), and account email and organization are reduced to `<present>`.

The child ran under a **plain-terminal environment**: the probing session's own harness variables
(`CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_CONFIG_DIR`, …) were stripped first, so the spawn saw what
an Electron app launched from a shell sees.

## The machine's actual shape (read before the probe)

| CLI the operator runs | Where its identity lives |
|---|---|
| z.ai-GLM `claude` | `~/.claude/settings.json` has an `env` block with the base URL, the **auth token**, and the model aliases mapped to `glm-*` |
| Anthropic-Max `claude` | `CLAUDE_CONFIG_DIR=~/.claude-anthropic`, which holds the keychain OAuth login |

The shell environment carries **no** `ANTHROPIC_*` variable. The order assumed "the profile holds a
base-url var, the shell provides the token". On this machine the token is in neither place: it sits
inside a **config dir**.

## Cases and results

| case | injected | handshake / init model | result `modelUsage` key | verdict |
|---|---|---|---|---|
| h1 passthrough | — | `tokenSource: ANTHROPIC_AUTH_TOKEN`; `haiku` → `glm-5.3-flash[1m]` | (zero-token) | GLM, zero tokens |
| h2 config-max | `CLAUDE_CONFIG_DIR=~/.claude-anthropic` | `subscriptionType: Claude Max`; stock model list | (zero-token) | Max, zero tokens |
| h3 config-empty | `CLAUDE_CONFIG_DIR=<empty tmp dir>` | `tokenSource: none` | (zero-token) | **broken, detected with zero tokens** |
| d1 passthrough | — | init `glm-5.3-flash[1m]` | `glm-5.3-flash[1m]`, $0.108 | reached GLM |
| d2 config-max | `CLAUDE_CONFIG_DIR=~/.claude-anthropic` | init `claude-haiku-4-5-20251001` | `claude-haiku-4-5-20251001`, $0.018 | **reached Max** |
| d3 precedence | `ANTHROPIC_DEFAULT_HAIKU_MODEL=glm-4.5-air` (over the GLM config dir) | init `glm-5.3-flash[1m]` | `glm-5.3-flash[1m]` | **injection LOST** to settings.json `env` |
| d4 config-empty | `CLAUDE_CONFIG_DIR=<empty>` | init `claude-haiku-4-5-20251001` | none; `Not logged in · Please run /login` | fails with zero spend |

## Findings

1. **Env injection steers the spawn when it moves the config dir.** `CLAUDE_CONFIG_DIR` routes one
   `Options.env` spawn to a different login. d1 and d2 prove it with the session's own report
   (system/init `model`, the result's `modelUsage` keys), not by trust.
2. **Injection does NOT beat a config dir's own `settings.json` `env`** (d3). The settings layer
   applies over the process environment, so a profile that injects `ANTHROPIC_BASE_URL` on top of
   the GLM config dir cannot redirect it. Pointing the default config dir at z.ai by base URL alone
   also has no shell token to use. The steerable lever on this machine is the **config dir**, a
   non-secret path.
3. **A credential never needs to enter Docket.** Both backends authenticate from files the CLI
   already owns: the GLM token in `~/.claude/settings.json`, the Max OAuth in the keychain behind
   `~/.claude-anthropic`. The profile carries a PATH. The frozen "non-secret only" decision holds
   with no loss of capability.
4. **The zero-token check is truthful per profile.** The query's `initializationResult().account`
   separates the three states: `tokenSource` names an env-token setup, `subscriptionType` names a
   keychain login, and `tokenSource: 'none'` alone means not logged in. The pre-WO-0098 check
   (`startup()` + an `accountInfo` that `WarmQuery` does not have) always reported `handshake`, so
   it could not see h3's breakage.
5. **The model id is DATA per backend.** The same alias (`haiku`) resolves to `glm-5.3-flash[1m]`
   or `claude-haiku-4-5-20251001` depending on the env. The alias tiers (`modelOptions`) stay valid
   under every profile; the resolved id is what the session reports.

## What this froze (the port shapes)

- A profile = `{ name, env }` with a NON-SECRET env map (core `backend-profile.ts`). Secret-named
  keys and token-looking values are refused on write and dropped on read.
- The adapter composes `profile.env` **last**, over `process.env`. With no profile, `Options.env`
  stays unset (the built-in passthrough, byte-identical).
- `started` carries the init `model`. The session row records `backend_profile` + `reported_model`,
  which is the acceptance evidence.
- `checkProvider(env)` reads `initializationResult()` (zero tokens) → `accountVerdict`.
- The operator's GLM/Max pair on this machine is **Default (passthrough → `~/.claude` → GLM)** plus a
  **"Max" profile `CLAUDE_CONFIG_DIR=/Users/<op>/.claude-anthropic`**. That profile shape is data the
  operator types in Settings. The variable name never appears in core/ui code.
  Caveat: "passthrough" means **whatever the launching shell holds**. If `npm run dev` starts from
  a terminal that already exports `CLAUDE_CONFIG_DIR=~/.claude-anthropic`, Default is Max, and the
  GLM profile then needs `CLAUDE_CONFIG_DIR=/Users/<op>/.claude`. Naming both dirs explicitly makes
  every profile independent of the launch terminal.

## Spend

d1 $0.108 + d2 $0.018 + d3 $0.129 = **$0.255**. h1–h3 and d4 cost $0.
