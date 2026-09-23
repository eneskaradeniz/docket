// WO-0089 — the local gate's DECLARATION, parsed pure-side. The home is the decision store's
// `.workflow/workspace.yaml` (ADR-0003/0009's documented file — no runtime reader existed; this
// module reads ONLY its `gate:` section, never the whole config). The parse is all-or-nothing with
// named reasons (the roadmap-md rule): a `gate:` section that cannot be read is INVALID, never
// silently undeclared — an unread declaration must not open the hole this work order closes.
import { describe, expect, it } from 'vitest';
import { parseGateConfig } from '../gate-config';

describe('parseGateConfig — the undeclared arm (no gate section)', () => {
  it('empty text (the file does not exist) is undeclared, not invalid', () => {
    expect(parseGateConfig('')).toEqual({ kind: 'undeclared' });
  });

  it('a workspace.yaml with no gate key is undeclared — other sections are none of ours', () => {
    const yaml = ['repos:', '  - app', 'locale: en', 'gate2: never', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'undeclared' });
  });

  it('an indented gate: key (a nested mapping, not the top-level section) is undeclared', () => {
    expect(parseGateConfig('other:\n  gate:\n    commands:\n')).toEqual({ kind: 'undeclared' });
  });
});

describe('parseGateConfig — the declared arm', () => {
  it('a named command list parses; expect_exit defaults to 0 (the order\'s lean)', () => {
    const yaml = ['gate:', '  commands:', '    - command: npm test', '    - command: npm run typecheck', '      expect_exit: 0', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({
      kind: 'declared',
      commands: [
        { command: 'npm test', expectExit: 0 },
        { command: 'npm run typecheck', expectExit: 0 },
      ],
    });
  });

  it('a non-zero expect_exit is carried verbatim (a gate whose failure IS the expectation is not v1, but the number rides)', () => {
    const yaml = ['gate:', '  commands:', '    - command: grep -r TODO src', '      expect_exit: 1', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'declared', commands: [{ command: 'grep -r TODO src', expectExit: 1 }] });
  });

  it('comment and blank lines inside the section are skipped', () => {
    const yaml = ['# the antreo trio, verbatim', 'gate:', '  # commands run in the drive cwd', '  commands:', '    - command: dart format --set-exit-if-changed .', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'declared', commands: [{ command: 'dart format --set-exit-if-changed .', expectExit: 0 }] });
  });
});

describe('parseGateConfig — the invalid arm (a declaration that cannot be read is never a hole)', () => {
  it('gate: with no commands key under it is invalid', () => {
    expect(parseGateConfig('gate:\n')).toEqual({ kind: 'invalid', reason: expect.stringContaining('commands') });
  });

  it('gate: with an empty commands list is invalid — a vacuous pass is the hole itself', () => {
    expect(parseGateConfig('gate:\n  commands: []\n')).toEqual({ kind: 'invalid', reason: expect.stringContaining('empty') });
  });

  it('gate: with an empty commands block is invalid the same way', () => {
    expect(parseGateConfig('gate:\n  commands:\n')).toEqual({ kind: 'invalid', reason: expect.stringContaining('empty') });
  });

  it('a command entry with no command key is invalid (named)', () => {
    const yaml = ['gate:', '  commands:', '    - cmd: npm test', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'invalid', reason: expect.stringContaining('cmd') });
  });

  it('a blank command is invalid', () => {
    const yaml = ['gate:', '  commands:', '    - command:   ', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'invalid', reason: expect.stringContaining('command') });
  });

  it('a non-integer expect_exit is invalid (named)', () => {
    const yaml = ['gate:', '  commands:', '    - command: npm test', '      expect_exit: zero', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'invalid', reason: expect.stringContaining('expect_exit') });
  });

  it('an unknown key inside the gate section is invalid — strict, no guessing', () => {
    const yaml = ['gate:', '  commands:', '    - command: npm test', '  timeout: 5', ''].join('\n');
    expect(parseGateConfig(yaml)).toEqual({ kind: 'invalid', reason: expect.stringContaining('timeout') });
  });
});
