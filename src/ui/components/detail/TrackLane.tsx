import type { TrackLaneView } from '../../../core/types';
import { dependsOnText, mergeActionText, TRACK_STAGE_LABELS, trackSessionText, UI } from '../../data/labels';

export function TrackLane({ lane }: { lane: TrackLaneView }) {
  const { track, session, mergeAction } = lane;
  const sessionLabel = trackSessionText(session);
  return (
    <li className="rounded-md border border-hairline bg-surface p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink">{track.repo as string}</span>
          {track.ci.kind === 'exempt' ? <span className="font-mono text-[11px] text-info">{UI.ciExempt}</span> : null}
          {track.dependsOn.length > 0 ? (
            <span className="font-mono text-[11px] text-inkdim">{dependsOnText(track.dependsOn.length)}</span>
          ) : null}
        </div>
        <span className="text-xs text-inkdim">{TRACK_STAGE_LABELS[track.stage]}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-xs text-inkdim">{sessionLabel}</span>
        {mergeAction.kind === 'available' ? (
          <button type="button" className="rounded-md border border-hairline px-2 py-0.5 text-xs text-inkdim transition-colors hover:bg-raised hover:text-ink">
            {mergeActionText(mergeAction)}
          </button>
        ) : (
          <span className="text-xs text-inkdim">{mergeActionText(mergeAction)}</span>
        )}
      </div>
    </li>
  );
}
