// components/counted-label.ts — a section header's label joined to its item count. Absent at
// zero: an empty section never counts out loud.
export const countedLabel = (label: string, count: number): string =>
  count > 0 ? `${label} · ${count}` : label;
