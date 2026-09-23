// src/core/gate-config.ts — the LOCAL GATE's declaration, parsed pure-side (WO-0089).
//
// The declaration home is the decision store's `.workflow/workspace.yaml` — ADR-0003/ADR-0009's
// documented versioned config, which had NO runtime reader (a ROADMAP "Later" concept). This
// module reads exactly ONE section of it, `gate:`, and never the rest: a whole-file config
// reader is scope creep (the order's open question, settled small). Pure text → struct, no I/O,
// no yaml dependency (the roadmap-md/order-md idiom: sibling document parsers own their rules).
//
// The parse is all-or-nothing per the roadmap-md rule: a `gate:` section that cannot be read is
// INVALID with a named reason — never silently undeclared. An unread declaration must not open
// the hole this work order exists to close (the antreo case: a self-reported gate is not
// evidence; an ignored one is worse). Unknown TOP-LEVEL keys are ignored (forward-compat with
// the future config reader); unknown keys INSIDE the gate section are invalid — strict, never
// guessing at an operator's gate.
//
// Shape (the order's lean — a named list, each entry a command plus an expected exit):
//   gate:
//     commands:
//       - command: npm test
//         expect_exit: 0

/** One declared gate command. `expectExit` defaults to 0 (success). */
export interface GateCommandSpec {
  command: string;
  expectExit: number;
}

/**
 * The workspace's local-gate declaration. `undeclared` (no gate section — the default for every
 * workspace today) and `declared` are the two healthy arms; `invalid` is a declaration whose
 * text cannot be read — it behaves as NEVER-PASSING wherever it gates (unknown, ADR-0010),
 * never as exempt.
 */
export type GateConfig =
  | { kind: 'undeclared' }
  | { kind: 'declared'; commands: GateCommandSpec[] }
  | { kind: 'invalid'; reason: string };

const INVALID = (reason: string): GateConfig => ({ kind: 'invalid', reason });

/** Parse the workspace.yaml text's `gate:` section. Never throws; '' is undeclared. */
export function parseGateConfig(text: string): GateConfig {
  const lines = (text ?? '').split(/\r?\n/);
  // The section starts at a TOP-LEVEL `gate:` line (no indentation) and ends at the next
  // top-level key. Blank and comment lines are skipped everywhere.
  const start = lines.findIndex((l) => /^gate:\s*$/.test(l));
  if (start === -1) return { kind: 'undeclared' };
  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i]!;
    if (/^\S/.test(l)) break; // the next top-level key ends the section
    const t = l.trim();
    if (t === '' || t.startsWith('#')) continue;
    body.push(t);
  }
  if (body.length === 0) return INVALID('gate: no commands key under it');
  const head = body[0]!;
  const commandsMatch = /^commands:\s*(.*)$/.exec(head);
  if (!commandsMatch) return INVALID(`gate: expected 'commands:', found '${head.split(':')[0]}'`);
  // An inline empty list (`commands: []`) or an empty block — both vacuous, both refused: a
  // pass with zero measurements is the hole this work order closes, not a gate.
  if (commandsMatch[1] !== '') {
    if (commandsMatch[1] === '[]') return INVALID('gate.commands: empty — a gate with no commands passes nothing');
    return INVALID(`gate.commands: '${commandsMatch[1]}' is not a list (write '- command: …' entries)`);
  }
  const entries = body.slice(1);
  if (entries.length === 0) return INVALID('gate.commands: empty — a gate with no commands passes nothing');
  const commands: GateCommandSpec[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const commandMatch = /^-\s*command:(.*)$/.exec(entry);
    if (!commandMatch) return INVALID(`gate.commands[${i}]: expected '- command: …', found '${entry.slice(0, 40)}'`);
    const command = commandMatch[1]!.trim();
    if (command === '') return INVALID(`gate.commands[${i}]: empty command`);
    let expectExit = 0;
    const next = entries[i + 1];
    if (next !== undefined && !next.startsWith('-')) {
      const expectMatch = /^expect_exit:\s*(.*)$/.exec(next);
      if (!expectMatch) return INVALID(`gate.commands[${i}]: unknown key '${next.split(':')[0]}' (only command + expect_exit are read)`);
      if (!/^-?\d+$/.test(expectMatch[1]!.trim())) return INVALID(`gate.commands[${i}].expect_exit: not an integer ('${expectMatch[1]!.trim()}')`);
      expectExit = Number(expectMatch[1]!.trim());
      i++; // the expect_exit line is consumed by this entry
    }
    commands.push({ command, expectExit });
  }
  return { kind: 'declared', commands };
}
