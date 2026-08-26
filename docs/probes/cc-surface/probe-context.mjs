// WO-0046 — context-usage + resume-cost probe (getContextUsage cadence / cost semantics).
//
// Sibling of probe-steer.mjs. Settles the two design facts WO-0046 wires against:
//   1. Can the live Query answer getContextUsage() at the cadence the app wants (every
//      tool event + result), with acceptable latency — including while a canUseTool ask
//      PARKS the stream (the held-ask window)?
//   2. Is result.total_cost_usd session-CUMULATIVE across a resume (→ the adapter must
//      seed its delta baseline from the prior row) or per-command (→ current code correct)?
//      §S left this ambiguous (s2b fit cumulative, s2 fit per-command); c2 measures both
//      the across-leg jump AND the within-leg step (a mid-turn note forces a 2nd result).
//
// REQUIREMENTS: @anthropic-ai/claude-agent-sdk (measured: 0.3.221, package.json pin);
//   ambient `claude` CLI auth; cwd /tmp/cc-context-probe (created by the script).
//   canUseTool attached allow-all — except c1's deliberate 6s HOLD on the 2nd tool call
//   (the park window the live pane would sit in).
//
// Usage: node probe-context.mjs <c1|c2> <out.log>
// Outputs land in raw/cN.log; every findings.md §C claim cites one.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";

const [scenario, outPath] = process.argv.slice(2);
if (!scenario || !outPath || !["c1", "c2"].includes(scenario)) {
  console.error("usage: node probe-context.mjs <c1|c2> <out.log>");
  process.exit(2);
}

// --- the push-side input queue (probe-local copy of the adapter's AsyncQueue) ---
class PushQueue {
  #buf = [];
  #waiters = [];
  #closed = false;
  push(v) {
    if (this.#closed) throw new Error("push after close");
    const w = this.#waiters.shift();
    if (w) w({ value: v, done: false });
    else this.#buf.push(v);
  }
  close() {
    this.#closed = true;
    for (const w of this.#waiters) w({ value: undefined, done: true });
    this.#waiters = [];
  }
  [Symbol.asyncIterator]() {
    return {
      next: () => {
        if (this.#buf.length) return Promise.resolve({ value: this.#buf.shift(), done: false });
        if (this.#closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res) => this.#waiters.push(res));
      },
    };
  }
}

const userMsg = (text, extra = {}) => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
  uuid: crypto.randomUUID(),
  ...extra,
});

const lines = [];
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const log = (s) => lines.push(`[${ts()}] ${s}`);

mkdirSync("/tmp/cc-context-probe", { recursive: true });

/** One getContextUsage call, latency-measured, compactly logged. Call sites tag themselves. */
async function probeContext(q, tag) {
  const start = performance.now();
  try {
    const r = await q.getContextUsage();
    const ms = (performance.now() - start).toFixed(0);
    const keep = {
      totalTokens: r.totalTokens,
      maxTokens: r.maxTokens,
      percentage: r.percentage,
      model: r.model,
      isAutoCompactEnabled: r.isAutoCompactEnabled,
      ...(r.autoCompactThreshold != null ? { autoCompactThreshold: r.autoCompactThreshold } : {}),
      categories: (r.categories ?? []).map((c) => `${c.name}:${c.tokens}`).join("|"),
      wireBytes: JSON.stringify(r).length,
    };
    log(`CTX[${tag}] ${ms}ms ${JSON.stringify(keep)}`);
    return true;
  } catch (e) {
    const ms = (performance.now() - start).toFixed(0);
    log(`CTX[${tag}] THREW ${ms}ms ${String(e?.message || e).slice(0, 200)}`);
    return false;
  }
}

// c1 — the cadence probe. A multi-tool drive; context read at every assistant / user /
// result message. The 2nd tool call's canUseTool HOLDs 6s; while held, one out-of-band
// context call asks whether the control channel answers mid-park.
const C1_SEED =
  "Do these three steps in order with separate tool calls: (1) run `echo one` with Bash, " +
  "(2) run `echo two` with Bash, (3) run `echo three` with Bash. Then reply exactly DONE.";

async function runLeg({ label, seed, resume, canUseTool, onClose, onMessage, watchdogMs = 45000 }) {
  const input = new PushQueue();
  const q = query({
    prompt: input,
    options: {
      cwd: "/tmp/cc-context-probe",
      permissionMode: "default",
      maxTurns: 8,
      ...(resume ? { resume } : {}),
      ...(canUseTool ? { canUseTool } : {}),
    },
  });
  const seedMessage = userMsg(seed);
  input.push(seedMessage);
  log(`${label} SEED_PUSH resume=${resume ?? "none"}`);
  let ended = false;
  const watchdog = setTimeout(() => { if (!ended) { input.close(); log(`${label} WATCHDOG_CLOSE`); } }, watchdogMs);
  try {
    for await (const msg of q) {
      if (msg.type === "system" && msg.subtype === "init") {
        log(`${label} MSG[init] session=${msg.session_id} capabilities=${JSON.stringify(msg.capabilities ?? null)}`);
        if (onMessage) await onMessage(msg, q, input);
        continue;
      }
      if (msg.type === "assistant") {
        const u = msg.message?.usage;
        const tools = (msg.message?.content ?? []).filter((b) => b.type === "tool_use").map((b) => b.name);
        log(`${label} MSG[assistant] tools=${tools.join(",") || "-"} usage=${u ? JSON.stringify({ in: u.input_tokens, cacheRead: u.cache_read_input_tokens, out: u.output_tokens }) : "NONE"}`);
        if (onMessage) await onMessage(msg, q, input);
        continue;
      }
      if (msg.type === "user") {
        log(`${label} MSG[user] isReplay=${msg.isReplay ?? "absent"} uuid=${msg.uuid === seedMessage.uuid ? "seed" : msg.uuid?.slice(0, 8) ?? "NONE"}`);
        if (onMessage) await onMessage(msg, q, input);
        if (onClose?.(msg, input)) { input.close(); log(`${label} CLOSE_INPUT`); }
        continue;
      }
      if (msg.type === "result") {
        log(`${label} MSG[result] subtype=${msg.subtype} cost_usd=${msg.total_cost_usd} usage=${JSON.stringify(msg.usage ?? null).slice(0, 200)}`);
        if (onMessage) await onMessage(msg, q, input);
        if (onClose?.(msg, input)) { input.close(); log(`${label} CLOSE_INPUT`); }
        continue;
      }
      log(`${label} MSG[${msg.type}${msg.subtype ? ":" + msg.subtype : ""}] ${JSON.stringify(msg).slice(0, 120)}`);
      if (onMessage) await onMessage(msg, q, input);
    }
    ended = true;
    log(`${label} STREAM_ENDED`);
    return { q, ended: true };
  } catch (e) {
    ended = true;
    log(`${label} ERROR ${String(e?.stack || e).slice(0, 400)}`);
    return { q, ended: false };
  } finally {
    clearTimeout(watchdog);
  }
}

if (scenario === "c1") {
  let toolAsks = 0;
  let parkedAt = 0;
  const canUseTool = async () => {
    toolAsks++;
    if (toolAsks === 2) {
      // The park window: hold the permission decision; fire the out-of-band context call.
      parkedAt = Date.now();
      log(`c1 PARK_START toolAsk#${toolAsks} holding 6000ms`);
      void probeContext(lastQuery, "mid-park");
      await new Promise((r) => setTimeout(r, 6000));
      log(`c1 PARK_END toolAsk#${toolAsks}`);
    }
    return { behavior: "allow" };
  };
  let lastQuery = null;
  let reads = 0;
  let ctxFailures = 0;
  await runLeg({
    label: "c1",
    seed: C1_SEED,
    canUseTool,
    onClose: (msg) => msg.type === "result", // streaming mode: close at the final result
    onMessage: async (msg, q) => {
      lastQuery = q;
      if (msg.type === "assistant" || msg.type === "user" || msg.type === "result") {
        reads++;
        const ok = await probeContext(q, `msg#${reads}:${msg.type}`);
        if (!ok) ctxFailures++;
      }
    },
  });
  log(`c1 SUMMARY contextReads=${reads} failures=${ctxFailures}`);
}

if (scenario === "c2") {
  // Leg 1 — a small tool drive; capture the session id + its terminal cost figure.
  let leg1 = { session: null, cost: null, usage: null };
  await runLeg({
    label: "c2-leg1",
    seed: "Run `sleep 3` once with the Bash tool, then reply exactly LEG1DONE.",
    canUseTool: async () => ({ behavior: "allow" }),
    onClose: (msg) => msg.type === "result",
    onMessage: async (msg, q) => {
      if (msg.type === "system" && msg.subtype === "init") leg1.session = msg.session_id;
      if (msg.type === "result") {
        leg1.cost = msg.total_cost_usd;
        leg1.usage = msg.usage ?? null;
        await probeContext(q, "leg1-final");
      }
    },
  });
  log(`c2 LEG1 session=${leg1.session} cost_usd=${leg1.cost} usage=${JSON.stringify(leg1.usage).slice(0, 200)}`);

  // Leg 2 — resume the SAME session; a mid-turn note forces a SECOND result within the
  // leg, so one run measures both the across-leg jump and the within-leg step.
  let results2 = 0;
  let notePushed = false;
  const note = userMsg("Operator note: acknowledge briefly, then reply exactly STEERED.");
  await runLeg({
    label: "c2-leg2",
    seed: "Run `sleep 2` once with the Bash tool, then reply exactly LEG2DONE.",
    resume: leg1.session,
    canUseTool: async () => ({ behavior: "allow" }),
    onClose: (msg) => {
      // close after the final result: results > 1 means the note's turn already ran
      if (msg.type !== "result") return false;
      results2++;
      return results2 > 1 || notePushed === false;
    },
    onMessage: async (msg, q, input) => {
      if (msg.type === "assistant" && !notePushed && msg.message?.content?.some((b) => b.type === "tool_use")) {
        notePushed = true;
        input.push(note);
        log("c2-leg2 NOTE_PUSH (mid-turn)");
      }
      if (msg.type === "system" && msg.subtype === "init") await probeContext(q, "leg2-init");
      if (msg.type === "result") await probeContext(q, `leg2-result#${results2 + 1}`);
    },
    watchdogMs: 60000,
  });
  log(`c2 SUMMARY leg1=${leg1.cost} session=${leg1.session}`);
}

writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`${scenario} -> ${outPath}`);
