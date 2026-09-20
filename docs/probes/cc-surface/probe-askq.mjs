// WO-0076 — the structured-question surface probe (AskUserQuestion through the SDK).
//
// Sibling of probe-steer.mjs / probe-task.mjs. Measures whether a plain SDK session
// (0.3.221, canUseTool attached, permissionMode 'default', no allowlist games) lets the
// model call AskUserQuestion, what the fence sees, whether the host can answer by folding
// the selection into the permission response, what the stream records, and the deny path.
// Throwaway probe, not app code.
//
// REQUIREMENTS: @anthropic-ai/claude-agent-sdk 0.3.221 (package.json pin); ambient `claude`
//   CLI auth; cwd /tmp/cc-askq-probe (created by the script). canUseTool is attached in every
//   scenario — Docket always passes one (bidirectional needs), so the probe exercises the same
//   transport mode as the app.
//
// Usage: node probe-askq.mjs <scenario> <out.log>
//   a0  control       — NO ask instruction: the model is asked to list its own tool names.
//                       Does AskUserQuestion exist in a plain session at all, and does any
//                       canUseTool call fire without it?
//   a1  single-select — the model is told to ask ONE question, 3 options, one "(Recommended)".
//                       Answer: behavior 'allow' with the recommended label folded into
//                       updatedInput.answers (keyed by question text — the AskUserQuestionOutput
//                       answers shape). What exactly does the model receive back?
//   a2  multi-select  — multiSelect true, 3 options, host answers with TWO labels joined ", "
//                       (the d.ts says multi-select answers are comma-separated).
//   a3  other         — host answers with a free-text value matching NO option.
//   a4  deny          — behavior 'deny' with a message. What does the model do next?
//   a5  bare allow    — control for the fold: behavior 'allow' with NO updatedInput.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const [scenario, outPath] = process.argv.slice(2);
if (!scenario || !outPath) {
  console.error("usage: node probe-askq.mjs <a0|a1|a2|a3|a4|a5> <out.log>");
  process.exit(2);
}

const lines = [];
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s) => lines.push(`[${ts()}] ${s}`);
const full = (x) => JSON.stringify(x);

const sdkRoot = fileURLToPath(new URL("../../../node_modules/@anthropic-ai/claude-agent-sdk/", import.meta.url));
const sdkPkg = JSON.parse(readFileSync(`${sdkRoot}package.json`, "utf8"));
log(`SDK ${sdkPkg.name}@${sdkPkg.version} node=${process.version} scenario=${scenario}`);

mkdirSync("/tmp/cc-askq-probe", { recursive: true });

const ASK_PROMPT = (subject, multi) =>
  "Use the AskUserQuestion tool now to ask the operator exactly ONE question" +
  (multi ? " (multiSelect: true)" : " (single-select, multiSelect: false)") +
  `: which ${subject}. Header "Storage". Exactly three options, in this order: ` +
  '"SQLite (Recommended)" with description "Embedded, zero-ops, fits a single machine", ' +
  '"Postgres" with description "Full server database, ops burden", ' +
  '"JSON files" with description "Flat files on disk, no query layer". ' +
  "Do not call any other tool and do not do anything else in this turn.";

const PROMPTS = {
  a0:
    "List the exact names of every tool you currently have available, as one comma-separated " +
    "line. Do not call any tool. If you are not sure a tool exists, leave it out.",
  a1: ASK_PROMPT("persistence layer the new service should use", false),
  a2: ASK_PROMPT("export formats should be enabled at launch", true),
  a3: ASK_PROMPT("persistence layer the new service should use", false),
  a4: ASK_PROMPT("persistence layer the new service should use", false),
  a5: ASK_PROMPT("persistence layer the new service should use", false),
}[scenario];
if (!PROMPTS) { console.error(`unknown scenario ${scenario}`); process.exit(2); }

// --- the host-side answer, per scenario (what a Docket card click would send) ---
const RE_RECO = /\(Recommended\)\s*$/;
const permissionResultFor = (input) => {
  const q = input?.questions?.[0];
  if (!q) return { kind: "allow-bare" };
  const questionKey = q.question;
  switch (scenario) {
    case "a1":
    case "a3":
    case "a4":
    case "a5": {
      if (scenario === "a4") return { kind: "deny" };
      if (scenario === "a5") return { kind: "allow-bare" };
      if (scenario === "a3")
        return {
          kind: "fold",
          answer: "Plain markdown files with YAML front-matter — none of the listed options",
          questionKey,
        };
      const reco = q.options.find((o) => RE_RECO.test(o.label)) ?? q.options[0];
      return { kind: "fold", answer: reco.label, questionKey };
    }
    case "a2": {
      const two = q.options.slice(0, 2).map((o) => o.label);
      return { kind: "fold", answer: two.join(", "), questionKey };
    }
    default:
      return { kind: "allow-bare" };
  }
};

let canUseToolCalls = 0;

const canUseTool = async (toolName, input, opts) => {
  canUseToolCalls++;
  log(`CAN_USE_TOOL#${canUseToolCalls} tool=${toolName}`);
  log(`CAN_USE_TOOL_INPUT ${full(input)}`);
  log(
    `CAN_USE_TOOL_OPTS ${full({
      signal: typeof opts?.signal,
      suggestions: opts?.suggestions ?? "absent",
      blockedPath: opts?.blockedPath ?? "absent",
      decisionReason: opts?.decisionReason ?? "absent",
      title: opts?.title ?? "absent",
      displayName: opts?.displayName ?? "absent",
      description: opts?.description ?? "absent",
      toolUseID: opts?.toolUseID ?? "absent",
      agentID: opts?.agentID ?? "absent",
      requestId: opts?.requestId ?? "absent",
      matchedAskRule: opts?.matchedAskRule ?? "absent",
    })}`,
  );
  let result;
  if (toolName === "AskUserQuestion") {
    const plan = permissionResultFor(input);
    log(`ANSWER_PLAN ${full(plan)}`);
    if (plan.kind === "deny") {
      result = { behavior: "deny", message: "probe: the operator declined to answer this question" };
    } else if (plan.kind === "fold") {
      result = {
        behavior: "allow",
        updatedInput: { ...input, answers: { [plan.questionKey]: plan.answer } },
      };
    } else {
      result = { behavior: "allow" };
    }
  } else {
    result = { behavior: "allow" };
  }
  log(`PERMISSION_RESPONSE ${full(result)}`);
  return result;
};

let sessionId;
let ended = false;
let results = 0;

const abortController = new AbortController();
const q = query({
  prompt: PROMPTS,
  options: {
    cwd: "/tmp/cc-askq-probe",
    permissionMode: "default",
    maxTurns: 6,
    abortController,
    canUseTool,
  },
});
log(`SEED ${full(PROMPTS)}`);

const watchdog = setTimeout(() => { if (!ended) { abortController.abort(); log("WATCHDOG_ABORT"); } }, 150000);

try {
  for await (const msg of q) {
    const t = msg.type;
    const st = msg.subtype ? `:${msg.subtype}` : "";
    if (t === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      log(`MSG[init] session=${msg.session_id} capabilities=${full(msg.capabilities ?? null)}`);
      log(`MSG[init] FULL ${full(msg)}`);
      continue;
    }
    if (t === "assistant") {
      const blocks = (msg.message?.content ?? []).map((b) => `${b.type}${b.name ? ":" + b.name : ""}`).join(",");
      log(`MSG[assistant] parent_tool_use_id=${full(msg.parent_tool_use_id ?? null)} blocks=${blocks}`);
      for (const b of msg.message?.content ?? []) {
        if (b.type === "text") log(`  TEXT ${full(b.text)}`);
        if (b.type === "tool_use") log(`  TOOL_USE id=${b.id} name=${b.name} input=${full(b.input ?? null)}`);
      }
      continue;
    }
    if (t === "user") {
      const c = msg.message?.content;
      const blocks = Array.isArray(c) ? c.map((b) => b.type).join(",") : "str";
      log(`MSG[user] parent_tool_use_id=${full(msg.parent_tool_use_id ?? null)} blocks=${blocks}`);
      log(`  CONTENT ${full(c)}`);
      log(`  TOOL_USE_RESULT ${msg.tool_use_result === undefined ? "ABSENT" : full(msg.tool_use_result)}`);
      continue;
    }
    if (t === "result") {
      results++;
      log(`MSG[result#${results}] subtype=${msg.subtype} cost_usd=${msg.total_cost_usd}`);
      if (msg.result !== undefined) log(`  RESULT_TEXT ${full(msg.result)}`);
      continue;
    }
    log(`MSG[${t}${st}] ${full(msg)}`);
  }
  ended = true;
  log("STREAM_ENDED");
} catch (e) {
  ended = true;
  log(`ERROR ${String(e?.stack || e).slice(0, 600)}`);
} finally {
  clearTimeout(watchdog);
}

log(`SUMMARY scenario=${scenario} session=${sessionId ?? "NONE"} results=${results} canUseToolCalls=${canUseToolCalls}`);
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`${scenario}: results=${results} canUseToolCalls=${canUseToolCalls} session=${sessionId ?? "NONE"} -> ${outPath}`);
