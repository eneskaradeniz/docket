// stores/settings-cards.ts — which Hesaplar sections stand open. The operator's own toggle (a
// boolean override) always wins; without one, Eklenenler is open and Eklenmemiş opens only while
// nothing is added yet, because then it holds the only useful action on the page.
export const addedOpen = (override: boolean | null): boolean => override ?? true;

export const unaddedOpen = (addedCount: number, override: boolean | null): boolean => override ?? addedCount === 0;
