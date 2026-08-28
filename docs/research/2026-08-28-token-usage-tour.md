# Token usage tour — 2026-08-28

A measurement + findings tour (not a work order; no product code changed). Question: **where do
tokens burn in a Docket drive?** Consumers of the findings: the optimization work orders, the
usage screen (queue item 4), the limit screen (queue item 3).

Everything below is reproducible: `npx tsx docs/probes/token-tour/measure.ts` (S1–S3b). Sources:
the dogfood DB (`~/Library/Application Support/docket/docket.db`, the base-mobile WO-0001 pilot)
+ the WO-0038 incident backup (2 more sessions) + the cc-surface probe logs + byte-exact offline
re-assembly of every first prompt through `src/core`'s own pure builders. Figures marked **est**
are chars/4 estimates, not tokenizer counts; unmarked token/USD figures are provider-reported.

## TL;DR — the five answers

1. **The biggest "prompt" is not Docket's.** A drive's fixed per-turn overhead in this ambient
   environment is **~46k tokens** (system tools 15.8k + MCP tools 20.0k + custom agents 6.1k +
   skills 3.4k + memory 0.8k — real, from the cc-surface c1 probe's captured
   `getContextUsage().categories`). Docket's largest first-prompt skeleton is **~0.5–1k tokens**.
2. **Input dominates output ~5:1** and the implementer step drives dominate spend (75% of the
   pilot's $17.65). But Docket's `tokens_in` counts only **fresh** input — cache reads (the real
   mass of a long drive) are dropped at the adapter, so the in/out picture is systematically
   skewed and the true per-turn context mass is invisible.
3. **The stored transcript is 70–80% tool results**, and the 200-char `blockSummary` cap has a
   hole: string-content results bypass it — 184 results / 331 KB of full file contents and Bash
   outputs live in the checkpoint rows (and re-render in the UI).
4. **Prompt assembly itself is cheap** (~1–2k tokens per first prompt, even the 92-path ✦ draft
   union) — but the ✦ **read mass behind the union is not**: docket's default source set (92
   docs, ALL included by default) is 784 KB ≈ **~201k tokens est** — a standard 200k window
   cannot hold it; only the [1m] model can.
5. **Resume sends one new message; the provider replays the context server-side** (probe c2:
   cache_read 91,008 → 100,608 across the leg boundary). Resume cost is dominated by the
   context re-read, which Docket cannot see or price because cache metrics are dropped.

## S1 — where the money went (pilot: base-mobile WO-0001)

| # | role | stage | tokens in | out | usd | wall | transcript |
|---|------|-------|-----------|-----|-----|------|-----------|
| 1 | architect | plan | 25,896 | 6,486 | $0.81 | 2.6m | 29 KB |
| 2 | implementer | step 1 | **252,988** | 60,934 | **$13.17** | 32.8m | 326 KB |
| 3 | architect | step-1 verdict | 107,233 | 8,208 | $1.27 | 3.8m | 50 KB |
| 4 | verifier | step 2 | 80,703 | 9,841 | $1.12 | 46.9m | 66 KB |
| 5 | architect | step-2 verdict | 35,815 | 12,159 | $1.29 | 5.1m | 63 KB |

Totals: **502,635 in / 97,628 out / $17.65**. By role: implementer 75%, architect 19%, verifier
6%. The WO-0038 backup adds a 2026-08-2x plan drive ($2.08, 113.9k in) and one interrupted
implementer leg recorded as **$0.00 / 0 tokens — the honest-zero interrupt case: spend exists,
Docket lost it** (abort precedes the result message).

Caveats: wall-clock-derived tok/min is poisoned by idle (session 4's 47m spans a stop/restart at
00:53 per the wo_event ledger — its 1.9k tok/min is not a throughput figure). USD is the
provider's own `total_cost_usd`; Docket has no price table.

## S2 — the checkpoint's composition (transcript bloat)

Every stored transcript is 70–80% `tool_result` bytes, 13–27% `tool_use`, 3–11% assistant text.

| tool | results | stored bytes | est tokens |
|------|---------|--------------|-----------|
| Bash | 247 | **237 KB** | ~59k |
| Read | 38 | **110 KB** | ~28k |
| everything else (MCP image, Task*, Write, Edit…) | ~25 | ~2 KB | ~0.5k |

- **Cap bypass**: `blockSummary` (`src/adapters/runner/index.ts:140-149`) slices array content to
  200 chars but returns string content **uncapped** — 184 results totalling **331 KB** of whole
  file bodies (`Read` outputs, full `git diff`s, `git status` listings) are persisted verbatim.
- Largest single stored results: an 18.9 KB Dart file read, a 10.2 KB tech-debt diff, a 7.7 KB
  status listing of PNGs.
- This is "checkpoint şişmesi" as measured: the checkpoint (and the Ray cards that re-seed from
  it) carries full file bodies whose only consumer is human browsing.

## S3 — prompt assembly (offline, byte-exact)

Re-assembled through the real builders (`architectPrompt`, `implementerPrompt`, `verifierPrompt`,
`architectReviewPrompt`, `roadmapDraftPrompt`) with the pilot's real order.md/plan.md and docket's
real 92-doc union:

| first prompt | size | composition |
|--------------|------|-------------|
| architect plan | 2,742 ch (~686 tok est) | skeleton 1,864 + objective inline |
| implementer step N | 3,836 ch (~959 tok est) | skeleton + objective + **full plan.md** (2,435 ch) |
| verifier step N | 3,869 ch (~967 tok est) | same embed shape |
| review step N | 4,145 ch (~1,036 tok est) | skeleton + objective + full plan.md (report stays a PATH) |
| ✦ draft (docket, 92 paths) | 8,295 ch (~2,074 tok est) | skeleton + goal + 92-path union (union alone 4,966 ch) |

- No truncation exists on any component (objective, full plan.md, goal note, union — all
  verbatim). plan.md is re-embedded **once per step drive + once per review** → 4× for a 2-step
  WO (~2.4k tok est at pilot scale; the pattern scales with plan size — a 35 KB plan.md already
  exists in this repo's own history and would re-embed ~9k tok est per drive).
- **✦ read mass (the real WO-0051 question)**: the dialog's default source set includes ALL
  structure-root docs — at docket scale 92 files / 784 KB ≈ **~201k tokens est** of reading the
  prompt instructs the architect to do before drafting. That fits only the 1M [1m] window; on a
  200k-window model the instructed reading cannot complete. The top of the tail: three 35–39 KB
  WO order/plan files + findings.md + tech-debt.md.
- The prompt carrying **paths not contents** (the WO-0051 design) is confirmed working as
  designed — the burn is not in the prompt, it is in the reading the prompt licenses.

## S4 — resume cost (analytic; no real resume exists in the data)

Mechanics (code + probe c2): Sürdür sends **one new user message** and sets `options.resume`;
the provider replays the whole session server-side. Measured at the c2 leg boundary:
`cache_read` 91,008 → 100,608 (the resumed leg re-reads the prior context, mostly cache hits)
and `total_cost_usd` resets per leg (Docket's `prior + input` accumulation handles it correctly).

Model: **resume cost ≈ re-read of the full context (cache-priced) + one fresh turn**. For each
pilot session the re-read mass ≈ fixed overhead (~46k) + accumulated conversation — exactly the
number Docket cannot see, because cache reads are dropped. Orders of magnitude (est): resuming
session 2 at its end re-reads on the order of ~135–170k tokens; sessions 1/3/5 on the order of
~55–70k. Pricing depends entirely on cache-hit ratio, which is unmeasured — the honest statement
is the model plus this gap, not a dollar figure.

## S5 — instrumentation gaps (SDK provides → Docket drops)

| metric | SDK surface | Docket today | who needs it |
|--------|-------------|--------------|--------------|
| `cache_read_input_tokens` / `cache_creation_input_tokens` | result.usage, getContextUsage().apiUsage | dropped | usage screen, resume pricing, any "true input" claim |
| context fill history (`usedTokens/maxTokens/%`) | live getContextUsage | live-only, never persisted | usage screen, fill-over-time |
| per-category context split (system/tools/MCP/agents/skills/messages) | getContextUsage().categories | dropped (probe proves it's there) | usage screen "where is my context" breakdown |
| `modelUsage` (per-model cost/tokens) + `model` | result | dropped | usage screen (model split), pricing honesty |
| `num_turns`, `duration_ms` / `duration_api_ms` | result | dropped (Docket re-derives wall time) | usage screen, turn economics |
| rate-limit windows / 429 counters | `usage_EXPERIMENTAL` session controls | never called | **limit screen (queue item 3)** |
| interrupted-drive spend | abort precedes result | honest zeros (measured: the $0.00 leg) | cost honesty, usage screen |
| per-turn / per-leg cost rows | result per turn | collapsed to one session total | usage screen curves, steer economics |

Operational note: **no budget threshold is configured on this machine** (`app_setting` has no
`budget:*` key) — the WO-0047 gate is currently fail-open here. Not a bug; an operator setting.

## Candidate work orders (one-liners; not opened)

1. **Draft source-set budget** — the ✦ default "all docs included" implies ~201k tok est of
   reading at docket scale; cap or curate the default (byte budget / top-level only) and show
   the mass at the dialog. (Finding S3.)
2. **Usage instrumentation floor** — persist cache read/creation, modelUsage, num_turns,
   durations, per-turn rows; the usage screen is unbuildable honestly without this. (S5.)
3. **context_usage persistence** — the event already flows live; fold snapshots into the session
   row. (S5.)
4. **Checkpoint diet** — close the `blockSummary` string hole (184 results / 331 KB), cap Bash
   outputs like Read outputs; the checkpoint, the UI and any future re-seed all shrink. (S2.)
5. **plan.md embed diet** — step/review prompts embed the full plan verbatim; embed the step's
   slice or a path. Small at pilot scale, scales with plan size. (S3.)
6. **Rate-limit surface** — call the SDK's usage/rate-limit controls and expose 429 state; this
   IS the limit screen's data. (S5.)

Non-WO lever, operator-side: the ~20k tokens of MCP tool definitions ride **every turn of every
drive** (inherited from the ambient CLI config); trimming the global MCP set is the single
biggest per-turn saving available without touching Docket. (S3b.)

## Reproduce

```bash
npx tsx docs/probes/token-tour/measure.ts   # S1–S3b, markdown to stdout
```

Sources: `docs/probes/token-tour/measure.ts` (this tour), `docs/probes/cc-surface/raw/c1.log`
(categories), `docs/probes/cc-surface/findings.md` §C (c2 resume semantics), the two SQLite DBs
(read-only). est = chars/4, labeled everywhere it appears.
