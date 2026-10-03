// components/segmented-control.tsx — one segment control for every pick-one setting (Dil, Tema, a
// role's work style, a role's chain mode): equal-height segments in one bordered group, the
// current one raised and set in ink, sans throughout. An optional trailing `standing` shows a
// state that is not a choice (a role's "Özel") as a selected-looking, inert segment.
export interface SegmentOption<T extends string> {
  readonly id: T;
  readonly text: string;
  readonly hint?: string;
}

export interface SegmentedControlProps<T extends string> {
  readonly options: readonly SegmentOption<T>[];
  readonly value: T | null;
  readonly label: string;
  readonly onPick: (id: T) => void;
  /** A further, non-clickable standing: selected-looking, aria-disabled. */
  readonly standing?: string;
}

export function SegmentedControl<T extends string>({ options, value, label, onPick, standing }: SegmentedControlProps<T>) {
  return (
    <div role="group" aria-label={label} className="inline-flex overflow-hidden rounded-control border border-bord">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onPick(option.id)}
          className={`px-2.5 py-1 text-[12.5px] ${value === option.id ? 'bg-raised font-semibold text-ink' : 'text-inkdim hover:text-ink'}`}
        >
          {option.text}
          {option.hint !== undefined ? <span className="ml-1 text-[10.5px] text-inkdim">{option.hint}</span> : null}
        </button>
      ))}
      {standing !== undefined ? (
        <span aria-disabled="true" className="bg-raised px-2.5 py-1 text-[12.5px] font-semibold text-ink">
          {standing}
        </span>
      ) : null}
    </div>
  );
}
