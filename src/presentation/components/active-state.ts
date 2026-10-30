// components/active-state.ts — the one active-state language every "current" item of the title
// bar and the sidebar speaks: a raised ground plus a 1px bord border at the row's own radius,
// never an inset bar. The soft variant — a selected repo's parent project — swaps the bord
// border for a hairline and keeps the raised ground. Selection is neutral (U-373); both read
// their colours from the theme tokens only, so the dark and the light theme carry the same
// grammar.
/** The current item: raised ground, 1px bord border. */
export const ACTIVE_CLASS = 'bg-raised border border-bord';
/** The softly current item (a selected repo's parent project): raised ground, hairline border. */
export const ACTIVE_SOFT_CLASS = 'bg-raised border border-hairline';
