// The README provider matrix (P-36): a pure renderer over pre-built rows, so the table text has
// one definition, a stable order and no timestamps. Rows are derived from the capability
// registry in infrastructure — provider names may not appear in the domain — which hands the
// finished cells in and takes back the markdown table.
import type { SupportLevel } from './capability';

export interface MatrixRow {
  readonly provider: string;
  readonly routeKind: string;
  readonly models: string;
  readonly thinking: string;
  readonly context: string;
  readonly cost: string;
  readonly level: SupportLevel;
}

const HEADER = '| Provider | Route kind | Models | Thinking | Context | Cost | Support level |';
const SEPARATOR = '| --- | --- | --- | --- | --- | --- | --- |';

export function renderProviderMatrix(rows: readonly MatrixRow[]): string {
  const lines = [HEADER, SEPARATOR];
  for (const row of rows) {
    lines.push(
      `| ${row.provider} | ${row.routeKind} | ${row.models} | ${row.thinking} | ${row.context} | ${row.cost} | ${row.level} |`,
    );
  }
  return lines.join('\n');
}
