import type { TranscriptEntry } from '../../../core/types';
import { ROLE_LABELS, UI } from '../../data/labels';

// PROVISIONAL shape (AC7 / stop-and-ask gate 3): the entry model is a placeholder until WO-0001 reports.
export function Transcript({ entries }: { entries: TranscriptEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-xs italic text-slate-400">{UI.transcriptEmpty}</p>;
  }
  return (
    <div className="max-h-48 overflow-auto rounded-md border border-slate-200 bg-white p-2">
      <ul className="flex flex-col gap-1.5">
        {entries.map((e, i) => (
          <li key={i} className="text-xs">
            <span className="font-medium text-slate-600">{ROLE_LABELS[e.role]}:</span>{' '}
            <span className="text-slate-700">{e.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
