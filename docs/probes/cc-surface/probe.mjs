// WO-0001 — Claude Code surface probe harness (script of record).
//
// Drives @anthropic-ai/claude-agent-sdk query() per a JSON config and logs every
// SDKMessage (plus canUseTool invocations) to a file. This is the generic harness
// used for Q0 (smoke), Q1, Q2, Q3, Q5, Q7, and the Q6 allowlist run.
// Two scenario-specific variants that need inline *callbacks* (not JSON-serializable)
// live alongside: probe-hooks.mjs (Q4) and probe-fence.mjs (Q6 host-canUseTool fence).
//
// REQUIREMENTS (not in the app package.json — this is a throwaway probe):
//   npm install @anthropic-ai/claude-agent-sdk   # measured version: 0.3.221
//   Node 22+. Auth: the SDK spawns `claude`, which resolves credentials the usual
//   way (ANTHROPIC_API_KEY / API key helper / OAuth profile).
//
// Usage: node probe.mjs <config.json> <out.log>
//   config.json: {
//     prompt: string,
//     options: { ...serializable ClaudeAgentOptions... },  // permissionMode, cwd,
//                    allowedTools, disallowedTools, resume, maxTurns, includeHookEvents, ...
//     canUseToolPolicy: "allow" | "deny" | null   // optional; attaches a canUseTool callback
//   }
//
// Scenarios driven (outputs in raw/):
//   q0  smoke      — Write attempt, canUseToolPolicy:"deny"           -> raw/q0-sdk-smoke.log
//   q1  schema     — trivial reply, maxTurns:1                         -> raw/q1-sdk-stream.log
//   q2  plan       — permissionMode:"plan", file-creation task         -> raw/q2-plan.log
//   q3  approve    — resume q2's id, permissionMode:"acceptEdits"      -> raw/q3-approve.log
//   q5  resume     — (CLI ground-truth, see raw/q5-cli-resume*.json)
//   q6  allowlist  — dontAsk + allowedTools Edit(docs/**)              -> raw/q6-allowlist.log
//   q7  killed     — long multi-file task, SIGKILLed mid-run (transcript in ~/.claude)
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, writeFileSync } from "node:fs";

const [cfgPath, outPath] = process.argv.slice(2);
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const lines = [];
const log = (s) => lines.push(s);

const options = { ...(cfg.options || {}) };
let canUseToolCalls = 0;
const policy = cfg.canUseToolPolicy || null;
if (policy) {
  options.canUseTool = async (toolName, input, o) => {
    canUseToolCalls++;
    log("CAN_USE_TOOL " + JSON.stringify({
      toolName, toolUseID: o.toolUseID, requestId: o.requestId,
      title: o.title, displayName: o.displayName, description: o.description,
      decisionReason: o.decisionReason, blockedPath: o.blockedPath, input,
    }));
    if (policy === "allow") return { behavior: "allow" };
    return { behavior: "deny", message: "probe: denied by harness policy" };
  };
}

log("CONFIG " + JSON.stringify({ prompt: cfg.prompt, options: { ...options, canUseTool: policy ? "<fn>" : undefined } }));
const t0 = Date.now();
try {
  for await (const msg of query({ prompt: cfg.prompt, options })) {
    log("MSG " + JSON.stringify(msg));
  }
} catch (e) {
  log("ERROR " + String(e?.stack || e));
}
log("ELAPSED_MS " + (Date.now() - t0));
log("CAN_USE_TOOL_CALLS " + canUseToolCalls);
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`wrote ${lines.length} lines to ${outPath}`);
