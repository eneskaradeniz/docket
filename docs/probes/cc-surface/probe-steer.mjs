// WO-0045 — steering surface probe (streamInput queue / interrupt receipt / cancel).
//
// Sibling of probe.mjs for scenarios that need an INLINE AsyncIterable<SDKUserMessage>
// prompt plus control-request calls (interrupt(), cancelAsyncMessage()) — neither is
// JSON-configurable, same reason probe-hooks.mjs exists. Throwaway probe, not app code.
//
// REQUIREMENTS: @anthropic-ai/claude-agent-sdk (measured: 0.3.221, package.json pin);
//   ambient `claude` CLI auth; cwd /tmp/cc-steer-probe (created by the script).
//   canUseTool is attached allow-all in every scenario — Docket always passes one
//   (bidirectional needs), so the probe exercises the same transport mode as the app.
//
// Usage: node probe-steer.mjs <scenario> <out.log> [sessionId]
//   s1  baseline      — one seed message, iterable closed at once: does the stream end
//                       after result 1, and does the seed echo as a user message?
//   s2  mid-turn note — note pushed mid-turn, iterable closed after the FINAL result
//                       (the adapter shape): consumed once at the boundary + uuid echo.
//   s2b late note     — note pushed AFTER result 1 (query idle): does the drain loop
//                       spontaneously run it (a second turn + result 2 — the drive
//                       extension on an IDLE drive), and does closing still end cleanly?
//   s3  two notes     — both pushed mid-turn: coalesced into one turn or two? result
//                       count + per-result cost fields (cumulative?).
//   s4  interrupt     — note queued mid-turn, interrupt() 3s later (still mid-turn):
//                       receipt {still_queued}; session then resumed fresh — did the
//                       queued note survive the process death? (mirror-is-truth.)
//   s4b abort         — note queued mid-turn, AbortController.abort() 3s later
//                       (Docket's Durdur mechanism): how does the stream end, does the
//                       note run?
//   s5  cancel        — two notes; cancel #1 immediately (expect true), cancel #2
//                       after its echo (expect false — already dequeued).
//   s5b cancel-delayed— one note, cancelAsyncMessage 2s AFTER the push (mid-turn,
//                       pre-drain): does a non-immediate cancel land?
//   s6  resume-echo   — resume <sessionId> with a streaming-mode seed: does the seed
//                       echo, do replayed user messages carry isReplay?
//   s7  should-query  — push shouldQuery:false mid-turn: appended without a turn?
//
// Outputs land in raw/sN-*.log; every findings.md claim cites one.
import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";

const [scenario, outPath, resumeId] = process.argv.slice(2);
if (!scenario || !outPath) {
  console.error("usage: node probe-steer.mjs <s1|s2|s2b|s3|s4|s4b|s5|s6|s7> <out.log> [sessionId]");
  process.exit(2);
}
if (scenario === "s6" && !resumeId) {
  console.error("s6 needs the sessionId of a prior run (e.g. s2's)");
  process.exit(2);
}

// --- the push-side input queue the adapter will also need (probe-local copy) ---
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
  /** Remove a not-yet-consumed value (the pre-transport retract window). */
  remove(pred) {
    const i = this.#buf.findIndex(pred);
    if (i < 0) return false;
    this.#buf.splice(i, 1);
    return true;
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

const SEED_SLOW = "Run `sleep 8` once with the Bash tool, then reply with exactly READY.";

mkdirSync("/tmp/cc-steer-probe", { recursive: true });

const cfg = {
  s1:  { seed: SEED_SLOW, close: "immediately", noNotes: true },
  s6:  { seed: "Reply with exactly RESUMED.", close: "final-result", resume: resumeId, noNotes: true },
  s2:  { seed: SEED_SLOW, close: "final-result" },
  s2b: { seed: SEED_SLOW, close: "final-result", pushAfterResult: 1 },
  s3:  { seed: SEED_SLOW, close: "final-result", notes: 2 },
  s4:  { seed: SEED_SLOW, close: "never", interruptAfterPushMs: 3000, resumeAfter: true },
  s4b: { seed: SEED_SLOW, close: "never", abortAfterPushMs: 3000 },
  s5:  { seed: SEED_SLOW, close: "final-result", notes: 2, cancelFirstImmediately: true, cancelSecondAfterEcho: true },
  s5b: { seed: SEED_SLOW, close: "final-result", cancelAfterPushMs: 2000 },
  s7:  { seed: "Reply with exactly DONE.", close: "final-result", shouldQueryNote: true },
}[scenario];
if (!cfg) { console.error(`unknown scenario ${scenario}`); process.exit(2); }

const input = new PushQueue();
const notes = []; // pushed note messages (uuid on each)
const echoUuids = []; // uuids of OUR messages seen back as user echoes
let results = 0;
let sessionId;
let ended = false;

const abortController = new AbortController();
const q = query({
  prompt: input,
  options: {
    cwd: "/tmp/cc-steer-probe",
    permissionMode: "default",
    maxTurns: 6,
    abortController,
    ...(cfg.resume ? { resume: cfg.resume } : {}),
    canUseTool: async () => ({ behavior: "allow" }),
  },
});
log(`SCENARIO ${scenario} CONFIG ${JSON.stringify({ seed: cfg.seed, close: cfg.close, resume: cfg.resume ?? null })}`);

const seedMsg = userMsg(cfg.seed);
input.push(seedMsg);
log(`SEED_PUSH uuid=${seedMsg.uuid}`);
if (cfg.close === "immediately") { input.close(); log("CLOSE_INPUT"); }

let pushed = false;
const pushNotes = () => {
  pushed = true;
  const count = cfg.notes ?? 1;
  for (let i = 1; i <= count; i++) {
    const text = cfg.shouldQueryNote
      ? `Logged-only note ${i} — do not act on this.`
      : `Operator note ${i}: reply with exactly STEERED${count > 1 ? `-${i}` : ""}.`;
    const m = userMsg(text, cfg.shouldQueryNote ? { shouldQuery: false } : {});
    notes.push(m);
    input.push(m);
    log(`NOTE_PUSH ${i}/${count} uuid=${m.uuid} shouldQuery=${cfg.shouldQueryNote ? "false" : "default"}`);
  }
  if (cfg.cancelFirstImmediately) {
    log(`CANCEL_CALL typeof=${typeof q.cancelAsyncMessage} uuid=${notes[0].uuid}`);
    Promise.resolve(q.cancelAsyncMessage?.(notes[0].uuid))
      .then((r) => log(`CANCEL1_RESULT ${JSON.stringify(r)}`))
      .catch((e) => log(`CANCEL1_THREW ${String(e).slice(0, 200)}`));
  }
  if (cfg.interruptAfterPushMs) {
    setTimeout(async () => {
      try {
        const receipt = await q.interrupt();
        log(`INTERRUPT_CALL receipt=${JSON.stringify(receipt)}`);
      } catch (e) { log(`INTERRUPT_THREW ${String(e).slice(0, 200)}`); }
    }, cfg.interruptAfterPushMs);
  }
  if (cfg.cancelAfterPushMs) {
    setTimeout(() => {
      log(`CANCEL_DELAYED_CALL uuid=${notes[0].uuid}`);
      Promise.resolve(q.cancelAsyncMessage?.(notes[0].uuid))
        .then((r) => log(`CANCEL_DELAYED_RESULT ${JSON.stringify(r)}`))
        .catch((e) => log(`CANCEL_DELAYED_THREW ${String(e).slice(0, 200)}`));
    }, cfg.cancelAfterPushMs);
  }
  if (cfg.abortAfterPushMs) {
    setTimeout(() => { abortController.abort(); log("ABORT_CALL"); }, cfg.abortAfterPushMs);
  }
};

// A queued-but-not-yet-drained normal note should still produce a turn; a shouldQuery
// note never will. Used by the close decision.
const awaitingTurn = () => notes.some((n) => !n.shouldQuery && !echoUuids.includes(n.uuid));

try {
  for await (const msg of q) {
    if (msg.type === "system" && msg.subtype === "init") {
      sessionId = msg.session_id;
      log(`MSG[init] session=${msg.session_id} capabilities=${JSON.stringify(msg.capabilities ?? null)}`);
      continue;
    }
    if (msg.type === "user") {
      const c = msg.message?.content;
      const known = msg.uuid === seedMsg.uuid ? "seed" : notes.some((n) => n.uuid === msg.uuid) ? "note" : "no";
      const hasText = typeof c === "string" || (Array.isArray(c) && c.some((b) => b.type === "text"));
      if (msg.uuid && known !== "no") echoUuids.push(msg.uuid);
      log(`MSG[user] uuid=${msg.uuid ?? "NONE"} isReplay=${msg.isReplay ?? "absent"} known=${known} hasText=${hasText} blocks=${Array.isArray(c) ? c.map((b) => b.type).join(",") : "str"}`);
      if (cfg.cancelSecondAfterEcho && msg.uuid === notes[1]?.uuid && !msg.isReplay) {
        try {
          const r = await q.cancelAsyncMessage?.(notes[1].uuid);
          log(`CANCEL_AFTER_ECHO uuid=${notes[1].uuid} result=${JSON.stringify(r)}`);
        } catch (e) { log(`CANCEL_AFTER_ECHO_THREW ${String(e).slice(0, 200)}`); }
      }
      continue;
    }
    if (msg.type === "assistant") {
      const u = msg.message?.usage;
      log(`MSG[assistant] model=${msg.message?.model ?? "?"} usage=${u ? JSON.stringify({in: u.input_tokens, cacheRead: u.cache_read_input_tokens, out: u.output_tokens}) : "NONE"}`);
    }
    if (msg.type === "assistant" && !pushed && !cfg.noNotes && !cfg.pushAfterResult) pushNotes();
    if (msg.type === "result") {
      results++;
      log(`MSG[result#${results}] subtype=${msg.subtype} cost_usd=${msg.total_cost_usd} usage=${JSON.stringify(msg.usage ?? null).slice(0, 160)}`);
      if (cfg.pushAfterResult && results === cfg.pushAfterResult && !pushed) pushNotes();
      if (cfg.close === "after-result-1" && results === 1) { input.close(); log("CLOSE_INPUT"); }
      if (cfg.close === "final-result" && (results > 1 || !awaitingTurn())) { input.close(); log("CLOSE_INPUT"); }
      // watchdog: with input still open a quiet stream never ends — force it after 20s
      setTimeout(() => { if (!ended) { input.close(); log("WATCHDOG_CLOSE"); } }, 20000);
      continue;
    }
    if (msg.type === "command_lifecycle") {
      log(`MSG[command_lifecycle] command_uuid=${msg.command_uuid} state=${msg.state}`);
      continue;
    }
    log(`MSG[${msg.type}${msg.subtype ? ":" + msg.subtype : ""}] ${JSON.stringify(msg).slice(0, 200)}`);
  }
  ended = true;
  log("STREAM_ENDED");
} catch (e) {
  ended = true;
  log(`ERROR ${String(e?.stack || e).slice(0, 400)}`);
}

log(`SUMMARY scenario=${scenario} session=${sessionId ?? "NONE"} results=${results} notePushes=${notes.length} echoes=${JSON.stringify(echoUuids)}`);

// s4: resume the interrupted session fresh — did the queued note survive the process death?
if (cfg.resumeAfter && sessionId) {
  log("--- resume-after-interrupt (fresh query, string prompt) ---");
  try {
    for await (const msg of query({
      prompt: "In one short line: what were you most recently asked to do? Then reply exactly RESUMED.",
      options: { cwd: "/tmp/cc-steer-probe", permissionMode: "default", maxTurns: 2, resume: sessionId, canUseTool: async () => ({ behavior: "allow" }) },
    })) {
      if (msg.type === "assistant" && msg.message?.content) {
        const text = msg.message.content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
        if (text) log(`RESUME_ASSISTANT ${JSON.stringify(text.slice(0, 200))}`);
      }
    }
    log("RESUME_STREAM_ENDED");
  } catch (e) {
    log(`RESUME_ERROR ${String(e?.stack || e).slice(0, 300)}`);
  }
}

writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`scenario ${scenario}: results=${results} echoes=${echoUuids.length}/${notes.length + 1} session=${sessionId ?? "NONE"} -> ${outPath}`);
