import { useState } from 'react';
import type { ForgePrDetail, ForgePrRow, ForgeRepoView, ForgeView } from '../../../core/forge';
import { useLabels } from '../../data/locale';
import { DegradedLine } from '../DegradedLine';
import { Button, Tooltip } from '../../kit';

// WO-0086 — Depo rebuilt (operator: "kullanışlı + düzenli"; the atelier's V1+V2 hybrid, approved):
//   · a repo with NO open PRs collapses to ONE led line (ad + PR yok · son gözlem; remote tooltip)
//   · a repo WITH open PRs is a full card: head (ad + count + son gözlem), the newest 3 PR rows,
//     and a ▸ N daha fold (no pagination chrome — one scroll)
//   · the section head carries the summary (N repo · M açık PR) + the Yenile chip
//   · a degraded repo speaks operator words (WO-0078's DegradedLine); WO-0086: the scan's
//     in-flight skeleton rides the CALLER (the overview renders it; the caller gates absence).
// WO-0086: the section LEFT the board — connections and open PRs are facts, they live on the
// overview (the health move's own principle).
// WO-0087: a PR row is a TOGGLE — the detail (author, branch pair, file count, ±, body) opens
// under the row, fetched live from the forge; «Farkı görüntüle» lazily fetches the unified diff
// (capped display); «↗ Tarayıcıda aç» hands the PR's own url to shell.openExternal. The labels
// are vendor-NEUTRAL (ADR-0006) — the url is data.
export function ForgeSection({
  view,
  onRefresh,
  onPrDetail,
  onPrDiff,
  onOpenExternal,
}: {
  view: ForgeView;
  onRefresh: () => void;
  onPrDetail?: (repoRemote: string, number: number) => Promise<ForgePrDetail>;
  onPrDiff?: (repoRemote: string, number: number) => Promise<string>;
  onOpenExternal?: (url: string) => void;
}) {
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
          <ForgeRepoRow
            key={repo.repoRemote}
            repo={repo}
            onPrDetail={onPrDetail}
            onPrDiff={onPrDiff}
            onOpenExternal={onOpenExternal}
          />
        ))}
      </div>
    </section>
  );
}

interface PrDetailState {
  loading: boolean;
  data?: ForgePrDetail;
  error?: string;
}

interface PrDiffState {
  open: boolean;
  loading: boolean;
  text?: string;
  error?: string;
}

function ForgeRepoRow({
  repo,
  onPrDetail,
  onPrDiff,
  onOpenExternal,
}: {
  repo: ForgeRepoView;
  onPrDetail?: (repoRemote: string, number: number) => Promise<ForgePrDetail>;
  onPrDiff?: (repoRemote: string, number: number) => Promise<string>;
  onOpenExternal?: (url: string) => void;
}) {
  const { UI, formatDateTime } = useLabels();
  const [open, setOpen] = useState(false);
  // ONE expanded PR per card (the sibling-close idiom — the reports' rule), its detail and its
  // lazy diff riding separate little states; collapsing the row clears all three.
  const [expanded, setExpanded] = useState<number | undefined>(undefined);
  const [detail, setDetail] = useState<PrDetailState | undefined>(undefined);
  const [diff, setDiff] = useState<PrDiffState | undefined>(undefined);
  const name = repo.path.split('/').filter(Boolean).at(-1) ?? repo.repoRemote;
  const stamp =
    typeof repo.health === 'string' && repo.scannedAt !== undefined
      ? UI.forgeLastScan(formatDateTime(repo.scannedAt))
      : undefined;
  const tip = [repo.repoRemote, stamp].filter(Boolean).join(' · ');

  const togglePr = async (pr: ForgePrRow): Promise<void> => {
    if (expanded === pr.number) {
      setExpanded(undefined);
      setDetail(undefined);
      setDiff(undefined);
      return;
    }
    setExpanded(pr.number);
    setDetail(undefined);
    setDiff(undefined);
    if (onPrDetail === undefined) return;
    setDetail({ loading: true });
    try {
      setDetail({ loading: false, data: await onPrDetail(repo.repoRemote, pr.number) });
    } catch (e) {
      setDetail({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

  const toggleDiff = async (pr: ForgePrRow): Promise<void> => {
    if (diff?.open) {
      setDiff(undefined);
      return;
    }
    if (onPrDiff === undefined) return;
    setDiff({ open: true, loading: true });
    try {
      setDiff({ open: true, loading: false, text: await onPrDiff(repo.repoRemote, pr.number) });
    } catch (e) {
      setDiff({ open: true, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };

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

  // Open PRs — the full card: head, the newest 3 rows (each a detail toggle), ▸ N daha.
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
          <div key={pr.number}>
            <button
              type="button"
              className="irow flex w-full items-baseline gap-2 px-1 py-0.5 text-left"
              aria-expanded={expanded === pr.number}
              onClick={() => void togglePr(pr)}
            >
              <span className="shrink-0 font-mono text-[10px] text-inkdim" aria-hidden="true">
                {expanded === pr.number ? '▾' : '▸'}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-inkdim">#{pr.number}</span>
              <span className="min-w-0 truncate text-[12.5px] text-ink">{pr.title ?? `#${pr.number}`}</span>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] text-inkdim">{UI.FORGE_PR_STATE[pr.state]}</span>
            </button>
            {expanded === pr.number ? (
              <div className="repbody" style={{ borderTop: 'none', paddingTop: 10 }}>
                {detail?.loading ? <p className="loadline">{UI.loading}</p> : null}
                {detail?.error !== undefined ? (
                  <Tooltip label={detail.error}>
                    <p className="text-[12px] text-error">{UI.forgePrDetailLoadFailed}</p>
                  </Tooltip>
                ) : null}
                {detail?.data !== undefined ? (
                  <>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11.5px] text-inkdim">
                      {detail.data.author ? <span className="font-mono text-ink">{detail.data.author}</span> : null}
                      <span>
                        {detail.data.headBranch} → <span className="font-medium text-ink">{detail.data.baseBranch}</span>
                      </span>
                      <span>{UI.forgePrDetailFiles(detail.data.changedFiles)}</span>
                      <span>
                        <span className="text-proceed">+{detail.data.additions}</span>{' '}
                        <span className="text-error">−{detail.data.deletions}</span>
                      </span>
                    </div>
                    {detail.data.body ? (
                      <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap text-[12px] leading-relaxed text-ink">
                        {detail.data.body}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void toggleDiff(pr)}>
                        {diff?.open ? UI.forgePrDetailDiffHide : UI.forgePrDetailDiff}
                      </Button>
                      {onOpenExternal ? (
                        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => onOpenExternal(pr.url)}>
                          {UI.forgePrDetailBrowser}
                        </Button>
                      ) : null}
                    </div>
                    {diff?.loading ? <p className="loadline mt-1.5">{UI.loading}</p> : null}
                    {diff?.error !== undefined ? (
                      <Tooltip label={diff.error}>
                        <p className="mt-1 text-[12px] text-error">{UI.forgePrDetailLoadFailed}</p>
                      </Tooltip>
                    ) : null}
                    {diff?.open && diff.text !== undefined ? (
                      <pre className="mt-2 max-h-64 overflow-auto rounded border border-hairline bg-bg p-2 font-mono text-[11px] leading-relaxed">
                        {(() => {
                          const lines = diff.text.split('\n');
                          const capped = lines.slice(0, 400);
                          return capped.join('\n') + (lines.length > 400 ? `\n… ${UI.forgePrDiffTruncated(400)}` : '');
                        })()}
                      </pre>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
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
