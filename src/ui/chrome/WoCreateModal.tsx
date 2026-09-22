import { useRef, useState } from 'react';
import { FolderOpen, X } from 'lucide-react';
import type { RepoId, WorkOrder, Workspace } from '../../core/types';
import type { PermissionRule, ReviewMode, WorkOrderSource } from '../../core/source';
import { cwdOverrideIsAbsolute } from '../../core/order-md';
import { useLabels } from '../data/locale';
import { Button, Dialog, Field, Input, Segmented, Textarea, Tooltip } from '../kit';
import { toast } from './ToastHost';
import type { WoSpawnPrefill } from '../components/roadmap/TaskRow';

// WO-0092: the issue spawn's data seed — the drill-down's body rides `body` ONCE here and goes
// straight into order.md's Objective (the operator's own document); nothing is cached.
export interface WoIssuePrefill {
  ref: string; // 'owner/repo#N' — written as order.md `issue:` front-matter (the task: idiom)
  title?: string; // absent = the wire carried none; the operator types one (the form gate)
  body?: string;
  repo?: string; // the forge repo name; matched against the track slugs (the seededTracks logic)
}

const base = (p: string): string => {
  let s = p;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.split('/').pop() || 'file';
};

// "Yeni iş emri" creation modal (WO-0015; WO-0031 kit restyle — pulled forward from Phase B after the
// operator hit the half-cut legacy popup at min window size). The decision store is excluded from the
// track list when the workspace has a dedicated decision-store repo (PRODUCT.md §Decisions 6); a
// single-repo workspace keeps its one repo as a track. The Dialog's flex column + internal scroll keep
// it fully inside the viewport at ANY window size ≥ min.
// WO-0036: form errors sit under the field that caused them (persistent while invalid, first-invalid
// focused on submit); save failures toast top-right (hata) — a dialog footer carries no error copy
// (operator review round, 2026-08-21; the toast ladder sits above the dialog overlay by design).
export function WoCreateModal({
  workspace,
  source,
  defaultRule,
  prefill,
  issuePrefill,
  onClose,
  onCreated,
}: {
  workspace: Workspace;
  source: WorkOrderSource;
  /** The Settings default — the preselected rule (WO-0031c; the WO carries its own from here on). */
  defaultRule: PermissionRule;
  /** WO-0049 (mockup kare 06): the roadmap task's spawn seed — the uneditable context line + the
   *  seeded fields + `task:` into order.md. Undefined = the plain board flow, untouched. */
  prefill?: WoSpawnPrefill;
  /** WO-0092: the issue spawn's seed — the context line + title/body seeds + `issue:` into
   *  order.md. SEEDS, not locks; the operator edits before save (never a silent write). */
  issuePrefill?: WoIssuePrefill;
  onClose: () => void;
  /** `withPlan` = the "Oluştur ve plan iste ⏎" path: create AND auto-start the architect (v3 §1). */
  onCreated: (wo: WorkOrder, withPlan?: boolean) => void;
}) {
  const { PERMISSION_RULE_LABELS, UI, fazLabel } = useLabels();
  // PRODUCT.md §Decisions 6: the decision store is a workspace setting, not a track. For a multi-repo
  // workspace the dedicated decision-store repo is excluded; a single-repo workspace keeps its repo
  // (it serves both roles). Tracks are code repos only.
  const trackOptions: RepoId[] =
    workspace.repos.length > 1 ? workspace.repos.filter((r) => r !== workspace.decisionStore) : workspace.repos;

  // WO-0049: the spawn seeds title/description/tracks — SEEDS, not locks; everything stays editable
  // ("gerisi bugünkü akışın aynısı"). The repo compare is a plain string compare against branded ids
  // — no identity constructor runs in ui (ADR-0003); an unresolvable seed leaves all tracks on, the
  // plain default. WO-0092: the issue spawn's repo seed rides the same string compare.
  const seedRepo = prefill?.repo ?? issuePrefill?.repo;
  const seededTracks = seedRepo !== undefined && trackOptions.some((r) => (r as string) === seedRepo)
    ? trackOptions.filter((r) => (r as string) === seedRepo)
    : trackOptions;
  const spawnSeeded = prefill !== undefined || issuePrefill !== undefined;
  const [title, setTitle] = useState(prefill?.title ?? issuePrefill?.title ?? '');
  const [description, setDescription] = useState(prefill?.note ?? issuePrefill?.body ?? '');
  // WO-0092 fix round (m2): the issue spawn's repo seed applies like the roadmap spawn's — a
  // spawn-seeded dialog mounts with the SEEDED tracks, never the plain all-tracks default.
  const [selectedTracks, setSelectedTracks] = useState<RepoId[]>(spawnSeeded ? seededTracks : trackOptions);
  // WO-0071: per-track depends_on picks — the track's RepoId keyed by its string form (a plain
  // string compare against branded ids, the seededTracks precedent; no identity constructor in ui).
  const [depSelection, setDepSelection] = useState<Record<string, RepoId[]>>({});
  const [reviewMode, setReviewMode] = useState<ReviewMode>('gates');
  const [permissionRule, setPermissionRule] = useState<PermissionRule>(defaultRule);
  const [contextFiles, setContextFiles] = useState<string[]>([]);
  // WO-0088: the wave worktree — the WO's own working copy; empty = the connection table resolves.
  const [cwd, setCwd] = useState('');
  const [cwdErr, setCwdErr] = useState<string | null>(null);
  // WO-0093: the worktree automation — default ON for new orders with a repo to copy; the
  // operator's own cwd override beats it (the precedence line says so when both stand).
  const [checkout, setCheckout] = useState(trackOptions.length > 0);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  function toggleTrack(repo: RepoId) {
    const on = selectedTracks.includes(repo);
    setSelectedTracks(on ? selectedTracks.filter((r) => r !== repo) : [...selectedTracks, repo]);
    // A deselected track loses its own picks AND every pick naming it — a stale entry must not
    // resurrect as a dependency when the repo comes back.
    if (on) {
      setDepSelection((prev) => {
        const next: Record<string, RepoId[]> = {};
        for (const [k, v] of Object.entries(prev)) {
          if (k !== (repo as string)) next[k] = v.filter((x) => x !== repo);
        }
        return next;
      });
    }
  }

  function toggleDep(track: RepoId, dep: RepoId) {
    setDepSelection((prev) => {
      const cur = prev[track as string] ?? [];
      const next = cur.includes(dep) ? cur.filter((x) => x !== dep) : [...cur, dep];
      const record: Record<string, RepoId[]> = { ...prev, [track as string]: next };
      if (next.length === 0) delete record[track as string];
      return record;
    });
  }

  async function pickContext() {
    try {
      const picked = await window.docket.pickFiles();
      if (picked) setContextFiles((prev) => [...prev, ...picked.filter((p) => !prev.includes(p))]);
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed }); // B5: surface, don't vanish — as a toast
    }
  }
  function removeContext(i: number) {
    setContextFiles((prev) => prev.filter((_p, idx) => idx !== i));
  }

  async function save(withPlan = false) {
    // WO-0036: the refusal lands under the field and takes the focus — the WsSettingsModal contract.
    if (!title.trim()) {
      setTitleErr(UI.woErrTitle);
      titleRef.current?.focus();
      return;
    }
    setTitleErr(null);
    // WO-0088 rev (m6): the SHAPE gate under the field — a working copy must be absolute (existence
    // is the store's refusal, surfaced as the toast). ADR-0012: the error lives under its field.
    if (cwd.trim() !== '' && !cwdOverrideIsAbsolute(cwd.trim())) {
      setCwdErr(UI.woCwdErr);
      return;
    }
    setCwdErr(null);
    // WO-0071: only tracks WITH ≥1 pick enter the payload; a pick naming a since-deselected track
    // never rides. Empty map → the field stays absent (the pre-WO-0071 call, byte-for-byte).
    const picked = selectedTracks
      .map((t) => ({ repo: t, dependsOn: (depSelection[t as string] ?? []).filter((d) => selectedTracks.includes(d)) }))
      .filter((e) => e.dependsOn.length > 0);
    try {
      const wo = await source.createWorkOrder({
        workspaceId: workspace.id,
        title: title.trim(),
        description: description.trim(),
        trackRepos: selectedTracks,
        reviewMode,
        contextFiles,
        permissionRule,
        // WO-0049: the task→WO link — the task identity, written regardless of the track selection.
        ...(prefill !== undefined ? { taskRef: prefill.taskId } : {}),
        // WO-0092: the issue→WO link — the `owner/repo#N` ref, written regardless of the tracks.
        ...(issuePrefill !== undefined ? { issueRef: issuePrefill.ref } : {}),
        ...(picked.length > 0 ? { trackDependencies: picked } : {}),
        ...(cwd.trim() !== '' ? { cwd: cwd.trim() } : {}),
        // WO-0093: the enablement rides the front-matter idiom — ON writes `checkout: true`;
        // OFF writes nothing (silence IS disabled, the pre-WO-0093 bytes).
        ...(checkout && cwd.trim() === '' ? { checkout: true } : {}),
      });
      onCreated(wo, withPlan);
      onClose();
    } catch {
      // B5: the modal stays open (the draft survives) — the refusal itself is a toast, never footer copy.
      toast.push({ kind: 'error', title: UI.saveFailed });
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.woCreate}
      closeAria={UI.dialogCloseAria}
      wide
      // WO-0036: Radix would focus the first focusable (the close X); preventDefault lets the
      // title Input's autoFocus win — the DetailStrip edit dialog's workaround, ported.
      onOpenAutoFocus={(e) => e.preventDefault()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.close}</Button>
          <Button variant="secondary" size="sm" onClick={() => void save()}>{UI.woCreateBtn}</Button>
          <Button variant="primary" size="sm" className="min-w-[150px]" onClick={() => void save(true)}>{UI.createAndPlan}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {prefill !== undefined ? (
          // Kare 06: the ONE uneditable line — where this WO comes from. Display-only (not focusable);
          // the seeded fields below it stay fully editable.
          <div
            data-task-context
            className="flex items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-1.5"
          >
            <span className="font-mono text-[10.5px] tracking-wide text-signal">
              {UI.roadmapSpawnContext(fazLabel(prefill.fazId), prefill.ordinal, prefill.title, prefill.repo)}
            </span>
          </div>
        ) : null}
        {issuePrefill !== undefined ? (
          // WO-0092: the issue spawn's ONE uneditable origin line; the seeded fields stay editable.
          <div
            data-issue-context
            className="flex items-center gap-2 rounded-md border border-hairline bg-bg px-2.5 py-1.5"
          >
            <span className="font-mono text-[10.5px] tracking-wide text-signal">
              {UI.issueSpawnContext(issuePrefill.ref)}
            </span>
          </div>
        ) : null}
        <Field label={UI.woTitleLabel} error={titleErr}>
          <Input
            ref={titleRef}
            autoFocus
            aria-required="true"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleErr(null); }}
            placeholder={UI.woTitlePlaceholder}
          />
        </Field>

        <Field label={UI.woDescLabel}>
          <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={UI.woDescPlaceholder} className="font-sans text-[13px]" />
        </Field>

        {trackOptions.length > 0 ? (
          <section>
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woTracksLabel}</span>
            <div className="flex flex-wrap gap-2">
              {trackOptions.map((r) => {
                const checked = selectedTracks.includes(r);
                return (
                  <button
                    type="button"
                    key={r as string}
                    aria-pressed={checked}
                    onClick={() => toggleTrack(r)}
                    className={`ichip inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${checked ? 'ichip-on' : ''}`}
                  >
                    <span aria-hidden="true" className={`font-mono text-[11px] ${checked ? 'text-info' : ''}`}>{checked ? '✓' : '○'}</span>
                    <span className="font-mono text-[11px]">{r as string}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}

        {/* WO-0071: the per-track depends_on picker — absent below 2 selected tracks (one track has
            nothing to depend on, ADR-0001); a track's own chip is simply never rendered, so
            self-dependence has no path in (the store validator is the second layer). */}
        {selectedTracks.length >= 2 ? (
          <section>
            <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.createDependsTitle}</span>
            <span className="mb-2 block text-[11px] text-inkdim">{UI.createDependsHint}</span>
            <div className="flex flex-col gap-2">
              {selectedTracks.map((t) => (
                <div key={t as string} className="flex flex-wrap items-center gap-1.5">
                  <span className="min-w-[88px] font-mono text-[11px]">{t as string}</span>
                  {selectedTracks
                    .filter((o) => o !== t)
                    .map((o) => {
                      const on = (depSelection[t as string] ?? []).includes(o);
                      return (
                        <button
                          type="button"
                          key={o as string}
                          aria-pressed={on}
                          onClick={() => toggleDep(t, o)}
                          className={`ichip inline-flex items-center gap-1.5 rounded-md px-2 py-1 ${on ? 'ichip-on' : ''}`}
                        >
                          <span aria-hidden="true" className={`font-mono text-[11px] ${on ? 'text-info' : ''}`}>{on ? '✓' : '○'}</span>
                          <span className="font-mono text-[11px]">{o as string}</span>
                        </button>
                      );
                    })}
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woContextLabel}</span>
          {contextFiles.length > 0 ? (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {contextFiles.map((p, i) => (
                <span key={p} title={p} className="inline-flex items-center gap-1 rounded border border-hairline bg-bg px-2 py-0.5 font-mono text-[11px] text-inkdim">
                  {base(p)}
                  <Tooltip label={UI.removeAria}><button type="button" onClick={() => removeContext(i)} className="ibtn ibtn-danger px-0.5" aria-label={UI.removeAria}><X className="h-3 w-3" aria-hidden="true" /></button></Tooltip>
                </span>
              ))}
            </div>
          ) : null}
          <Button variant="ghost" size="sm" onClick={() => void pickContext()}>
            <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
            {UI.woContextAdd}
          </Button>
        </section>

        {/* WO-0088: the per-WO working copy — the wave worktree; absent = the connection table.
            WO-0093: the automation's choice rides ABOVE it — the operator's own path wins the
            precedence, and the line says so honestly when both stand (the store encodes it). */}
        <section>
          <Field label={UI.woCwdLabel} error={cwdErr}>
            <Input
              value={cwd}
              onChange={(e) => { setCwd(e.target.value); setCwdErr(null); }}
              placeholder={UI.woCwdPlaceholder}
              aria-label={UI.woCwdLabel}
              className="font-mono text-[12px]"
            />
          </Field>
          {trackOptions.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2">
              <button
                type="button"
                data-wo-checkout
                aria-pressed={checkout}
                onClick={() => setCheckout((v) => !v)}
                className={`ichip inline-flex w-fit items-center gap-1.5 rounded-md px-2 py-1 ${checkout ? 'ichip-on' : ''}`}
              >
                <span aria-hidden="true" className={`font-mono text-[11px] ${checkout ? 'text-info' : ''}`}>{checkout ? '✓' : '○'}</span>
                <span className="font-mono text-[11px]">{UI.woCheckoutLabel}</span>
              </button>
              {checkout && cwd.trim() !== '' ? (
                <p data-checkout-precedence className="text-[11px] text-inkdim">{UI.woCheckoutPrecedence}</p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.woReviewLabel}</span>
          <Segmented
            value={reviewMode}
            onValueChange={setReviewMode}
            options={[
              { value: 'gates', label: UI.reviewModeGatesShort },
              { value: 'every-step', label: UI.reviewModeEveryShort },
            ]}
          />
        </section>

        {/* WO-0031c: the rule lives on the work order; Settings holds only this default. */}
        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.permRuleQuestion}</span>
          <Segmented
            value={permissionRule}
            onValueChange={setPermissionRule}
            options={[
              { value: 'ask_every', label: PERMISSION_RULE_LABELS.ask_every },
              { value: 'risky_excluded', label: PERMISSION_RULE_LABELS.risky_excluded },
              { value: 'full_auto', label: PERMISSION_RULE_LABELS.full_auto },
            ]}
          />
        </section>
      </div>
    </Dialog>
  );
}
