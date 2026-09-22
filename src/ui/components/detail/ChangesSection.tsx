// ChangesSection (WO-0068, ADR-0018) — the Değişiklikler record section: per connected repo one
// card — the branch row (branch + ahead), git's own porcelain file rows (click → the diff
// expansion, the ask-card peek's grammar), and the operator's action row. EVERY write is the
// operator's explicit click fired through the composition root's console channels — nothing here
// runs on its own (never a timer, never a side effect); commit and PR carry the operator's typed
// words (an empty field does not fire), merge sits behind the counted confirm, and a failed act
// speaks git's own line as a toast — never a silent success. WO-0082: the Yenile chip lives in
// the RecordStack heading row (the section's `action` slot); this body is the repo cards alone.
// WO-0089: the local gate lives HERE — the measured line (Docket's own measurement, the sha it
// ran at), the Kapıyı çalıştır action, the tails one click away, and the exempt-CI merge refusal.
import { useState, type ReactNode } from 'react';
import type { CommitResult, CreatePrResult, GateRunResult, MergeResult, PushResult, RepoChanges } from '../../../core/console';
import type { LineDiff } from '../../../core/diff';
import { localGateSatisfiedAt, localGateStatus } from '../../../core/derive';
import type { LocalGate, WorkOrderId } from '../../../core/types';
import { toast } from '../../chrome/ToastHost';
import { useLabels } from '../../data/locale';
import { Button, Dialog, Input, cn } from '../../kit';
import { DegradedLine } from '../DegradedLine';

/** The renderer-side console bridge — the optional `changes` group of window.docket, passed down
 *  as a prop (the forge/health seam; the renderer never touches window.docket for this). The reads
 *  are core's ChangesWatch shape; the write METHODS are declared HERE and in the bridge type only —
 *  never as a core port, so the drive pipeline holds no reference to them (ADR-0018 decision 4). */
export interface ChangesBridge {
  changesFor(workOrderId: WorkOrderId): Promise<RepoChanges[]>;
  diffFor(workOrderId: WorkOrderId, repoPath: string, file: string): Promise<LineDiff | null>;
  commit(workOrderId: WorkOrderId, repoPath: string, message: string): Promise<CommitResult>;
  push(workOrderId: WorkOrderId, repoPath: string): Promise<PushResult>;
  createPr(workOrderId: WorkOrderId, repoPath: string, summary: string): Promise<CreatePrResult>;
  merge(workOrderId: WorkOrderId, repoPath: string, prNumber: number): Promise<MergeResult>;
  /** WO-0089 — DOCKET runs the workspace's declared gate commands in the repo (never the session);
   *  main jails the cwd, holds the host-wide lock, records the measurement. */
  runGate(workOrderId: WorkOrderId, repoPath: string): Promise<GateRunResult>;
}

/** One repo's local-gate face for the card (WO-0089), keyed by repo slug from the WO's tracks. */
export interface RepoGateFace {
  localGate?: LocalGate; // undefined = undeclared (the workspace declared no gate commands)
  required: boolean; // the track's CI is exempt — the substitute is REQUIRED before merge
  // Review M2 — the track's forge-observed PR head sha: freshness reference for the measured
  // gate (a passing measurement at another sha does not satisfy the merge — the antreo twin).
  // Undefined when no PR is open (the merge is absent for `pr_not_open` before this ever reads).
  headSha?: string;
}

type Act = 'commit' | 'push' | 'pr' | 'merge' | 'gate';

export function ChangesSection({
  woId,
  repos,
  bridge,
  onRefresh,
  gateByRepo,
  onGateRan,
}: {
  woId: WorkOrderId;
  repos: RepoChanges[];
  bridge: ChangesBridge;
  onRefresh: () => void;
  /** WO-0089: per-repo gate faces (undefined map / absent entry = undeclared — nothing renders,
   *  exactly as before this work order). */
  gateByRepo?: Map<string, RepoGateFace>;
  /** WO-0089: fired after a gate run — the detail reload re-hydrates the measured face. */
  onGateRan?: () => void;
}) {
  return (
    // WO-0082: the section's refresh chip moved up into the RecordStack heading row; the callback
    // still flows down — each repo card re-looks after its own operator action.
    <div className="flex flex-col gap-2">
      {repos.map((repo) => (
        <ChangesRepoCard
          key={repo.path}
          woId={woId}
          repo={repo}
          bridge={bridge}
          onRefresh={onRefresh}
          gate={gateByRepo?.get(repo.repo)}
          onGateRan={onGateRan}
        />
      ))}
    </div>
  );
}

function ChangesRepoCard({
  woId,
  repo,
  bridge,
  onRefresh,
  gate,
  onGateRan,
}: {
  woId: WorkOrderId;
  repo: RepoChanges;
  bridge: ChangesBridge;
  onRefresh: () => void;
  gate?: RepoGateFace;
  onGateRan?: () => void;
}) {
  const { UI } = useLabels();
  const [message, setMessage] = useState('');
  const [acting, setActing] = useState<Act | undefined>(undefined);
  const [openFile, setOpenFile] = useState<string | undefined>(undefined);
  // undefined = not fetched; null = the look found nothing to show (or failed — a peek is a courtesy).
  const [diff, setDiff] = useState<LineDiff | null | undefined>(undefined);
  // WO-0089: the gate tails' expansion (the diff-expansion grammar — one open block per card).
  const [gateOpen, setGateOpen] = useState(false);
  // A merge stays scoped to a PR opened FROM THIS CARD in this session (v1): the number lives in
  // the component, never in the store — the durable record is the scan's observation (ADR-0018
  // decision 5; the console records nothing of its own).
  const [prNumber, setPrNumber] = useState<number | undefined>(undefined);
  const [confirmMerge, setConfirmMerge] = useState(false);

  // A degraded look speaks the operator words of WO-0078 and offers nothing — there is no tree
  // here to act on; the verbatim reason stays in the record and rides the tooltip.
  if (repo.degraded !== undefined) {
    return (
      <div className="rcard rounded-md bg-surface px-2.5 py-1.5">
        <span className="text-[12.5px] font-semibold text-ink">{repo.repo}</span>
        <DegradedLine reason={repo.degraded} />
      </div>
    );
  }

  const toggleFile = async (file: RepoChanges['files'][number]): Promise<void> => {
    if (openFile === file.path) {
      setOpenFile(undefined);
      return;
    }
    setOpenFile(file.path);
    if (file.status === '??') return; // untracked: the new-file line IS the expansion (no HEAD text to diff)
    setDiff(undefined);
    try {
      setDiff(await bridge.diffFor(woId, repo.path, file.path));
    } catch {
      setDiff(null);
    }
  };

  const run = async <T extends CommitResult | PushResult | CreatePrResult | MergeResult>(
    kind: Act,
    act: () => Promise<T>,
    onOk: (r: Extract<T, { ok: true }>) => void,
  ): Promise<void> => {
    setActing(kind);
    try {
      const r = await act();
      if (r.ok) onOk(r as Extract<T, { ok: true }>); // r.ok is exactly that narrowing; T itself cannot be union-narrowed
      else toast.push({ kind: 'error', title: UI.changesFailed, body: r.error });
    } catch (e) {
      toast.push({ kind: 'error', title: UI.changesFailed, body: (e as Error)?.message ?? String(e) });
    } finally {
      setActing(undefined);
    }
  };

  const handleCommit = (): void => {
    const msg = message.trim();
    if (msg === '') return; // the operator's own words, or nothing fires
    void run('commit', () => bridge.commit(woId, repo.path, msg), () => {
      setMessage('');
      toast.push({ kind: 'confirm', title: UI.changesCommitDone });
      onRefresh(); // observation wins: the next look shows the clean tree + the moved ahead count
    });
  };
  const handlePush = (): void => {
    void run('push', () => bridge.push(woId, repo.path), () => {
      toast.push({ kind: 'confirm', title: UI.changesSent });
      onRefresh();
    });
  };
  const handleCreatePr = (): void => {
    const msg = message.trim();
    if (msg === '') return; // the summary is the operator's typed words, like the commit message
    void run('pr', () => bridge.createPr(woId, repo.path, msg), (r) => {
      setPrNumber(r.number); // the merge act unlocks for this session only
      toast.push({ kind: 'confirm', title: UI.changesPrOpened(r.number) });
      onRefresh(); // the track link fills on the next scan's observation, not here
    });
  };
  const handleMerge = (): void => {
    if (prNumber === undefined) return;
    void run('merge', () => bridge.merge(woId, repo.path, prNumber), () => {
      setPrNumber(undefined); // merged — the session scope ends
      setConfirmMerge(false);
      toast.push({ kind: 'confirm', title: UI.changesMerged });
      onRefresh();
    });
  };

  // WO-0089 — the gate run: DOCKET measures (the composition root holds the lock + jail); the
  // toast speaks the verdict, the card re-reads the recorded measurement (observation wins — the
  // face never renders from this handler's own result).
  const handleRunGate = (): void => {
    setActing('gate');
    void bridge
      .runGate(woId, repo.path)
      .then((r) => {
        if (r.ok) toast.push({ kind: r.passed ? 'confirm' : 'error', title: r.passed ? UI.gateToastPassed : UI.gateToastFailed });
        else toast.push({ kind: 'error', title: UI.changesFailed, body: r.error });
      })
      .catch((e: unknown) => {
        toast.push({ kind: 'error', title: UI.changesFailed, body: (e as Error)?.message ?? String(e) });
      })
      .finally(() => {
        setActing(undefined);
        onGateRan?.();
      });
  };

  // WO-0089 — the gate face derives from the RECORDED measurement (localGateStatus speaks core's
  // rule); the merge refusal keys off the same derivation, never a local re-invention.
  const gateLg = gate?.localGate;
  const gateStatus = gateLg !== undefined || gate?.required ? localGateStatus(gateLg) : undefined;
  // Review M2 — a passing measurement at a superseded sha does not satisfy the merge either
  // (core's trackMechanicallyEvidenced rule, mirrored here so Birleştir never shows available
  // while the real channel would refuse it).
  const gateFresh = gateStatus !== 'satisfied' || localGateSatisfiedAt(gateLg, gate?.headSha ?? '');
  const gateBlocksMerge = gate?.required === true && !gateFresh;

  const fileDiffNode = (file: RepoChanges['files'][number]): ReactNode => {
    if (file.status === '??') {
      return <p className="mt-0.5 px-1 font-mono text-[10.5px] text-inkdim">{UI.changesNewFile}</p>;
    }
    return (
      <pre className="mt-0.5 max-h-48 overflow-auto rounded border border-hairline bg-bg p-2 font-mono text-[11px] leading-relaxed">
        {diff === undefined
          ? UI.loading
          : diff === null || diff.lines.length === 0
            ? UI.diffEmpty
            : diff.lines.map((l, i) => (
                <span
                  key={i}
                  className={cn('block whitespace-pre-wrap', l.op === 'add' ? 'text-proceed' : l.op === 'del' ? 'text-error' : 'text-inkdim')}
                >
                  {l.op === 'add' ? '+ ' : l.op === 'del' ? '- ' : '  '}
                  {l.text}
                </span>
              ))}
        {diff && diff.truncated > 0 ? <span className="block text-inkdim">{UI.diffTruncated(diff.truncated)}</span> : null}
      </pre>
    );
  };

  return (
    <div className="rcard rounded-md bg-surface px-2.5 py-1.5">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[12.5px] font-semibold text-ink">{repo.repo}</span>
        {repo.branch !== undefined ? (
          <span className="min-w-0 truncate font-mono text-[10.5px] text-inkdim">{UI.changesBranch(repo.branch)}</span>
        ) : null}
        {repo.ahead !== undefined ? (
          <span className="ml-auto shrink-0 font-mono text-[10.5px] text-inkdim">{UI.changesAhead(repo.ahead)}</span>
        ) : null}
      </div>
      {repo.files.length === 0 ? (
        <p className="mt-0.5 text-[11.5px] text-inkdim">{UI.changesEmpty}</p>
      ) : (
        <div className="mt-1 border-t border-[var(--bord)] pt-1">
          {repo.files.map((f) => (
            <div key={f.path}>
              <button
                type="button"
                className="irow flex w-full items-baseline gap-2 px-1 py-0.5 text-left"
                aria-expanded={openFile === f.path}
                onClick={() => void toggleFile(f)}
              >
                <span className="w-4 shrink-0 font-mono text-[10.5px] text-inkdim">{f.status}</span>
                <span className="min-w-0 truncate font-mono text-[11px] text-ink">{f.path}</span>
              </button>
              {openFile === f.path ? fileDiffNode(f) : null}
            </div>
          ))}
        </div>
      )}
      {/* WO-0089 — the local gate row. Renders only when the workspace declared a gate OR the
          track's CI is exempt (the required substitute): a workspace declaring nothing sees
          nothing here, exactly as before. The measured line is Docket's OWN measurement — the
          sha it ran at, the per-command count; the tails sit one click away (the diff-expansion
          grammar). */}
      {gateStatus !== undefined ? (
        <div className="mt-1.5 border-t border-[var(--bord)] pt-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const declared = gateLg?.kind === 'declared' ? gateLg : undefined;
              const ok = declared ? declared.results.filter((r) => r.exit !== null && r.exit === r.expectExit).length : 0;
              const n = declared?.results.length ?? 0;
              const sha = declared && declared.sha !== '' ? declared.sha.slice(0, 7) : '—';
              const headSha = gate?.headSha !== undefined && gate.headSha !== '' ? gate.headSha.slice(0, 7) : '—';
              const hasTails = declared !== undefined && declared.results.some((r) => r.tail !== '');
              // Review M2 — a satisfied-but-stale measurement gets its OWN line (names both
              // shas, the fix is a re-run) — never the plain "✓ passed" the merge would then
              // contradict.
              const line =
                gateStatus === 'satisfied' && !gateFresh ? UI.gateRunStale(ok, n, sha, headSha)
                : gateStatus === 'satisfied' ? `✓ ${UI.gateRunPassed(ok, n, sha)}`
                : gateStatus === 'unsatisfied' ? UI.gateRunFailed(ok, n, sha)
                : gateStatus === 'exempt' ? UI.gateUndeclared
                : declared !== undefined ? UI.gateRunUnmeasured
                : gateLg?.kind === 'invalid' ? UI.gateRunUnmeasured
                : UI.gateRunPending;
              const tone =
                gateStatus === 'satisfied' && !gateFresh ? 'text-inkdim'
                : gateStatus === 'satisfied' ? 'text-proceed'
                : gateStatus === 'unsatisfied' ? 'text-[var(--color-error)]'
                : 'text-inkdim';
              const node = <span className={`font-mono text-[10.5px] ${tone} ${acting === 'gate' ? 'opacity-60' : ''}`}>{acting === 'gate' ? UI.gateRunBusy : line}</span>;
              return hasTails && acting !== 'gate' ? (
                <button
                  type="button"
                  className="irow px-0.5"
                  aria-expanded={gateOpen}
                  onClick={() => setGateOpen((o) => !o)}
                >
                  {node}
                </button>
              ) : (
                node
              );
            })()}
            {/* The run action exists only where a DECLARATION exists (pending/invalid/declared) —
                the required-but-undeclared face shows the line alone: its fix is authoring
                workspace.yaml, an act this card cannot offer (ADR-0001: absent, never a click
                that can only fail). */}
            {gateLg !== undefined ? (
              <Button variant="ghost" size="sm" className="ml-auto shrink-0" busy={acting === 'gate'} onClick={handleRunGate}>
                {UI.gateRunButton}
              </Button>
            ) : null}
          </div>
          {gateOpen && gateLg?.kind === 'declared' ? (
            <pre className="mt-1 max-h-48 overflow-auto rounded border border-hairline bg-bg p-2 font-mono text-[11px] leading-relaxed">
              {gateLg.results.map((r, i) => (
                <span key={i} className="block whitespace-pre-wrap">
                  <span className={r.exit !== null && r.exit === r.expectExit ? 'text-proceed' : 'text-error'}>
                    {r.command} → exit {r.exit ?? '—'} (expected {r.expectExit})
                  </span>
                  {r.tail !== '' ? <span className="block whitespace-pre-wrap text-inkdim">{r.tail}</span> : null}
                </span>
              ))}
            </pre>
          ) : null}
          {gateLg?.kind === 'invalid' ? <DegradedLine reason={gateLg.reason} /> : null}
        </div>
      ) : null}
      {/* The action row. Absence is the gate (ADR-0001): no branch → no Push / PR aç (a detached
          HEAD cannot push or open a PR); no PR opened here → no Birleştir. The unmet acts are
          absent, never greyed out. WO-0089: an exempt-CI track whose local gate is unmet carries
          no Birleştir either — the substitute line states why. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-[var(--bord)] pt-1.5">
        <Input
          aria-required="true"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={UI.changesCommitMessage}
          className="min-w-0 flex-1 font-sans text-[12px]"
        />
        <Button variant="ghost" size="sm" busy={acting === 'commit'} onClick={handleCommit}>
          {UI.changesCommit}
        </Button>
        {repo.branch !== undefined ? (
          <>
            <Button variant="ghost" size="sm" busy={acting === 'push'} onClick={handlePush}>
              {UI.changesPush}
            </Button>
            <Button variant="ghost" size="sm" busy={acting === 'pr'} onClick={handleCreatePr}>
              {UI.changesCreatePr}
            </Button>
          </>
        ) : null}
        {prNumber !== undefined && !gateBlocksMerge ? (
          <Button variant="danger" size="sm" busy={acting === 'merge'} onClick={() => setConfirmMerge(true)}>
            {UI.changesMerge}
          </Button>
        ) : null}
      </div>
      {prNumber !== undefined && gateBlocksMerge ? (
        <p className="mt-0.5 text-[10.5px] text-inkdim">{UI.gateMergeBlocked}</p>
      ) : null}
      {repo.branch !== undefined && repo.ahead === undefined ? (
        <p className="mt-0.5 text-[10.5px] text-inkdim">{UI.changesPushInfo}</p>
      ) : null}
      {confirmMerge && prNumber !== undefined ? (
        <Dialog
          open
          narrow
          onOpenChange={(o) => {
            if (!o) setConfirmMerge(false);
          }}
          title={UI.changesMerge}
          closeAria={UI.dialogCloseAria}
          footer={
            <>
              <Button variant="ghost" size="sm" onClick={() => setConfirmMerge(false)}>
                {UI.cancel}
              </Button>
              <Button variant="danger" size="sm" busy={acting === 'merge'} onClick={handleMerge}>
                {UI.changesMerge}
              </Button>
            </>
          }
        >
          {/* The counted confirm (ADR-0018 decision 3): names the consequence, states that it
              cannot be undone — the delete-confirm discipline's grammar, on the one console act
              that ends a PR. */}
          <p className="text-[12px] text-inkdim">{UI.changesMergeConfirm(prNumber)}</p>
        </Dialog>
      ) : null}
    </div>
  );
}
