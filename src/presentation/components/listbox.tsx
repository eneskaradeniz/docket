// components/listbox.tsx — the Listbox (U-41): a button showing the current value and a chevron;
// click or ↓/↑ opens a list of options with a ✓ on the selected one and an "Önerilen" tag on the
// recommended one. Enter picks, Esc or Tab closes (focus returns to the button), an outside click
// closes. The open/close/keyboard rules are the pure `listboxStep` in stores/listbox.ts; this file
// owns the DOM only. One component serves Dil, Tema, "Limit dolunca", the period and the work style.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import { LISTBOX_CLOSED, listboxStep, type ListboxInput, type ListboxState } from '../stores/listbox';

export interface ListboxOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** The "Önerilen" tag. */
  readonly recommended?: boolean;
  /** A small mark before the label (a flag code, a theme swatch). */
  readonly lead?: ReactNode;
}

export interface ListboxProps<V extends string> {
  /** The accessible name of the button and the list. */
  readonly label: string;
  readonly value: V | null;
  readonly options: readonly ListboxOption<V>[];
  readonly onPick: (value: V) => void;
  /** The text of the "Önerilen" tag (from the bundle). */
  readonly recommendedLabel: string;
  /** Shown on the button instead of the selected option's label — a value no option stands for ("Özel"). */
  readonly standing?: string;
  readonly minWidth?: number;
  readonly disabled?: boolean;
}

const Check = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[15px] w-[15px] flex-none" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3.5 8.2 3 3 6-6.4" />
  </svg>
);

const Chevron = ({ open }: { readonly open: boolean }) => (
  <svg
    viewBox="0 0 16 16"
    aria-hidden="true"
    className={`h-3.5 w-3.5 flex-none text-inkdim transition-transform motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m4 6 4 4 4-4" />
  </svg>
);

export function Listbox<V extends string>({ label, value, options, onPick, recommendedLabel, standing, minWidth = 170, disabled = false }: ListboxProps<V>) {
  const [state, setState] = useState<ListboxState>(LISTBOX_CLOSED);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLUListElement>(null);
  const id = useId();
  const found = options.findIndex((option) => option.value === value);
  const selected = Math.max(0, found);
  // A value no option stands for ("no selection") reads as a dash, never as the first option.
  const current = found < 0 ? undefined : options[found];
  const shown = standing ?? current?.label ?? '—';

  const dispatch = (input: ListboxInput): void => {
    const step = listboxStep(state, input, options.length, selected);
    setState(step.state);
    if (step.pick !== null) {
      const picked = options[step.pick];
      if (picked !== undefined) onPick(picked.value);
    }
    if (step.focusButton) button.current?.focus();
  };

  // Focus moves into the list while it is open, so its keys reach the reducer.
  useEffect(() => {
    if (state.open) popup.current?.focus();
  }, [state.open]);

  // An outside click closes without taking focus.
  useEffect(() => {
    if (!state.open) return undefined;
    const onDown = (event: MouseEvent): void => {
      if (root.current !== null && event.target instanceof Node && !root.current.contains(event.target)) setState(LISTBOX_CLOSED);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [state.open]);

  return (
    <div ref={root} className="relative flex-none" data-listbox="" {...(state.open ? { 'data-open': '' } : {})}>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={state.open}
        aria-controls={state.open ? id : undefined}
        aria-label={`${label}: ${shown}`}
        onClick={() => dispatch({ type: 'click-button' })}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            dispatch({ type: 'key', key: event.key });
          }
        }}
        style={{ minWidth }}
        className="flex h-[34px] items-center gap-2 rounded-control border border-bord bg-raised pl-3 pr-2.5 text-left text-[13px] font-semibold text-ink hover:border-inkdim disabled:pointer-events-none disabled:opacity-45"
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {standing === undefined ? current?.lead : null}
          <span className="truncate">{shown}</span>
        </span>
        <Chevron open={state.open} />
      </button>
      {state.open ? (
        <ul
          ref={popup}
          id={id}
          role="listbox"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={(event) => {
            if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Escape', 'Tab'].includes(event.key)) {
              event.preventDefault();
              event.stopPropagation();
              dispatch({ type: 'key', key: event.key });
            }
          }}
          className="absolute right-0 top-[calc(100%+6px)] z-20 m-0 min-w-full list-none rounded-card border border-bord bg-surface p-1 shadow-2xl outline-none"
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              role="option"
              aria-selected={index === found}
              onMouseMove={() => dispatch({ type: 'hover', index })}
              onClick={(event) => {
                event.stopPropagation();
                dispatch({ type: 'click-option', index });
              }}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded-control px-2.5 py-[7px] text-[13px] font-semibold text-ink ${state.active === index ? 'bg-raised' : ''}`}
            >
              <span className={`flex-none text-signal-soft ${index === found ? '' : 'invisible'}`}>
                <Check />
              </span>
              {option.lead}
              <span>{option.label}</span>
              {option.recommended === true ? (
                <span className="ml-3 rounded-control bg-signal/10 px-[7px] py-px text-[11px] font-bold text-signal-soft">{recommendedLabel}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
