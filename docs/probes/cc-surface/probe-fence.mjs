// WO-0001 Q6 / TD-001 variant — fences a session to writes under docs/** only,
// via a HOST canUseTool policy (the general mechanism; allowlist-by-path did not
// work — see raw/q6-allowlist.log). Requires @anthropic-ai/claude-agent-sdk.
// Scratch repo layout: /tmp/cc-fence/{docs,src}, each with a keep.txt.
// Output: raw/q6-fence.log
import { query } from "@anthropic-ai/claude-agent-sdk";
import { writeFileSync, existsSync } from "node:fs";

const outPath = process.argv[2];
const DOCS = "/tmp/cc-fence/docs/";
const lines = []; const log = (s) => lines.push(s);

const decide = (toolName, input) => {
  if (["Read", "Grep", "Glob", "LS"].includes(toolName)) return { behavior: "allow" };
  if (["Write", "Edit", "NotebookEdit"].includes(toolName)) {
    const p = input?.file_path || input?.path || "";
    return p.startsWith(DOCS)
      ? { behavior: "allow" }
      : { behavior: "deny", message: "fence: writes allowed only under docs/" };
  }
  if (toolName === "Bash") return { behavior: "deny", message: "fence: Bash not permitted for this role" };
  return { behavior: "deny", message: "fence: tool not on allowlist" };
};

const q = query({
  prompt: "Do exactly these three steps and report each outcome: (1) Read /tmp/cc-fence/src/keep.txt and quote it. (2) Create /tmp/cc-fence/docs/marker.txt containing MARK using the Write tool. (3) Create /tmp/cc-fence/src/marker.txt containing MARK using the Write tool.",
  options: {
    cwd: "/tmp/cc-fence", maxTurns: 8, permissionMode: "default",
    canUseTool: async (toolName, input, o) => {
      const d = decide(toolName, input);
      log("DECISION " + JSON.stringify({ toolName, rid: o.requestId, path: input?.file_path || input?.path, cmd: input?.command, behavior: d.behavior }));
      return d;
    },
  },
});
for await (const msg of q) log("MSG[" + (msg.type || "?") + "] " + JSON.stringify(msg).slice(0, 240));
log("POST docs/marker.txt=" + existsSync("/tmp/cc-fence/docs/marker.txt") + " src/marker.txt=" + existsSync("/tmp/cc-fence/src/marker.txt"));
writeFileSync(outPath, lines.join("\n") + "\n");
console.log("docs/marker.txt=" + existsSync("/tmp/cc-fence/docs/marker.txt") + " src/marker.txt=" + existsSync("/tmp/cc-fence/src/marker.txt"));
