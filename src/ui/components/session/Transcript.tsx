import type { TranscriptLine } from '../../../core/runner';
import { toolLabel, UI } from '../../data/labels';

// Live transcript (WO-0008) over TranscriptLine. The placeholder entry model from
// WO-0002 is retired here; vendor-neutral tool labels come from labels.ts (ADR-0007).
export function Transcript({ entries }: { entries: TranscriptLine[] }) {
  if (entries.length === 0) {
    return <p className="text-xs italic text-slate-400">{UI.transcriptEmpty}</p>;
  }
  return (
    <div className="max-h-64 overflow-auto rounded-md border border-slate-200 bg-white p-2">
      <ul className="flex flex-col gap-1.5">
        {entries.map((e, i) => (
          <li key={i} className="text-xs">
            {renderLine(e)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderLine(e: TranscriptLine) {
  switch (e.speaker) {
    case 'assistant':
      return <span className="whitespace-pre-wrap text-slate-700">{e.text}</span>;
    case 'tool_use':
      return (
        <span className="text-slate-500">
          <span className="font-medium">{toolLabel(e.tool)}</span>
          {e.detail ? ` — ${e.detail}` : ''}
        </span>
      );
    case 'tool_result':
      return (
        <span className={e.isError ? 'text-rose-600' : 'text-slate-400'}>
          → {e.summary}
        </span>
      );
    case 'system':
      return <span className="text-slate-400">{e.text}</span>;
  }
}
