// Public API of domain/providers — see docs/v2/domain.md section 11.
export * from './capabilities';
export * from './agent-event';
export * from './fold-run';
export * from './capability';
export * from './catalog';
export * from './provider-matrix';
// Both agent-event and capability carry a CostKind, and a barrel cannot export the name twice.
// The barrel name stays the event-level union (without 'none') that the event types and their
// consumers annotate with; the route-level union including 'none' is exported by the capability
// module itself and travels inside RouteKindRecord. This explicit re-export keeps the two stars
// from colliding.
export type { CostKind } from './agent-event';
