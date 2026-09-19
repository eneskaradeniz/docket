import type { ForgeRepoView, ForgeView } from '../../../core/forge';
import { useLabels } from '../../data/locale';

// The board's Depo section (WO-0064): the forge observation's VISIBLE proof. Per connected repo
// one row — the repo's name, the open-PR count, and the «son gözlem» stamp (ADR-0010: a screen
// that cannot say when it last looked is claiming more than it knows) — with the open PR page
// beneath it as read-only fact rows. A degraded scan's reason speaks verbatim as its own line
// («we could not look» ≠ «we looked and it failed»); the cached facts stay. The whole section is
// ABSENT with no scanned repos (the caller gates it; ADR-0001/0012). No click-through in v1 —
// rows are facts, not links.
export function ForgeSection({ view, onRefresh }: { view: ForgeView; onRefresh: () => void }) {
  const { UI } = useLabels();
  return (
    <section className="mb-5" data-testid="forge-section">
      <div className="readout mb-2 flex items-baseline justify-between">
        <h2>{UI.forgeSectionTitle}</h2>
        <button type="button" className="ichip rounded px-2 py-0.5 font-mono text-[10.5px]" onClick={onRefresh}>
          {UI.forgeRefresh}
        </button>
      </div>
      <div className="space-y-1.5">
        {view.repos.map((repo) => (
          <ForgeRepoRow key={repo.repoRemote} repo={repo} />
        ))}
      </div>
    </section>
  );
}

function ForgeRepoRow({ repo }: { repo: ForgeRepoView }) {
  const { UI, formatDateTime } = useLabels();
  // The operator's own name for the repo is the path's basename (the RepoId identity invariant);
  // the remote stays the dim mono pointer beneath it — same split as the doc rows' human word +
  // file pointer (WO-0038).
  const name = repo.path.split('/').filter(Boolean).at(-1) ?? repo.repoRemote;
  return (
    <div className="rcard rounded-md bg-surface px-2.5 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
        <span className="font-mono text-[10.5px] text-inkdim">{repo.repoRemote}</span>
        <span className="ml-auto font-mono text-[10.5px] text-inkdim">
          {repo.prs.length > 0 ? UI.forgeOpenCount(repo.prs.length) : ''}
        </span>
        {typeof repo.health === 'string' && repo.scannedAt !== undefined && (
          <span className="font-mono text-[10.5px] text-inkdim">{UI.forgeLastScan(formatDateTime(repo.scannedAt))}</span>
        )}
      </div>
      {typeof repo.health !== 'string' && (
        <div className="mt-0.5 font-mono text-[10.5px] text-[var(--color-error)]">{repo.health.degraded}</div>
      )}
      {repo.prs.length > 0 && (
        <div className="mt-1 border-t border-[var(--bord)] pt-1">
          {repo.prs.map((pr) => (
            <div key={pr.number} className="irow flex items-baseline gap-2 px-1 py-0.5">
              <span className="shrink-0 font-mono text-[11px] text-inkdim">#{pr.number}</span>
              <span className="min-w-0 truncate text-[12.5px] text-ink">{pr.title}</span>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-inkdim">{UI.FORGE_PR_STATE[pr.state]}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
