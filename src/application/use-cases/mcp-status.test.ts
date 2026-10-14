// use-cases/mcp-status.test.ts — A-380/A-381 on Docket's own MCP standing: the view is the
// control's state plus the server's own tool-name constants and the roles that opted out (R-81),
// names only; restore calls restart() once, answers the new status, keeps each typed error, and a
// second call after success is a no-op that answers ok.
import { describe, expect, it } from 'vitest';

import { createFakeDefinitionStore, createFakeMcpListenerControl, type FakeDefinitionStore, type FakeMcpListenerControl } from '../ports/fakes';
import { DOCKET_TOOL_DEFINITIONS_BY_KIND } from '../services/docket-tools';
import { mcpStatusView, restoreMcpListener } from './mcp-status';

const roleBody = (id: string, docketTools?: boolean): string =>
  JSON.stringify({ id, name: id, instructions: '', writeScope: { kind: 'none' }, capabilities: [], ...(docketTools === undefined ? {} : { docketTools }) });

const depsOf = (control: FakeMcpListenerControl, definitions: FakeDefinitionStore) => ({ mcpListener: control, definitions });

describe('A-380: mcp.status', () => {
  it('A-380: a running listener answers state running with the per-kind tool names and no reason', async () => {
    const view = await mcpStatusView(depsOf(createFakeMcpListenerControl(), createFakeDefinitionStore()));
    expect(view.state).toBe('running');
    expect(view.reason).toBeUndefined();
    expect(view.tools.run).toEqual(DOCKET_TOOL_DEFINITIONS_BY_KIND.run.map((tool) => tool.name));
    expect(view.tools.chat).toEqual(DOCKET_TOOL_DEFINITIONS_BY_KIND.chat.map((tool) => tool.name));
    // Names only: the run kind's page tools and the chat kind's read tools are both there.
    expect(view.tools.run).toContain('page_publish');
    expect(view.tools.chat).toContain('docket_get');
    expect(view.rolesWithout).toEqual([]);
    expect(Object.keys(view).sort()).toEqual(['rolesWithout', 'state', 'tools']);
  });

  it.each(['no_endpoint', 'listener_down', 'script_missing'] as const)(
    'A-380: a stopped listener passes its reason through (%s)',
    async (reason) => {
      const view = await mcpStatusView(depsOf(createFakeMcpListenerControl({ state: 'stopped', reason }), createFakeDefinitionStore()));
      expect(view).toMatchObject({ state: 'stopped', reason });
      expect(view.tools.run.length).toBeGreaterThan(0);
    },
  );

  it('A-380: the roles whose current library version opted out are listed by id, latest version decides', async () => {
    const definitions = createFakeDefinitionStore();
    definitions.seed('library/roles/kapali/v1.yaml', roleBody('kapali', false));
    definitions.seed('library/roles/kapali/v2.yaml', roleBody('kapali', true));
    definitions.seed('library/roles/sessiz/v1.yaml', roleBody('sessiz', false));
    definitions.seed('library/roles/acik/v1.yaml', roleBody('acik', true));
    definitions.seed('library/roles/bilinmez/v1.yaml', roleBody('bilinmez'));
    const view = await mcpStatusView(depsOf(createFakeMcpListenerControl(), definitions));
    expect(view.rolesWithout).toEqual(['sessiz']);
  });
});

describe('A-381: mcp.restore', () => {
  it('A-381: success calls restart once and answers the new status', async () => {
    const control = createFakeMcpListenerControl({ state: 'stopped', reason: 'listener_down' });
    const restored = await restoreMcpListener(depsOf(control, createFakeDefinitionStore()));
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.value.state).toBe('running');
    expect(control.restarts()).toBe(1);
  });

  it.each(['endpoint_unavailable', 'listener_failed', 'script_missing'] as const)(
    'A-381: a restart refusal keeps its typed error (%s)',
    async (error) => {
      const control = createFakeMcpListenerControl({ state: 'stopped', reason: 'listener_down' });
      control.failWith(error);
      const restored = await restoreMcpListener(depsOf(control, createFakeDefinitionStore()));
      expect(restored).toStrictEqual({ ok: false, error });
    },
  );

  it('A-381: a second restore after success is a no-op that answers ok', async () => {
    const control = createFakeMcpListenerControl({ state: 'stopped', reason: 'listener_down' });
    const first = await restoreMcpListener(depsOf(control, createFakeDefinitionStore()));
    const second = await restoreMcpListener(depsOf(control, createFakeDefinitionStore()));
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.state).toBe('running');
    expect(control.restarts()).toBe(1);
  });

  it('A-381: the answered status re-reads the roles too, not only the listener', async () => {
    const definitions = createFakeDefinitionStore();
    definitions.seed('library/roles/sessiz/v1.yaml', roleBody('sessiz', false));
    const control = createFakeMcpListenerControl({ state: 'stopped', reason: 'listener_down' });
    const restored = await restoreMcpListener(depsOf(control, definitions));
    if (!restored.ok) throw new Error('restore must succeed');
    expect(restored.value.rolesWithout).toEqual(['sessiz']);
  });
});
