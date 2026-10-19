// Rules R-168, R-170 and R-191 of docs/v2/domain.md autonomy addendum: decidePermission, the
// axis-1 permission policy behind D-10's split 2b. The risk table (./risk.test.ts) answers what
// is low; this file answers who may decide it.
import { describe, expect, it } from 'vitest';

import { AUTONOMY_LEVELS, USER_ONLY_GATES, parseSlug } from '../shared';

import { PERMISSION_RULES_POLICY, decidePermission, type RiskAsk, type RiskContext } from './index';

const CONTEXT: RiskContext = { worktreeRoot: '/wt', cwd: '/wt', verificationCommands: [] };

/** The ask the table rates low: Docket's own read tool, low by name alone. */
const LOW_ASK: RiskAsk = { kind: 'tool', tool: 'docket_get' };
/** The ask the table sends to the human: a destructive command. */
const HIGH_ASK: RiskAsk = { kind: 'tool', tool: 'Bash', arguments: { command: 'rm -rf build' } };
/** The run's own page publish ask (R-191), bare and as the pages server spells it. */
const PUBLISH_ASK: RiskAsk = { kind: 'tool', tool: 'page_publish' };
const PUBLISH_MCP_ASK: RiskAsk = { kind: 'tool', tool: 'mcp__docket-pages__page_publish' };
const UPDATE_ASK: RiskAsk = { kind: 'tool', tool: 'page_update' };
const UPDATE_MCP_ASK: RiskAsk = { kind: 'tool', tool: 'mcp__docket-pages__page_update' };
const OWN_PAGE_ASKS: readonly RiskAsk[] = [PUBLISH_ASK, PUBLISH_MCP_ASK, UPDATE_ASK, UPDATE_MCP_ASK];

describe('decidePermission', () => {
  it('R-168: a carve-out action asks the human at every level, even when the table would say low', () => {
    for (const level of AUTONOMY_LEVELS) {
      for (const action of USER_ONLY_GATES) {
        expect(decidePermission({ level, ask: LOW_ASK, context: CONTEXT, action })).toEqual({ kind: 'ask-human' });
      }
    }
  });

  it('R-168: PERMISSION_RULES_POLICY parses as a slug', () => {
    const parsed = parseSlug<'policy'>(PERMISSION_RULES_POLICY);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toBe('permission-rules');
  });

  it('R-170: each ask is decided by the level it is resolved under — a later level never rewrites an earlier decision', () => {
    // The same ask shape, resolved once under manual and once under auto: the first decision keeps
    // its effect after the level changes; the second answers the level in force for it.
    const underManual = decidePermission({ level: 'manual', ask: LOW_ASK, context: CONTEXT });
    const underAuto = decidePermission({ level: 'auto', ask: LOW_ASK, context: CONTEXT });
    expect(underManual).toEqual({ kind: 'ask-human' });
    expect(underAuto).toEqual({ kind: 'allow-by-policy', policy: PERMISSION_RULES_POLICY, level: 'auto' });
    expect(decidePermission({ level: 'manual', ask: LOW_ASK, context: CONTEXT })).toEqual(underManual);
  });

  it('manual asks the human for an ask the table rates low', () => {
    expect(decidePermission({ level: 'manual', ask: LOW_ASK, context: CONTEXT })).toEqual({ kind: 'ask-human' });
  });

  it('balanced asks the human for every other low ask — only R-191’s publish row opens to it', () => {
    expect(decidePermission({ level: 'balanced', ask: LOW_ASK, context: CONTEXT })).toEqual({ kind: 'ask-human' });
  });

  it('R-191: the run’s own page publish/update ask is allowed at balanced and auto, bare and prefixed', () => {
    for (const ask of OWN_PAGE_ASKS) {
      expect(decidePermission({ level: 'auto', ask, context: CONTEXT })).toEqual({
        kind: 'allow-by-policy',
        policy: PERMISSION_RULES_POLICY,
        level: 'auto',
      });
      expect(decidePermission({ level: 'balanced', ask, context: CONTEXT })).toEqual({
        kind: 'allow-by-policy',
        policy: PERMISSION_RULES_POLICY,
        level: 'balanced',
      });
    }
  });

  it('R-191: manual still asks the human for the run’s own page publish/update ask', () => {
    for (const ask of OWN_PAGE_ASKS) {
      expect(decidePermission({ level: 'manual', ask, context: CONTEXT })).toEqual({ kind: 'ask-human' });
    }
  });

  it('R-191: publishing is not approving — a page_approval action asks the human at every level even for the publish ask', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(decidePermission({ level, ask: PUBLISH_ASK, context: CONTEXT, action: 'page_approval' })).toEqual({ kind: 'ask-human' });
    }
  });

  it('R-191: every other near name stays with the human at every level — the table never rates it low', () => {
    const nearMisses: readonly RiskAsk[] = [
      { kind: 'tool', tool: 'mcp__other__page_publish' },
      { kind: 'tool', tool: 'page_publish_x' },
      { kind: 'tool', tool: 'propose_memory' },
      { kind: 'tool', tool: 'submit_verdict' },
      { kind: 'tool', tool: 'docket_read_file' },
    ];
    for (const ask of nearMisses) {
      for (const level of AUTONOMY_LEVELS) {
        expect(decidePermission({ level, ask, context: CONTEXT })).toEqual({ kind: 'ask-human' });
      }
    }
  });

  it('auto allows a low ask by the permission rules policy, naming the level in force', () => {
    expect(decidePermission({ level: 'auto', ask: LOW_ASK, context: CONTEXT })).toEqual({
      kind: 'allow-by-policy',
      policy: PERMISSION_RULES_POLICY,
      level: 'auto',
    });
  });

  it('auto asks the human when the table answers needs_human', () => {
    expect(decidePermission({ level: 'auto', ask: HIGH_ASK, context: CONTEXT })).toEqual({ kind: 'ask-human' });
  });

  it('an assistant action asks the human at every level — every class has its own human-reviewed pipeline', () => {
    for (const level of AUTONOMY_LEVELS) {
      expect(decidePermission({ level, ask: { kind: 'assistant_action', actionClass: 'open_work_order' }, context: CONTEXT })).toEqual({
        kind: 'ask-human',
      });
    }
  });

  it('the same inputs always answer the same decision and the inputs are never mutated', () => {
    const ask: RiskAsk = { kind: 'tool', tool: 'Read', arguments: { file_path: '/wt/src/a.ts' } };
    const context: RiskContext = { worktreeRoot: '/wt', cwd: '/wt', verificationCommands: ['npm test'] };
    const first = decidePermission({ level: 'auto', ask, context });
    const second = decidePermission({ level: 'auto', ask, context });
    expect(second).toEqual(first);
    expect(ask).toEqual({ kind: 'tool', tool: 'Read', arguments: { file_path: '/wt/src/a.ts' } });
    expect(context).toEqual({ worktreeRoot: '/wt', cwd: '/wt', verificationCommands: ['npm test'] });
  });

  it('R-184: a run-config ask is denied by policy at every level, never asked of a human', () => {
    const ask: RiskAsk = { kind: 'tool', tool: 'Read', arguments: { file_path: '/data/runs/r/config/token' } };
    const context: RiskContext = { ...CONTEXT, dataDir: '/data' };
    for (const level of AUTONOMY_LEVELS) {
      expect(decidePermission({ level, ask, context })).toEqual({
        kind: 'deny-by-policy',
        policy: PERMISSION_RULES_POLICY,
        level,
        rule: 'deny-run-config',
      });
    }
    // Without the data dir the ask is judged as before.
    expect(decidePermission({ level: 'auto', ask, context: CONTEXT })).toEqual({ kind: 'ask-human' });
  });
});
