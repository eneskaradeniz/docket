// The README matrix rows built from the capability registry (P-36), plus the marker block the
// generator script rewrites. Provider display names come from the builtin definitions, joined by
// provider id; an id without a definition shows the id itself. Every provider record gets a row —
// one per route kind, in registry order; a provider without route kinds keeps one row with
// placeholders in the route columns, so the table lists the whole record, not only routed ones.
import type {
  CapabilityRegistry,
  EffortLevel,
  MatrixRow,
  ModelRecord,
  ProviderRecord,
  RouteKindRecord,
} from '../../../domain/index';
import { renderProviderMatrix, supportLevel, thinkingOptions } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS } from '../defs/index';
import { CAPABILITY_REGISTRY } from './capability-registry';

export const PROVIDER_MATRIX_START = '<!-- provider-matrix:start -->';
export const PROVIDER_MATRIX_END = '<!-- provider-matrix:end -->';

const NO_VALUE = '—';

const displayNameOf = (providerId: string): string => {
  const def = BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === providerId);
  return def === undefined ? providerId : `${def.displayName} (\`${providerId}\`)`;
};

// Retired models stay in the registry so old records still render, but they are hidden from new
// accounts — the matrix advertises what can be picked today, so they are left out here too.
const activeModels = (models: readonly ModelRecord[]): readonly ModelRecord[] =>
  models.filter((model) => model.retired !== true);

const modelsCell = (models: readonly ModelRecord[]): string => {
  const active = activeModels(models);
  if (active.length === 0) return NO_VALUE;
  return active.map((model) => `\`${model.id}\` (${model.tier})`).join(', ');
};

// Distinct levels in first-appearance order over the registry's model order: the data stores
// levels ascending, so the result is stable without duplicating the canonical order table here.
const thinkingCell = (models: readonly ModelRecord[]): string => {
  const levels: EffortLevel[] = [];
  for (const model of activeModels(models)) {
    for (const level of thinkingOptions(model)) {
      if (!levels.includes(level)) levels.push(level);
    }
  }
  if (levels.length === 0) return NO_VALUE;
  return levels.map((level) => `\`${level}\``).join(', ');
};

const formatTokens = (tokens: number): string => {
  if (tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
  if (tokens % 1_000 === 0) return `${tokens / 1_000}k`;
  return String(tokens);
};

const contextCell = (models: readonly ModelRecord[]): string => {
  const windows = [
    ...new Set(
      activeModels(models).flatMap((model) => (model.contextWindow === undefined ? [] : [model.contextWindow])),
    ),
  ].sort((a, b) => a - b);
  if (windows.length === 0) return NO_VALUE;
  return windows.map(formatTokens).join(' / ');
};

const rowOf = (provider: ProviderRecord, route: RouteKindRecord): MatrixRow => ({
  provider: displayNameOf(provider.providerId),
  routeKind: `\`${route.id}\``,
  models: modelsCell(route.models),
  thinking: thinkingCell(route.models),
  context: contextCell(route.models),
  cost: route.costKind,
  level: supportLevel(provider),
});

export function buildProviderMatrixRows(registry: CapabilityRegistry): readonly MatrixRow[] {
  const rows: MatrixRow[] = [];
  for (const provider of registry.providers) {
    const routes = registry.routeKinds.filter((route) => route.providerId === provider.providerId);
    if (routes.length === 0) {
      rows.push({
        provider: displayNameOf(provider.providerId),
        routeKind: NO_VALUE,
        models: NO_VALUE,
        thinking: NO_VALUE,
        context: NO_VALUE,
        cost: NO_VALUE,
        level: supportLevel(provider),
      });
      continue;
    }
    for (const route of routes) rows.push(rowOf(provider, route));
  }
  return rows;
}

export function renderRegistryMatrix(registry: CapabilityRegistry = CAPABILITY_REGISTRY): string {
  return renderProviderMatrix(buildProviderMatrixRows(registry));
}
