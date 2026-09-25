// src/adapters/cli-runner/defs/codex.test.ts — the codex parser pinned against MEASURED lines
// (docs/probes/codex-cli/raw/exec-unauth.log, codex-cli 0.157.0 — the auth-failure stream) and
// the documented event union (the vendor SDK's events.ts/items.ts). The fixture lines are
// byte-shape-true; values adjusted only where the unauthenticated stream could not carry them
// (turn.completed usage, real item payloads — the shapes come from the SDK types the binary
// emits, and the authenticated probe re-verifies them before wiring flips).
import { describe, expect, it } from 'vitest';
import type { RunnerEvent } from '../../../core/runner';
import type { CliParseState } from '../def';
import { CODEX_PROBE_PASSED, codexDef } from './codex';

const parse = (line: string, state: CliParseState = {}): RunnerEvent[] => codexDef.parseLine(line, state);

describe('codexDef.parseLine — the measured/documented event union', () => {
  it('thread.started yields `started` carrying the thread id (the capture-style resume handle)', () => {
    const st: CliParseState = {};
    expect(parse('{"type":"thread.started","thread_id":"01a0d9f2-3dc7-7462-9a7b-84966812c714"}', st)).toEqual([
      { kind: 'started', sessionId: '01a0d9f2-3dc7-7462-9a7b-84966812c714' },
    ]);
    expect(st.sessionId).toBe('01a0d9f2-3dc7-7462-9a7b-84966812c714');
  });

  it('the reconnect `error` noise maps to NOTHING (turn.failed / the engine exit carry the truth)', () => {
    const measured =
      '{"type":"error","message":"Reconnecting... 2/5 (unexpected status 401 Unauthorized: Missing bearer or basic authentication in header, url: wss://api.openai.com/v1/responses)"}';
    expect(parse(measured)).toEqual([]);
    expect(parse('{"type":"turn.started"}')).toEqual([]);
  });

  it('turn.failed (MEASURED, the unauth terminal) yields the error event with its message', () => {
    const measured =
      '{"type":"turn.failed","error":{"message":"unexpected status 401 Unauthorized: Missing bearer or basic authentication in header"}}';
    expect(parse(measured)).toEqual([
      { kind: 'error', message: 'unexpected status 401 Unauthorized: Missing bearer or basic authentication in header' },
    ]);
  });

  it('item.completed agent_message → assistant_text; the LAST one becomes the turn result', () => {
    const st: CliParseState = {};
    parse('{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"draft thinking"}}', st);
    parse('{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"final word"}}', st);
    expect((st as { lastAgentMessage?: string }).lastAgentMessage).toBe('final word');
    const done = parse('{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":80,"cache_write_input_tokens":10,"output_tokens":5,"reasoning_output_tokens":2}}', st);
    expect(done).toEqual([
      {
        kind: 'turn_complete',
        stopReason: 'end',
        cost: { usd: 0, tokensIn: 120, tokensOut: 5 }, // tokens verbatim, NO invented price
        usage: { cacheRead: 80, cacheCreation: 10 },
        result: 'final word',
      },
    ]);
  });

  it('a zero cache split carries no usage key at all (absent, never zeros-as-claim)', () => {
    expect(parse('{"type":"turn.completed","usage":{"input_tokens":9,"output_tokens":1}}')).toEqual([
      { kind: 'turn_complete', stopReason: 'end', cost: { usd: 0, tokensIn: 9, tokensOut: 1 } },
    ]);
  });

  it('command_execution → the use/result pair, post-hoc (command + aggregated output together)', () => {
    const out = parse(
      '{"type":"item.completed","item":{"id":"item_2","type":"command_execution","command":"rg TODO src","aggregated_output":"src/a.ts:1 TODO","exit_code":0,"status":"completed"}}',
    );
    expect(out).toEqual([
      { kind: 'tool_use', callId: 'item_2', tool: 'command_execution', input: { command: 'rg TODO src' } },
      { kind: 'tool_result', callId: 'item_2', summary: 'src/a.ts:1 TODO', isError: false },
    ]);
    const failed = parse(
      '{"type":"item.completed","item":{"id":"item_3","type":"command_execution","command":"make","aggregated_output":"boom","exit_code":2,"status":"failed"}}',
    );
    expect(failed[1]).toMatchObject({ kind: 'tool_result', isError: true });
  });

  it('file_change → the pair with the change list; mcp_tool_call names server/tool', () => {
    const fc = parse(
      '{"type":"item.completed","item":{"id":"i","type":"file_change","changes":[{"path":"a.ts","kind":"update"},{"path":"b.ts","kind":"add"}],"status":"completed"}}',
    );
    expect(fc[0]).toMatchObject({ kind: 'tool_use', tool: 'file_change' });
    expect(fc[1]).toMatchObject({ kind: 'tool_result', summary: 'update a.ts, add b.ts', isError: false });
    const mcp = parse(
      '{"type":"item.completed","item":{"id":"m","type":"mcp_tool_call","server":"linear","tool":"create_issue","arguments":{"title":"x"},"status":"completed","result":{"content":[]}}}',
    );
    expect(mcp[0]).toMatchObject({ kind: 'tool_use', tool: 'linear/create_issue', input: { title: 'x' } });
    expect(mcp[1]).toMatchObject({ kind: 'tool_result', isError: false });
  });

  it('garbage, blank and unmapped lines decode to nothing — never a throw', () => {
    expect(parse('')).toEqual([]);
    expect(parse('not json')).toEqual([]);
    expect(parse('[]')).toEqual([]);
    expect(parse('{"type":"item.completed","item":{"id":"r","type":"reasoning","text":"thinking"}}')).toEqual([]);
    expect(parse('{"type":"item.completed","item":{"id":"w","type":"web_search","query":"x"}}')).toEqual([]);
  });
});

describe('codexDef — the spawn grammar (measured flag surface)', () => {
  it('a fresh drive: exec --json, the cwd, the ROLE sandbox, the prompt on stdin', () => {
    expect(codexDef.buildArgs({ role: 'verifier', mode: 'direct', prompt: 'p', cwd: '/w/r' })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-C', '/w/r', '-s', 'read-only', '-',
    ]);
    expect(codexDef.buildArgs({ role: 'implementer', mode: 'direct', prompt: 'p', cwd: '/w/r' })).toContain('workspace-write');
    expect(codexDef.buildArgs({ role: 'architect', mode: 'plan', prompt: 'p', cwd: '/w/r' })).toContain('workspace-write');
    expect(codexDef.promptViaStdin).toBe(true);
  });

  it('the model preference rides -m; resume rides `exec resume` WITHOUT -C/-s (the thread carries them)', () => {
    expect(codexDef.buildArgs({ role: 'implementer', mode: 'direct', prompt: 'p', model: 'm-x', cwd: '/w' })).toEqual([
      'exec', '--json', '--skip-git-repo-check', '-C', '/w', '-s', 'workspace-write', '--model', 'm-x', '-',
    ]);
    expect(codexDef.buildArgs({ role: 'verifier', mode: 'direct', prompt: 'p', model: 'm-x', resume: 'th-9', cwd: '/w' })).toEqual([
      'exec', 'resume', '--json', '--model', 'm-x', 'th-9', '-',
    ]);
  });

  it('classifyError covers the measured + documented failure families', () => {
    expect(codexDef.classifyError?.('Not logged in')).toBe('auth_missing');
    expect(codexDef.classifyError?.('unexpected status 401 Unauthorized')).toBe('auth_failed');
    expect(codexDef.classifyError?.('429 rate limit exceeded')).toBe('rate_limited');
    expect(codexDef.classifyError?.('request timed out after 30s')).toBe('timeout');
    expect(codexDef.classifyError?.('something else')).toBeUndefined();
  });

  it('the auth probe classifies both measured states of login status', () => {
    const p = codexDef.authProbe!.parse;
    expect(p('Not logged in\n', 0)).toEqual({ ok: false, code: 'auth_missing', message: 'codex: not logged in' });
    expect(p('Logged in using ChatGPT\n', 0)).toEqual({ ok: true, source: 'ChatGPT' });
    expect(p('weird future shape', 0)).toBeUndefined();
  });

  it('NO model options are claimed (none verified) and the probe gate pins pending', () => {
    expect(codexDef.modelOptions).toBeUndefined();
    expect(CODEX_PROBE_PASSED).toBe(false); // flip ONLY with docs/probes/codex-cli PASS in hand
  });
});
