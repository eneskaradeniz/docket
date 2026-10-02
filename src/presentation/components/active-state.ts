// components/active-state.ts — the one active-state language every "current" item of the title
// bar and the sidebar speaks: a raised ground plus a 1px signal border at the row's own radius,
// never an inset signal bar. The soft variant — a selected repo's parent project — swaps the
// signal border for a hairline and keeps the raised ground. Both read their colours from the
// theme tokens only, so the dark and the light theme carry the same grammar.
/** The current item: raised ground, 1px signal border. */
export const ACTIVE_CLASS = 'bg-raised border border-signal';
/** The softly current item (a selected repo's parent project): raised ground, hairline border. */
export const ACTIVE_SOFT_CLASS = 'bg-raised border border-hairline';
