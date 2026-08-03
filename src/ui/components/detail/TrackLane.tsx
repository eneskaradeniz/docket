import type { TrackLaneView } from '../../../core/types';
import { dependsOnText, mergeActionText, TRACK_STAGE_LABELS, trackSessionText, UI } from '../../data/labels';
import { Badge } from '../primitives/Badge';

export function TrackLane({ lane }: { lane: TrackLaneView }) {
  const { track, session, mergeAction } = lane;
  const sessionLabel = trackSessionText(session);
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-slate-600">{track.repo as string}</span>
          {track.ci.kind === 'exempt' && <Badge tone="provisional">{UI.ciExempt}</Badge>}
          {track.dependsOn.length > 0 && (
            <Badge tone="info">{dependsOnText(track.dependsOn.length)}</Badge>
          )}
        </div>
        <span className="text-xs text-slate-400">{TRACK_STAGE_LABELS[track.stage]}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-slate-500">{sessionLabel}</span>
        {mergeAction.kind === 'available' ? (
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 transition hover:bg-slate-50"
          >
            {mergeActionText(mergeAction)}
          </button>
        ) : (
          <span className="text-xs text-slate-400">{mergeActionText(mergeAction)}</span>
        )}
      </div>
    </li>
  );
}
