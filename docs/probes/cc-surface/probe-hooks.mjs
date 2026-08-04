// WO-0001 Q4 variant — captures PreToolUse + PermissionRequest HOOK events.
// Hooks need inline callbacks (not JSON), so this is a dedicated script rather
// than a probe.mjs config. Requires @anthropic-ai/claude-agent-sdk.
// Output: raw/q4-hooks.log
import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync } from "node:fs";

const outPath = process.argv[2];
const lines = []; const log = (s) => lines.push(s);
let preToolUse = 0, permReq = 0;

const q = query({
  prompt: "Create /tmp/cc-sdk-smoke/hook-marker.txt with contents 'hook' using the Write tool. Then stop.",
  options: {
    cwd: "/tmp/cc-sdk-smoke", maxTurns: 2, permissionMode: "default", includeHookEvents: true,
    canUseTool: async (toolName, input, o) => {
      log("CAN_USE_TOOL " + JSON.stringify({ toolName, requestId: o.requestId }));
      return { behavior: "allow" };
    },
    hooks: {
      PreToolUse: [{ hooks: [async (input) => {
        preToolUse++;
        log("HOOK_PreToolUse keys=" + JSON.stringify(Object.keys(input || {}))
          + " tool=" + JSON.stringify(input?.tool_name)
          + " event=" + JSON.stringify(input?.hook_event_name));
        return { continue: true };
      }] }],
      PermissionRequest: [{ hooks: [async (input) => {
        permReq++;
        log("HOOK_PermissionRequest keys=" + JSON.stringify(Object.keys(input || {}))
          + " event=" + JSON.stringify(input?.hook_event_name));
        return { continue: true };
      }] }],
    },
  },
});
for await (const msg of q) {
  const json = JSON.stringify(msg);
  const t = msg.type || "?";
  log((t === "system" ? "MSG[sys] " : "MSG[" + t + "] ") + json.slice(0, t === "system" ? 500 : 300));
}
log("HOOK_CALLS PreToolUse=" + preToolUse + " PermissionRequest=" + permReq);
writeFileSync(outPath, lines.join("\n") + "\n");
console.log("PreToolUse=" + preToolUse + " PermissionRequest=" + permReq);
