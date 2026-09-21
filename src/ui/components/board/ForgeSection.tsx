import { useState } from 'react';
import type { ForgeRepoView, ForgeView } from '../../../core/forge';
import { useLabels } from '../../data/locale';
import { DegradedLine } from '../DegradedLine';
import { Tooltip } from '../../kit';

// WO-0086 — Depo rebuilt (operator: "kullanışlı + düzenli"; the atelier's V1+V2 hybrid, approved):
//   · a repo with NO open PRs collapses to ONE led line (ad + PR yok · son gözlem; remote tooltip)
//   · a repo WITH open PRs is a full card: head (ad + count + son gözlem), the newest 3 PR rows,
//     and a ▸ N daha fold (no pagination chrome — one scroll)
//   · the section head carries the summary (N repo · M açık PR) + the Yenile chip
//   · a degraded repo speaks operator words (WO-0078's DegradedLine); WO-0086: the scan's
//     in-flight skeleton rides the CALLER (the overview renders it; the caller gates absence).
// WO-0086: the section LEFT the board — connections and open PRs are facts, they live on the
// overview (the health move's own principle).
export function ForgeSection({ view, onRefresh }: { view: ForgeView; onRefresh: () => void }) {
  const { UI } = useLabels();
  const prTotal = view.repos.reduce((n, r) => n + r.prs.length, 0);
  return (
    <section className="mb-5" data-testid="forge-section">
      <div className="readout mb-2 flex items-baseline justify-between">
        <h2>
          {UI.forgeSectionTitle}
          <span className="ml-1.5 font-mono text-[10.5px] tracking-normal">
            {UI.forgeSummary(view.repos.length, prTotal)}
          </span>
        </h2>
        <button type="button" className="ichip rounded px-2 py-0.5 font-mono text-[10.5px]" onClick={onRefresh}>
          {UI.forgeRefresh}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        {view.repos.map((repo) => (
          <ForgeRepoRow key={repo.repoRemote} repo={repo} />
        ))}
      </div>
    </section>
  );
}

function ForgeRepoRow({ repo }: { repo: ForgeRepoView }) {
  const { UI, formatDateTime } = useLabels();
  const [open, setOpen] = useState(false);
  // The operator's own name for the repo is the path's basename (the RepoId identity invariant);
  // the remote stays a tooltip — WO-0086 demoted the URL from the headline to the hint.
  const name = repo.path.split('/').filter(Boolean).at(-1) ?? repo.repoRemote;
  const stamp =
    typeof repo.health === 'string' && repo.scannedAt !== undefined
      ? UI.forgeLastScan(formatDateTime(repo.scannedAt))
      : undefined;
  const tip = [repo.repoRemote, stamp].filter(Boolean).join(' · ');

  // A degraded look speaks operator words (WO-0078) — a full card, the reason its body.
  if (typeof repo.health !== 'string') {
    return (
      <div className="rcard rounded-md bg-surface px-2.5 py-1.5">
        <div className="flex items-baseline gap-2">
          <span className="text-[12.5px] font-semibold text-ink">{name}</span>
          {stamp ? <span className="ml-auto font-mono text-[10.5px] text-inkdim">{stamp}</span> : null}
        </div>
        <DegradedLine reason={repo.health.degraded} />
      </div>
    );
  }

  // No open PRs — ONE led line (the V2 collapse): calm, no card.
  if (repo.prs.length === 0) {
    return (
      <Tooltip label={tip}>
        <div className="irow flex items-center gap-2 rounded-md border border-hairline bg-surface px-2.5 py-1.5 text-[12px]">
          <span aria-hidden="true" className="inline-block size-[5px] rounded-full bg-proceed" />
          <span className="font-medium text-ink">{name}</span>
          <span className="ml-auto font-mono text-[10.5px] text-inkdim">{UI.forgeNoPrs}{stamp ? ` · ${stamp}` : ''}</span>
        </div>
      </Tooltip>
    );
  }

  // Open PRs — the full card: head, the newest 3 rows, ▸ N daha.
  const shown = open ? repo.prs : repo.prs.slice(0, 3);
  return (
    <div className="rcard rounded-md bg-surface px-2.5 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
        <span className="ml-auto font-mono text-[10.5px] text-inkdim">{UI.forgeOpenCount(repo.prs.length)}</span>
        {stamp ? <span className="font-mono text-[10.5px] text-inkdim">{stamp}</span> : null}
      </div>
      <div className="mt-1 border-t border-[var(--bord)] pt-1">
        {shown.map((pr) => (
          <div key={pr.number} className="irow flex items-baseline gap-2 px-1 py-0.5">
            <span className="shrink-0 font-mono text-[11px] text-inkdim">#{pr.number}</span>
            <span className="min-w-0 truncate text-[12.5px] text-ink">{pr.title}</span>
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-inkdim">{UI.FORGE_PR_STATE[pr.state]}</span>
          </div>
        ))}
        {repo.prs.length > 3 && !open ? (
          <button
            type="button"
            className="irow flex w-full items-center justify-center rounded-md py-1 font-mono text-[10.5px] text-inkdim"
            onClick={() => setOpen(true)}
          >
            {UI.forgeFoldMore(repo.prs.length - 3)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
