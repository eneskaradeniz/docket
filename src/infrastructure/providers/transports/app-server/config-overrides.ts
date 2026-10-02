// Per-run configuration for a CLI whose login lives in its own home: the home stays untouched, so
// the run's MCP servers ride the CLI's documented `-c key=value` override instead of a run-scoped
// config directory. Each value is parsed by the CLI as TOML; a JSON string literal is a valid TOML
// basic string, so quoting goes through JSON.stringify.
import type { WrittenMcpServer } from '../../launch/index';

const tomlString = (value: string): string => JSON.stringify(value);

const tomlInlineTable = (entries: Readonly<Record<string, string>>): string =>
  `{${Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${tomlString(name)}=${tomlString(value)}`)
    .join(',')}}`;

export function mcpConfigOverrideArgs(mcpServers: Readonly<Record<string, WrittenMcpServer>>): readonly string[] {
  const args: string[] = [];
  for (const id of Object.keys(mcpServers).sort()) {
    const server = mcpServers[id];
    if (server === undefined) continue;
    const key = `mcp_servers.${tomlString(id)}`;
    args.push('-c', `${key}.command=${tomlString(server.command)}`);
    args.push('-c', `${key}.args=[${server.args.map(tomlString).join(',')}]`);
    if (Object.keys(server.env).length > 0) args.push('-c', `${key}.env=${tomlInlineTable(server.env)}`);
  }
  return args;
}
