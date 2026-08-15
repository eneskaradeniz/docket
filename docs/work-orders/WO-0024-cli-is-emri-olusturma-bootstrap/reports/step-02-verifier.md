## WO-0024 Step 2 — Verifier Report (tests · boundaries · sandbox E2E)

**Verdict: PASS.** All gates green, boundary discipline held under reading + CI, and the sandbox proves the TD-032 objective — a workspace and a work order born entirely via CLI, `order.md` in the decision store, GUI never opened.

### What was checked

- **Code under test** — `src/cli/create.ts` (pure mappers, 187 lines), `src/cli/index.ts` handlers/wiring, `src/cli/__tests__/create.test.ts` (34 tests), plus closure docs (`ROADMAP.md`, `docs/tech-debt.md` TD-032).
- **Purity spot-audit** — `create.ts:12` is a type-only import from `core/source`; no Node builtin, no branded constructor (`rid`/`wid`/`woid` live only in `index.ts:143-193`, the widened composition root — `scripts/check-boundaries.mjs:27`).
- **Sandbox** — fresh db + temp git repos at `/tmp/wo0024-verify.3Dub`; every command run by hand with rc captured.

### Gates

| Check | Result | Evidence |
|---|---|---|
| `npm test` | ✅ 377/377 (34 new; 343 pre-WO) | suite output; `create.test.ts` alone: 34/34 |
| `npm run typecheck` (both tsconfigs) | ✅ clean | no output |
| `npm run build` | ✅ clean | vite + electron builds |
| `npm run check:boundaries` | ✅ 8/8 clean | incl. branded-constructors, adapter-imports, vendor-names |
| New dependencies | ✅ none | `git status`: `package.json` untouched |
| Closure docs | ✅ | TD-032 bootstrap half marked paid, `--policy ask` half honestly kept open; ROADMAP WO-0024 second-pass entry |

### Sandbox end-to-end

| Scenario | Result |
|---|---|
| `create-workspace` against a **non-existent** `--db` | ✅ rc 0 — db created + migrated (86 KB); guard exempted (`index.ts:279`) |
| `create-work-order` `--workspace` by **label** and by **id** | ✅ rc 0 both (`"Deneme WS"` → `deneme-ws`; `coklu`) |
| `order.md` in decision store | ✅ `repo/docs/work-orders/WO-0001-sandbox-deneme/order.md`, GUI-shaped: `review_mode: gates`, `tracks: repo`, description → Objective |
| `ls` / `show WO-0001` | ✅ rc 0, listed + shown |
| Multi-repo ws (`app`+`docs`, `--decision-store docs`), default tracks | ✅ decision store excluded → `tracks: app` (PRODUCT §Decisions 6) |
| Usage errors → rc 2 | ✅ missing/blank `--label`, `--decision-store` not among repos, blank `--title`, invalid `--review-mode` (names both values), unknown command (stderr + help, `index.ts:304`), `create-work-order` on missing db |
| Runtime errors → rc 1 | ✅ unknown workspace (lists known), unknown track (lists valid), decision-store-as-track (explains why) |
| `help` → rc 0, both commands documented | ✅ |

### Findings (non-blocking)

1. **Pre-existing store bug, newly reachable headlessly**: the *second* workspace in one db cannot create its first WO — `✗ Error: UNIQUE constraint failed: work_order.id`, rc 1. `nextWorkOrderNumber` (`src/adapters/decision-store/decision-store.ts:49`, born WO-0015 `c28e2f8`) numbers per decision-store dir (empty → `WO-0001`) while `work_order.id` is UNIQUE db-wide; `store/index.ts:645-666` also writes `order.md` before the insert, leaving an orphaned `WO-0001-…` dir on failure. Out of WO-0024's declared scope (“store/port katmanlarına dokunma”); the GUI hits it through the same port. **Recommend a tech-debt entry.**
2. **Minor polish**: that runtime failure surfaces as a raw SQLite message — usage errors are exemplary, but this one misses WO item 3's "anlaşılır mesaj" spirit (same root as #1).
3. **Cosmetic**: `error: No such remote 'origin'` leaks to stderr on `create-workspace` for remote-less repos — pre-existing `gitRemote` best-effort probe in the store adapter.

Sandbox artifacts left at `/tmp/wo0024-verify.3Dub` for inspection.