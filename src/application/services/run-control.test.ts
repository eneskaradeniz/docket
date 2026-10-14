// services/run-control.test.ts — the live-handle registry behind `run.stop` / `run.steer`
// (A-361 … A-364 of docs/v2/application.md, #1110). The executor's lifetime wiring — attach
// after the successful transport start, detach on every end path — is what every answer derives
// from: a detached run is `not_active`, an id this process never attached is `not_found`, a
// stop reaches the handle exactly once per run, and a note is validated before anything is
// forwarded.
import { describe, expect, it } from 'vitest';

import type { RunId } from '../../domain/index';
import { parseUlid } from '../../domain/index';

import { STEER_NOTE_MAX_CHARS, createRunControl, type RunControlHandle } from './run-control';

const runOf = (input: string): RunId => {
  const parsed = parseUlid<'run'>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const RUN_A = runOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const RUN_B = runOf('01ARZ3NDEKTSV4RRFFQ69G5FA2');

/** A handle that records what reached it; the executor attaches the transport's own handle,
 *  so the recording stands in for the transport's stop/steer side. */
const recordingHandle = (): RunControlHandle & {
  readonly stops: () => number;
  readonly notes: () => readonly string[];
} => {
  let stops = 0;
  const notes: string[] = [];
  return {
    stop: async () => {
      stops += 1;
    },
    steer: (note) => {
      notes.push(note);
    },
    stops: () => stops,
    notes: () => [...notes],
  };
};

describe('run control registry', () => {
  it('A-361: active() lists exactly the attached runs; a detached run answers not_active', () => {
    const control = createRunControl();
    const handle = recordingHandle();
    expect(control.active()).toEqual([]);

    control.attach(RUN_A, handle);
    control.attach(RUN_B, recordingHandle());
    expect(control.active()).toEqual([RUN_A, RUN_B]);

    control.detach(RUN_A);
    expect(control.active()).toEqual([RUN_B]);
    expect(control.stop(RUN_A)).toEqual({ ok: false, error: 'not_active' });
    expect(control.steer(RUN_A, 'note')).toEqual({ ok: false, error: 'not_active' });
  });

  it('A-361: an id this process never attached is not_found — the registry is process-local', () => {
    const first = createRunControl();
    first.attach(RUN_A, recordingHandle());
    first.detach(RUN_A);

    // A relaunch is a fresh registry: the previous process's run is as unknown as any other id.
    const relaunched = createRunControl();
    expect(relaunched.stop(RUN_A)).toEqual({ ok: false, error: 'not_found' });
    expect(relaunched.steer(RUN_A, 'note')).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-362: stop reaches the handle exactly once and answers ok with the run id', async () => {
    const control = createRunControl();
    const handle = recordingHandle();
    control.attach(RUN_A, handle);

    expect(control.stop(RUN_A)).toEqual({ ok: true, value: RUN_A });
    // The executor's end path has not detached yet, so a repeated command is the ok no-op.
    expect(control.stop(RUN_A)).toEqual({ ok: true, value: RUN_A });
    await Promise.resolve();
    expect(handle.stops()).toBe(1);
  });

  it('A-364: a note is trimmed and forwarded; empty, whitespace-only and oversized notes are bad_input', () => {
    const control = createRunControl();
    const handle = recordingHandle();
    control.attach(RUN_A, handle);

    expect(control.steer(RUN_A, '  kısa bir not  ')).toEqual({ ok: true, value: RUN_A });
    expect(handle.notes()).toEqual(['kısa bir not']);

    expect(control.steer(RUN_A, '')).toEqual({ ok: false, error: 'bad_input' });
    expect(control.steer(RUN_A, '   \n\t ')).toEqual({ ok: false, error: 'bad_input' });
    expect(control.steer(RUN_A, 'x'.repeat(STEER_NOTE_MAX_CHARS + 1))).toEqual({ ok: false, error: 'bad_input' });
    // The bound itself passes — the cap is inclusive.
    expect(control.steer(RUN_A, 'x'.repeat(STEER_NOTE_MAX_CHARS))).toEqual({ ok: true, value: RUN_A });
    expect(handle.notes()).toHaveLength(2);
  });

  it('A-364: bad_input wins before any lookup — an unknown id with an empty note is still bad_input', () => {
    const control = createRunControl();
    expect(control.steer(RUN_B, '')).toEqual({ ok: false, error: 'bad_input' });
  });
});
