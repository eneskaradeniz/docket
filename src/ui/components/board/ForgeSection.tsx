import { useState } from 'react';
import type { ForgeIssueRow, ForgePrDetail, ForgePrRow, ForgeRepoView, ForgeView } from '../../../core/forge';
import type { WorkOrderId } from '../../../core/types';
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
// WO-0092: the card grows an ISSUES fold per repo (the frozen scan page): ▸ N açık sorun opens
// the rows (title, state, labels, milestone title, updatedAt, ↗ url). An OPEN issue carries
// ▸ İş emri aç (the ONE product action): one click drills the body down and prefills the NORMAL
// create dialog — the operator edits before save. Rows multi-select for the counted batch
// (N iş emri, one confirm). A degraded drill-down refuses IN PLACE with the reason — never a
// half-prefilled dialog (WO-0065's shaped-unknown). The cache never holds a body (WO-0081 §3).
export function ForgeSection({
  view,
  onRefresh,
  onPrDetail,
  onPrDiff,
  onOpenExternal,
  onSpawnIssue,
  onBatchSpawnIssues,
  spawnedWoIdsByIssue,
  onOpenSpawnedWo,
}: {
  view: ForgeView;
  onRefresh: () => void;
  onPrDetail?: (repoRemote: string, number: number) => Promise<ForgePrDetail>;
  onPrDiff?: (repoRemote: string, number: number) => Promise<string>;
  onOpenExternal?: (url: string) => void;
  /** WO-0092: the single spawn — drills the issue body down (ONE call) and opens the create
   *  dialog prefilled. Rejects with the displayable reason; the row refuses in place. */
  onSpawnIssue?: (repoRemote: string, issue: ForgeIssueRow) => Promise<void>;
  /** WO-0092: the counted batch — N issues → N work orders after ONE counted confirm.
   *  Rejects with the displayable reason; nothing is written. */
  onBatchSpawnIssues?: (repoRemote: string, issues: ForgeIssueRow[]) => Promise<void>;
  /** WO-0092: the view-time issue→WO join (ref → spawned WOs); the rows mark their WOs. */
  spawnedWoIdsByIssue?: Map<string, WorkOrderId[]>;
  /** A spawned-WO chip navigates to that work order's detail. */
  onOpenSpawnedWo?: (id: WorkOrderId) => void;
}) {
  const { UI } = useLabels();
  const prTotal = view.repos.reduce((n, r) => n + r.prs.length, 0);
  const issueTotal = view.repos.reduce((n, r) => n + r.issues.length, 0);
  return (
    <section className="mb-5" data-testid="forge-section">
      <div className="readout mb-2 flex items-baseline justify-between">
        <h2>
          {UI.forgeSectionTitle}
          <span className="ml-1.5 font-mono text-[10.5px] tracking-normal">
            {UI.forgeSummary(view.repos.length, prTotal)}
            {issueTotal > 0 ? (
              <span>
                {' · '}
                {UI.forgeIssuesCount(issueTotal)}
              </span>
            ) : null}
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
            onSpawnIssue={onSpawnIssue}
            onBatchSpawnIssues={onBatchSpawnIssues}
            spawnedWoIdsByIssue={spawnedWoIdsByIssue}
            onOpenSpawnedWo={onOpenSpawnedWo}
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
  onSpawnIssue,
  onBatchSpawnIssues,
  spawnedWoIdsByIssue,
  onOpenSpawnedWo,
}: {
  repo: ForgeRepoView;
  onPrDetail?: (repoRemote: string, number: number) => Promise<ForgePrDetail>;
  onPrDiff?: (repoRemote: string, number: number) => Promise<string>;
  onOpenExternal?: (url: string) => void;
  onSpawnIssue?: (repoRemote: string, issue: ForgeIssueRow) => Promise<void>;
  onBatchSpawnIssues?: (repoRemote: string, issues: ForgeIssueRow[]) => Promise<void>;
  spawnedWoIdsByIssue?: Map<string, WorkOrderId[]>;
  onOpenSpawnedWo?: (id: WorkOrderId) => void;
}) {
  const { UI, formatDateTime, woIdLabel } = useLabels();
  const [open, setOpen] = useState(false);
  // ONE expanded PR per card (the sibling-close idiom — the reports' rule), its detail and its
  // lazy diff riding separate little states; collapsing the row clears all three.
  const [expanded, setExpanded] = useState<number | undefined>(undefined);
  const [detail, setDetail] = useState<PrDetailState | undefined>(undefined);
  const [diff, setDiff] = useState<PrDiffState | undefined>(undefined);
  // WO-0092: the issues fold + the counted batch selection (local to the card).
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<number[]>([]);
  const [batchError, setBatchError] = useState<string | undefined>(undefined);
  const [spawnError, setSpawnError] = useState<{ number: number; message: string } | undefined>(undefined);
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

  const toggleIssueSelect = (issue: ForgeIssueRow): void => {
    setBatchError(undefined);
    setSelectedIssues((cur) =>
      cur.includes(issue.number) ? cur.filter((n) => n !== issue.number) : [...cur, issue.number],
    );
  };

  const spawnIssue = async (issue: ForgeIssueRow): Promise<void> => {
    if (onSpawnIssue === undefined) return;
    setSpawnError(undefined);
    setBatchError(undefined);
    try {
      await onSpawnIssue(repo.repoRemote, issue);
    } catch (e) {
      // The shaped unknown speaks IN PLACE (WO-0065): no half-prefilled dialog, nothing written.
      setSpawnError({ number: issue.number, message: e instanceof Error ? e.message : String(e) });
    }
  };

  const runBatch = async (): Promise<void> => {
    if (onBatchSpawnIssues === undefined) return;
    const picked = repo.issues.filter((i) => selectedIssues.includes(i.number));
    if (picked.length === 0) return;
    setBatchError(undefined);
    setSpawnError(undefined);
    try {
      await onBatchSpawnIssues(repo.repoRemote, picked);
      setSelectedIssues([]);
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e));
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

  // Neither open PRs nor issues — ONE led line (the V2 collapse): calm, no card.
  if (repo.prs.length === 0 && repo.issues.length === 0) {
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

  // The full card: head, PR rows (newest 3 + ▸ N daha) and the WO-0092 issues fold.
  const shown = open ? repo.prs : repo.prs.slice(0, 3);
  const shownIssues = issuesOpen ? repo.issues : repo.issues.slice(0, 5);
  return (
    <div className="rcard rounded-md bg-surface px-2.5 py-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{name}</span>
        <span className="ml-auto font-mono text-[10.5px] text-inkdim">
          {repo.issues.length > 0 ? `${UI.forgeIssuesCount(repo.issues.length)} · ` : ''}
          {UI.forgeOpenCount(repo.prs.length)}
        </span>
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
        {repo.issues.length > 0 ? (
          // WO-0092 — the issues fold: the scan page's rows + the ONE product action. The batch
          // bar speaks the counted grammar; a degraded drill-down refuses in place.
          <div className="mt-1 border-t border-[var(--bord)] pt-1" data-issue-fold>
            {selectedIssues.length > 0 ? (
              <div className="mb-1 flex items-center gap-2 rounded-md border border-hairline bg-bg px-2 py-1" data-issue-batch-bar>
                <span className="font-mono text-[10.5px] text-inkdim">{UI.issueBatchBar(selectedIssues.length)}</span>
                <Button
                  variant="primary"
                  size="sm"
                  className="ml-auto"
                  onClick={() => void runBatch()}
                >
                  {UI.issueBatchGo(selectedIssues.length)}
                </Button>
              </div>
            ) : null}
            {batchError !== undefined ? (
              <Tooltip label={batchError}>
                <p className="px-1 py-0.5 text-[12px] text-error">{UI.issueSpawnFailed}</p>
              </Tooltip>
            ) : null}
            <button
              type="button"
              className="irow flex w-full items-baseline gap-2 px-1 py-0.5 text-left"
              aria-expanded={issuesOpen}
              data-issue-fold-toggle=""
              onClick={() => setIssuesOpen((o) => !o)}
            >
              <span aria-hidden="true" className="shrink-0 font-mono text-[10px] text-inkdim">
                {issuesOpen ? '▾' : '▸'}
              </span>
              <span className="font-mono text-[10.5px] text-inkdim">{UI.forgeIssuesCount(repo.issues.length)}</span>
            </button>
            {issuesOpen
              ? shownIssues.map((issue) => (
                  <div key={issue.number} data-issue-row={issue.ref}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1 py-0.5">
                      <button
                        type="button"
                        aria-pressed={selectedIssues.includes(issue.number)}
                        aria-label={UI.issueSelectToggle(issue.ref)}
                        className={`ichip inline-flex shrink-0 items-center rounded px-1 py-0 ${selectedIssues.includes(issue.number) ? 'ichip-on' : ''}`}
                        onClick={() => toggleIssueSelect(issue)}
                      >
                        <span aria-hidden="true" className={`font-mono text-[11px] ${selectedIssues.includes(issue.number) ? 'text-info' : ''}`}>
                          {selectedIssues.includes(issue.number) ? '✓' : '○'}
                        </span>
                      </button>
                      <span className="shrink-0 font-mono text-[11px] text-inkdim">#{issue.number}</span>
                      <span className="min-w-0 shrink truncate text-[12.5px] text-ink" title={issue.title ?? issue.ref}>
                        {issue.title ?? `#${issue.number}`}
                      </span>
                      {issue.labels.map((label) => (
                        <span key={label} className="shrink-0 rounded border border-hairline px-1 py-px font-mono text-[10px] text-inkdim">
                          {label}
                        </span>
                      ))}
                      {issue.milestoneTitle ? (
                        <span className="shrink-0 font-mono text-[10px] text-inkdim">{issue.milestoneTitle}</span>
                      ) : null}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        {issue.updatedAt ? (
                          <span className="font-mono text-[10px] text-inkdim">{formatDateTime(issue.updatedAt)}</span>
                        ) : null}
                        {onOpenExternal ? (
                          <Tooltip label={UI.forgePrDetailBrowser}>
                            <button
                              type="button"
                              className="ibtn h-5 w-5 text-[11px]"
                              aria-label={`${UI.forgePrDetailBrowser} #${issue.number}`}
                              onClick={() => onOpenExternal(issue.url)}
                            >
                              ↗
                            </button>
                          </Tooltip>
                        ) : null}
                        {issue.state === 'open' && onSpawnIssue !== undefined ? (
                          <button
                            type="button"
                            className="irow shrink-0 rounded border border-hairline px-1.5 py-0.5 font-mono text-[10.5px] text-info"
                            aria-label={UI.issueSpawnAria(issue.ref)}
                            data-issue-spawn={issue.ref}
                            onClick={() => void spawnIssue(issue)}
                          >
                            {UI.issueSpawnAction}
                          </button>
                        ) : (
                          // A closed issue spawns nothing — the row shows what it is (the state
                          // word IS the reason; ADR-0001's guarded-row register).
                          <span className="shrink-0 font-mono text-[10px] text-inkdim">
                            {UI.FORGE_ISSUE_STATE[issue.state]}
                          </span>
                        )}
                      </span>
                    </div>
                    {spawnError?.number === issue.number ? (
                      <Tooltip label={spawnError.message}>
                        <p className="px-1 pb-0.5 text-[12px] text-error" data-issue-spawn-error>
                          {UI.issueSpawnFailed}
                        </p>
                      </Tooltip>
                    ) : null}
                    {(spawnedWoIdsByIssue?.get(issue.ref)?.length ?? 0) > 0 ? (
                      // The two-way link, issue side: this row marks the WOs it spawned (view-time
                      // join; a deleted WO drops out and the row stays honest).
                      <div className="flex flex-wrap items-center gap-1.5 px-1 pb-1" data-issue-spawned-wo={issue.ref}>
                        {(spawnedWoIdsByIssue?.get(issue.ref) ?? []).map((woId) => (
                          <button
                            key={woId as string}
                            type="button"
                            className="ichip rounded px-1.5 py-0.5 font-mono text-[10.5px] text-info"
                            onClick={() => onOpenSpawnedWo?.(woId)}
                          >
                            {woIdLabel(woId)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              : null}
            {repo.issues.length > 5 && !issuesOpen ? (
              <button
                type="button"
                className="irow flex w-full items-center justify-center rounded-md py-1 font-mono text-[10.5px] text-inkdim"
                onClick={() => setIssuesOpen(true)}
              >
                {UI.forgeFoldMore(repo.issues.length - 5)}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
