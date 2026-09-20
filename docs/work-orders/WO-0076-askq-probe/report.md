# WO-0076 — AskUserQuestion through the SDK — findings

Probed 2026-09-20 against `@anthropic-ai/claude-agent-sdk@0.3.221` (package.json pin), ambient
`claude` CLI **2.1.267** (`/opt/homebrew/bin/claude` → Caskroom 2.1.267), node v26.9.0. Method:
`docs/probes/cc-surface/probe-askq.mjs` (the probe-steer.mjs sibling) — `query({ prompt: <string>,
options: { cwd, permissionMode: 'default', maxTurns: 6, canUseTool } })`, cwd `/tmp/cc-askq-probe`,
real sessions, everything logged verbatim. Six runs, total spend **$2.1578**
(`raw/askq-a0.log:1620` 0.318005 · `raw/askq-a1.log:157` 0.467453 · `raw/askq-a2.log:186` 0.247425 ·
`raw/askq-a3.log:148` 0.492114 · `raw/askq-a4.log:120` 0.417363 · `raw/askq-a5.log:148` 0.215465).

**Verdict up front: the surface is REAL and host-answerable. In a plain SDK session the model can
call `AskUserQuestion`; the fence (Docket's `canUseTool`) receives the full questions array
verbatim; the host answers by returning `{ behavior: 'allow', updatedInput: { ...input,
answers: { [questionText]: "<label>" } } }`; the CLI then synthesizes a tool_result whose wording
even distinguishes a picked OPTION from a free-text "Other". Deny is an `is_error:true`
tool_result the model treats as "declined, turn ends asking how to proceed".**

Environment note for honesty: the probe cwd is `/tmp`, but the operator's global `~/.claude.json`
MCP servers (context7, filesystem, memory, github, …) loaded into every session — they inflate the
a0 tool list only; they touch nothing else measured here.

## Q1 — Offered?

**YES — present in a plain session with no allowlist games, and it FIRES through the fence.**

Control run a0 (no ask instruction) — the model's own inventory of its tools names it first:

```
raw/askq-a0.log:1619  TEXT "Agent, AskUserQuestion, Bash, CronCreate, CronDelete, CronList, Edit, EnterPlanMode, …"
raw/askq-a0.log:1623  SUMMARY scenario=a0 session=bcd69023-cda2-4e6b-8989-79aeec7d32b4 results=1 canUseToolCalls=0
```

Instructed run a1 — the model calls it and the fence sees it (`canUseToolCalls=1`,
`raw/askq-a1.log:161`):

```
raw/askq-a1.log:87    CAN_USE_TOOL#1 tool=AskUserQuestion
```

Static side: the installed d.ts declares the tool's input/output schemas in
`node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` (line refs below), and the CLI binary
itself carries the tool description: *"If you recommend a specific option, make that the first
option in the list and add \"(Recommended)\" at the end of the label"* + *"Users will always be
able to select \"Other\" to provide custom text input"* (strings extracted from the 2.1.267
binary — corroboration, not the measurement; the runs above are the measurement).

## Q2 — The payload

The fence receives the tool call's input verbatim: a `questions` array. Exact field names as
logged:

```
raw/askq-a1.log:88    CAN_USE_TOOL_INPUT {"questions":[{"question":"Which persistence layer should the new service use?","header":"Storage","options":[{"label":"SQLite (Recommended)","description":"Embedded, zero-ops, fits a single machine"},{"label":"Postgres","description":"Full server database, ops burden"},{"label":"JSON files","description":"Flat files on disk, no query layer"}],"multiSelect":false}]}
```

Field-by-field (all observed, none assumed):

| Field | Observed | Notes |
| --- | --- | --- |
| `questions` | array, 1 element here | d.ts: 1–4 questions (`@minItems 1` / `@maxItems 4`, sdk-tools.d.ts:852-853) |
| `questions[].question` | `"Which persistence layer should the new service use?"` | **the answer key** — the host must key its answer by this exact string |
| `questions[].header` | `"Storage"` | the chip label, ≤12 chars per the d.ts comment (sdk-tools.d.ts:863) |
| `questions[].options[].label` | `"SQLite (Recommended)"` | the recommendation is carried ONLY as this label suffix — there is **no `recommended` field**; the convention is first-in-list + `(Recommended)` suffix |
| `questions[].options[].description` | `"Embedded, zero-ops, fits a single machine"` | always present in the three runs (d.ts has it required) |
| `questions[].options[].preview` | absent | optional; only rendered when `toolConfig.askUserQuestion.previewFormat` is wired (sdk.d.ts:6989-7004) |
| `questions[].multiSelect` | `false` (a1/a3/a4/a5), `true` (a2) | radio vs checkbox — on the INPUT, per question |
| multi-select chosen pair | delivered as ONE comma-joined string, below | matches the d.ts output comment "multi-select answers are comma-separated" (sdk-tools.d.ts:3554) |

```
raw/askq-a2.log:91    CAN_USE_TOOL_INPUT {"questions":[{"question":"Which export formats should be enabled at launch?","header":"Storage","options":[{"label":"SQLite (Recommended)", …}, …],"multiSelect":true}]}
```

The callback's third argument (`options` of `CanUseTool`, sdk.d.ts:206) — the fence-visible
metadata; `displayName` is populated, `decisionReason`/`suggestions`/`matchedAskRule` are not:

```
raw/askq-a1.log:89    CAN_USE_TOOL_OPTS {"signal":"object","suggestions":"absent","blockedPath":"absent","decisionReason":"absent","title":"absent","displayName":"AskUserQuestion","description":"absent","toolUseID":"call_304edb7e349442d98cc7cfa9","agentID":"absent","requestId":"e65bd262-a935-47a2-80fa-23c757c9f305","matchedAskRule":"absent"}
```

`toolUseID` equals the stream's `tool_use` block id (`raw/askq-a1.log:86`:
`TOOL_USE id=call_304edb7e349442d98cc7cfa9 name=AskUserQuestion`) — that is the join key between
the fence and any transcript rendering.

## Q3 — The answer path

**YES — the host resolves the question through the permission response, folding the selection into
`updatedInput.answers` keyed by question text.** Exactly what was sent (a1, the recommended option
folded in — `ANSWER_PLAN` line shows the computed answer):

```
raw/askq-a1.log:90    ANSWER_PLAN {"kind":"fold","answer":"SQLite (Recommended)","questionKey":"Which persistence layer should the new service use?"}
raw/askq-a1.log:91    PERMISSION_RESPONSE {"behavior":"allow","updatedInput":{"questions":[ …verbatim input… ],"answers":{"Which persistence layer should the new service use?":"SQLite (Recommended)"}}}
```

What the model receives back — the CLI synthesizes the tool_result from that fold:

```
raw/askq-a1.log:93    CONTENT [{"type":"tool_result","content":"Your questions have been answered: \"Which persistence layer should the new service use?\"=\"SQLite (Recommended)\". You can now continue with these answers in mind.","tool_use_id":"call_304edb7e349442d98cc7cfa9"}]
```

The turn continues coherently and honors the selection:

```
raw/askq-a1.log:156   TEXT "The new service will use SQLite as its persistence layer."
```

Multi-select — two labels joined `", "` into one string (a2), both honored:

```
raw/askq-a2.log:93    ANSWER_PLAN {"kind":"fold","answer":"SQLite (Recommended), Postgres","questionKey":"Which export formats should be enabled at launch?"}
raw/askq-a2.log:96    CONTENT [{"type":"tool_result","content":"Your questions have been answered: \"Which export formats should be enabled at launch?\"=\"SQLite (Recommended), Postgres\". You can now continue with these answers in mind.","tool_use_id":"call_d348e3bf27c244d0a24a0b7a"}]
raw/askq-a2.log:185   TEXT "Seçim alındı: **SQLite** ve **Postgres** başlangıçta etkin olacak; JSON dosyaları seçilmedi."
```

Free-text "Other" (a3 — an answer matching NO label). The CLI classifies the answer against the
offered labels and switches the tool_result template, telling the model the answer may override
the options:

```
raw/askq-a3.log:53    CONTENT [{"type":"tool_result","content":"The user answered: \"Which persistence layer should the new service use?\"=\"Plain markdown files with YAML front-matter — none of the listed options\". Read the answers carefully — they may request clarification, changes, or that you not proceed — and follow what they actually say.","tool_use_id":"call_1619f9e18db64dddaa757efd"}]
raw/askq-a3.log:147   TEXT "Understood — the persistence layer will be **plain markdown files with YAML front-matter** (none of the three listed options). I'll treat the store as: one `.md` file per record, …"
```

Control for the fold itself (a5 — `{ behavior: 'allow' }` with NO `updatedInput`): legal, and it is
the "dismissed" answer, not an error:

```
raw/askq-a5.log:79    PERMISSION_RESPONSE {"behavior":"allow"}
raw/askq-a5.log:81    CONTENT [{"type":"tool_result","content":"The user did not answer the questions.","tool_use_id":"call_58f4512b111b42ca9b437f9d"}]
raw/askq-a5.log:82    TOOL_USE_RESULT {"questions":[ …verbatim… ],"answers":{}}
```

## Q4 — The transcript

The stream records the pair a renderer needs, and NOTHING else special — no dedicated stream event,
no user-message echo of the question. Message census for a1:

```
raw/askq-a1.log (census)  4 MSG[assistant] · 1 MSG[user] · 2 MSG[init] · 136 MSG[system:thinking_tokens] · 1 hook_started · 1 hook_response
```

- **The question** arrives twice for the host: on the stream as an ordinary assistant `tool_use`
  block (`raw/askq-a1.log:86`,
  `TOOL_USE id=call_304edb7e349442d98cc7cfa9 name=AskUserQuestion input={"questions":[{"header":"Storage",…}…]}`),
  and on the fence as `canUseTool` — the fence fires first (15.1s both, log order tool_use →
  CAN_USE_TOOL). A ledger renderer can get the question from the tool_use block without touching
  the fence.
- **The answer** rides the following `user` message as a `tool_result` block whose `content` is the
  CLI's template line (`raw/askq-a1.log:93`, a3's "The user answered: …" variant at
  `raw/askq-a3.log:53`, a4's error variant below) — `parent_tool_use_id` is `null` on both
  messages (main thread).
- **The structured copy** of question+answer is `SDKUserMessage.tool_use_result`, already in the
  d.ts `AskUserQuestionOutput` shape (`questions` + `answers`, no `response`/`annotations`/
  `afkTimeoutMs` observed on the answered path):

```
raw/askq-a1.log:94    TOOL_USE_RESULT {"questions":[{"question":"Which persistence layer should the new service use?","header":"Storage","options":[ … ],"multiSelect":false}],"answers":{"Which persistence layer should the new service use?":"SQLite (Recommended)"}}
```

So Docket's ledger/card renders: the question (`header` chip + `question` + options with
descriptions), and the resolution read from `tool_use_result.answers` (or the fence's own record of
what the operator clicked — richer than the round-tripped string).

## Q5 — The deny path

`behavior: 'deny'` with a message produces an ERROR tool_result carrying the message verbatim, and
the model ends its turn reporting the refusal and asking how to proceed — it did **not** re-ask,
did **not** pick an option on its own:

```
raw/askq-a4.log:58    PERMISSION_RESPONSE {"behavior":"deny","message":"probe: the operator declined to answer this question"}
raw/askq-a4.log:60    CONTENT [{"type":"tool_result","content":"probe: the operator declined to answer this question","is_error":true,"tool_use_id":"call_a06179a8bb1342138ef327d0"}]
raw/askq-a4.log:61    TOOL_USE_RESULT "Error: probe: the operator declined to answer this question"
raw/askq-a4.log:119   TEXT "The question was declined, so no persistence layer was selected. Let me know how you'd like to proceed — I can re-ask, or you can tell me the choice directly."
```

Note the `tool_use_result` degenerates to a plain error string (not the structured object) — the
deny path gives the ledger nothing structured; Docket must keep its own record of the declined
question from the fence.

## The d.ts evidence (0.3.221, quoted with line numbers)

`node_modules/@anthropic-ai/claude-agent-sdk/sdk-tools.d.ts` (exported at package subpath
`"./sdk-tools"`):

- `:32` `  | AskUserQuestionInput` (inside `export type ToolInputSchemas`), `:76`
  `  | AskUserQuestionOutput` (inside `ToolOutputSchemas`)
- `:848` `export interface AskUserQuestionInput {` — `:850` `* Questions to ask the user (1-4 questions)`,
  `:852-853` `@minItems 1` / `@maxItems 4`, `:861` `question: string;`, `:863` `* Very short label
  displayed as a chip/tag (max 12 chars).`, `:865` `header: string;`, `:867` `* There should be no
  'Other' option, that will be provided automatically.`, `:869-870` options `@minItems 2` /
  `@maxItems 4`, `:878` `label: string;`, `:882` `description: string;`, `:886`
  `preview?: string;`, `:1008` `multiSelect: boolean;`
- `:3396` `export interface AskUserQuestionOutput {` — `:3551` `multiSelect: boolean;`, `:3554`
  `* The answers provided by the user (question text -> answer string; multi-select answers are
  comma-separated)`, `:3556-3558` `answers: { [k: string]: string; };`, `:3560`
  `* Freeform text the user typed instead of selecting a structured option`, `:3562`
  `response?: string;`, `:3564-3577` `annotations?: { [k: string]: { preview?: string;
  notes?: string } };`, `:3579` `* Set when the dialog auto-resolved after this many milliseconds
  of idle (user away from keyboard).` + `afkTimeoutMs?: number;`

`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`:

- `:206` `export declare type CanUseTool = (toolName: string, input: Record<string, unknown>, options: {` … `:266` `}) => Promise<PermissionResult | null>;`
- `:2114` `export declare type PermissionResult = {` — `:2115` `behavior: 'allow';`, `:2116`
  `updatedInput?: Record<string, unknown>;` | `:2121` `behavior: 'deny';`, `:2122` `message: string;`
- `:1322` `export declare type Options = {` — `:1375` `allowedTools?: string[];`, `:1380`
  `canUseTool?: CanUseTool;`
- `:6989` `askUserQuestion?: {` inside `export declare type ToolConfig` — `:7003`
  `previewFormat?: 'markdown' | 'html';` (the option-previews format knob)
- `:6392` `askUserQuestionTimeout?: '60s' | '5m' | '10m' | 'never';` — NOTE: this line lives inside
  `export declare interface Settings` (`:4962`), a CLI settings-file key, NOT an `Options` field.
- `:1556` `onUserDialog?: OnUserDialog;` + `:1571` `supportedDialogKinds?: string[];` — the
  `request_user_dialog` channel is a DIFFERENT, opt-in dialog mechanism (`'refusal_fallback_prompt'`
  etc.); AskUserQuestion did not ride it in any run — it arrived at `canUseTool`.
- NO literal `AskUserQuestion` tool-name string exists anywhere in sdk.d.ts (grep over the file:
  only camelCase `askUserQuestion` keys above) — there is no typed tool-name union to test
  membership against; `allowedTools`/`disallowedTools` take bare strings.

## WO-0077 design consequences

**(a) Can Docket's fence see the question and its options?** Yes, completely. The existing
`canUseTool` (runner-wired, `src/adapters/runner/index.ts:590-595`) already receives every
AskUserQuestion call: `toolName === 'AskUserQuestion'`, `input` = `{ questions: [...] }` verbatim
(`raw/askq-a1.log:88`), with `options.toolUseID` (the transcript join key) and `options.requestId`
in the callback's third argument. No new SDK surface, no allowlist change, no `onUserDialog`/
`supportedDialogKinds` wiring — measured: not needed for this tool. The fence must PARSE/validate
`input` itself (it is `Record<string, unknown>`), and must answer synchronously-ish: the turn is
blocked on the callback until it returns.

**(b) Can the host answer by folding the selection into the permission response?** Yes — measured
end-to-end (Q3). The contract:

- selection: `{ behavior: 'allow', updatedInput: { ...input, answers: { [question.question]: label } } }`
  — key by the exact `question` string; single-select value is one label; multi-select is the
  chosen labels joined `', '` (a2). Sending the label verbatim INCLUDING the `(Recommended)` suffix
  worked (a1); the CLI does not strip it, the model just reads it.
- "Other": same shape, value = the free text — the CLI detects the non-match and flips to the
  "The user answered: … follow what they actually say" template (a3).
- dismissed: `{ behavior: 'allow' }` → `"The user did not answer the questions."` (a5).
- declined: `{ behavior: 'deny', message }` → `is_error` tool_result with the message verbatim (a4).

**(c) What the ledger/cards render.** The ask card: `header` as the chip, `question` as the head,
each option as label + description, the parsed-off `(Recommended)` suffix rendered as a marker on
the first option (parse — never store; there is no field). Terminal states on the same card or as
the record row: chosen label(s) / free text ("Other"), declined + the host's message, dismissed.
The ledger needs no new event kind: the tool_use/tool_result pair IS the record, and
`tool_use_result` carries the structured `questions`+`answers` copy (`raw/askq-a1.log:94`) — but
for a DENY the structured copy degenerates to an error string (`raw/askq-a4.log:61`), so the fence
must persist the declined question itself if the card is to render it. Empty states: 1 short line
(ADR-0012) — the question text is display copy from the MODEL, so it goes through as data, not as
bundle vocabulary; only the card's fixed chrome (buttons, state words) is locale-bundle text.

**(d) Impossible on 0.3.221.** No typed tool name — `'AskUserQuestion'` is a string literal Docket
owns (grep: absent from sdk.d.ts); no tool-list advertisement to test against (initialize response
carries commands/models/agents only). No typed fence payload — `input` is
`Record<string, unknown>`; the parse is Docket's. No `recommended` field — the marker is a label
suffix convention, so detection is a parse of `/\(Recommended\)\s*$/` against `options[0]` and is
only as honest as the model's adherence. No host-side timeout knob on `Options` —
`askUserQuestionTimeout` is a CLI `Settings` key (sdk.d.ts:6392 in `interface Settings`), not
per-query; unmeasured here (an `afkTimeoutMs` output field exists for the CLI's own auto-resolve).
`response`/`annotations` output fields are CLI-internal; only `answers` is consumed from
`updatedInput`. Multi-question calls (1-4) and the `preview` field were not exercised — one
question per call is all Docket's drives need, and previews are off unless
`toolConfig.askUserQuestion.previewFormat` is wired.

**(e) The TypeScript shapes for the parsed payload** (core-side, vendor-neutral — names to freeze
in WO-0077):

```ts
/** One option of a structured question, verbatim from the fence. */
export interface AskOption {
  label: string;          // "(Recommended)" suffix INCLUDED — parse it off for display
  description: string;
  preview?: string;       // absent unless previewFormat is wired (not wired in Docket)
}

/** One question of an AskUserQuestion fence call (sdk-tools.d.ts AskUserQuestionInput, 1-4 per call). */
export interface AskQuestion {
  question: string;       // THE ANSWER KEY — fold answers back under this exact string
  header: string;         // chip label, <=12 chars
  options: AskOption[];   // 2-4
  multiSelect: boolean;   // radio vs checkbox
}

/** The fence payload for toolName 'AskUserQuestion' (input is Record<string,unknown> — this is Docket's parse). */
export interface AskRequest {
  toolUseId: string;      // options.toolUseID — equals the stream tool_use block id (a1: call_304edb7e…)
  requestId: string;      // the control envelope id the permission response is matched against
  questions: [AskQuestion, ...AskQuestion[]];
}

/** The operator's resolution, as the card hands it to the fence. */
export type AskAnswer =
  | { kind: 'selection'; labels: string[] }   // 1 label, or N when multiSelect (sent ", "-joined)
  | { kind: 'other'; text: string }           // free text matching no label (a3's template path)
  | { kind: 'dismissed' }                     // bare { behavior: 'allow' } (a5)
  | { kind: 'declined'; message: string };    // { behavior: 'deny', message } (a4)

/** The recommendation marker: convention, not a field — the only parse Docket may do on labels. */
export const RECOMMENDED_SUFFIX = /\(Recommended\)\s*$/;

/** Build the PermissionResult the fence returns (Q3's contract, all four arms measured). */
export declare function askPermissionResult(req: AskRequest, a: AskAnswer): PermissionResult;

/** What the ledger keeps per resolved ask (fence-side truth; structured even on the deny arm). */
export interface AskResolution {
  toolUseId: string;
  question: AskQuestion;
  answer: AskAnswer;
  at: string;             // ISO — Docket's event timestamp
}
```
