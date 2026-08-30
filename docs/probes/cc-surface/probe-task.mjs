// WO-0055 — agent-task lifecycle probe (t1): one Task-tool subagent spawn.
//
// Sibling of probe-steer.mjs. Answers the three questions plan.md marks as branch points:
//   t1a  what task_type/subagent_type does a REAL Task-tool subagent carry on
//        task_started/task_notification?  (isAgentTask's third line)
//   t1b  do the subagent's own assistant/user messages carry parent_tool_use_id, and is its
//        value the Task call's tool_use_id?  (the nesting link)
//   t1c  what shape is SDKUserMessage.tool_use_result for the Task tool?  (the report source)
//
// REQUIREMENTS: @anthropic-ai/claude-agent-sdk 0.3.221 (package.json pin); ambient `claude`
//   CLI auth; cwd /tmp/cc-task-probe (created by the script). canUseTool allow-all, the same
//   transport mode as the app.
//
// Usage: node probe-task.mjs <out.log>
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";

const outPath = process.argv[2];
if (!outPath) {
  console.error("usage: node probe-task.mjs <out.log>");
  process.exit(2);
}

const lines = [];
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s) => lines.push(`[${ts()}] ${s}`);
const full = (msg) => JSON.stringify(msg);

const SEED =
  "Use the Task tool to launch exactly ONE general-purpose subagent. The subagent must run " +
  "`ls` in this directory and reply with a one-line summary of what it sees. When the subagent " +
  "has finished, reply with exactly SPAWNED and nothing else.";

mkdirSync("/tmp/cc-task-probe", { recursive: true });

let sessionId;
let ended = false;
let results = 0;

const abortController = new AbortController();
const q = query({
  prompt: SEED,
  options: {
    cwd: "/tmp/cc-task-probe",
    permissionMode: "default",
    maxTurns: 8,
    abortController,
    canUseTool: async (toolName, input) => {
      log(`CAN_USE_TOOL tool=${toolName} input=${JSON.stringify(input).slice(0, 200)}`);
      // strict allow-list: the Task spawn + the subagent's `ls` — everything else is denied
      if (toolName === "Task") return { behavior: "allow" };
      if (toolName === "Bash" && typeof input?.command === "string" && /^\s*ls\b/.test(input.command)) {
        return { behavior: "allow" };
      }
      return { behavior: "deny", message: `probe allow-list: ${toolName} is not permitted` };
    },
  },
});
log(`SEED ${JSON.stringify(SEED)}`);

// watchdog: a quiet stream never ends on its own — force 90s (a subagent spawn is slower than steer's 20s)
const watchdog = setTimeout(() => { if (!ended) { abortController.abort(); log("WATCHDOG_ABORT"); } }, 90000);

try {
  for await (const msg of q) {
    const t = msg.type;
    const st = msg.subtype ? `:${msg.subtype}` : "";
    if (t === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      log(`MSG[init] session=${msg.session_id} capabilities=${JSON.stringify(msg.capabilities ?? null)}`);
      continue;
    }
    // FULL dump for the task family + any system message — the probe's whole point
    if (t === "system") { log(`MSG[system${st}] ${full(msg)}`); continue; }
    if (t === "assistant") {
      const blocks = (msg.message?.content ?? []).map((b) => `${b.type}${b.name ? ":" + b.name : ""}`).join(",");
      log(`MSG[assistant] parent_tool_use_id=${JSON.stringify(msg.parent_tool_use_id ?? null)} subagent_type=${JSON.stringify(msg.subagent_type ?? null)} blocks=${blocks}`);
      for (const b of msg.message?.content ?? []) {
        if (b.type === "tool_use") log(`  TOOL_USE id=${b.id} name=${b.name} input=${JSON.stringify(b.input ?? null).slice(0, 300)}`);
      }
      continue;
    }
    if (t === "user") {
      const c = msg.message?.content;
      const blocks = Array.isArray(c) ? c.map((b) => b.type).join(",") : "str";
      log(`MSG[user] parent_tool_use_id=${JSON.stringify(msg.parent_tool_use_id ?? null)} blocks=${blocks}`);
      log(`  TOOL_USE_RESULT ${msg.tool_use_result === undefined ? "ABSENT" : full(msg.tool_use_result).slice(0, 1200)}`);
      continue;
    }
    if (t === "result") {
      results++;
      log(`MSG[result#${results}] subtype=${msg.subtype} cost_usd=${msg.total_cost_usd}`);
      continue;
    }
    log(`MSG[${t}${st}] ${full(msg).slice(0, 300)}`);
  }
  ended = true;
  log("STREAM_ENDED");
} catch (e) {
  ended = true;
  log(`ERROR ${String(e?.stack || e).slice(0, 400)}`);
} finally {
  clearTimeout(watchdog);
}

log(`SUMMARY session=${sessionId ?? "NONE"} results=${results}`);
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`t1: results=${results} session=${sessionId ?? "NONE"} -> ${outPath}`);
