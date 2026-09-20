// RoadmapDraftDialog (WO-0050 kare 04 → WO-0051 kanal kompozisyonu · SUNUM rev 3) — the ✦ gate:
// ONE mechanism, ONE form; the source set is the operator's free COMPOSITION of channels —
// depo (the structure root's .md scan at open, ALL included by default, exceptions excluded at
// group level) ∪ ek belgeler (any path via the native picker — structure root and repo outside
// included) ∪ serbest keşif (opt-in chip, default OFF; the architect may browse the repo
// itself, at token cost) + the REQUIRED goal note (the zero-doc floor: an empty composition
// generates from the note alone — same dialog, no second form).
//
// Rev 3 (operator round 2026-08-28, mockup rev 3 — "tek blok · tek satır dili · ad önce"): the
// channel word renders at most ONCE (never on a row); the store line is a BORDERLESS single
// number (`docs/ · 9 belge — tümü dahil`, `20 / 90` on exception); picked rows speak by NAME
// (13px sans) with a front-truncated dim location — the house card idiom, not a path dump; both
// chips are one shape; the consequence line is unboxed. The ordinary flow stays zero selection
// work: with the store line collapsed, `Taslağı başlat` sends everything the scan found.
//
// Paths live in THIS dialog's state alone and die with it (mockup karar 5); only COUNTS survive,
// through the drive input (`docSource`) to the pending row's summary. Docket never reads a
// document's contents (ADR-0016). Another drive running stays the footer's one-line error
// (ADR-0001 — present with reason, never a disabled button).
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { WorkspaceId } from '../../../core/types';
import { draftDocGroupKeyOf, draftDocGroups, draftStorePaths, mergePickedPaths } from '../../../core/roadmap-draft';
import { useLabels } from '../../data/locale';
import { toast } from '../../chrome/ToastHost';
import { Button, Textarea, cn } from '../../kit';
import { initialSessionState } from '../../../core/runner';
import { useDriveStore } from '../session/drive-store';
import { EnterMark } from '../EnterMark';

/** The DEPO scan at dialog open: loading → ready ({docsRoot, files}) → failed (the zero-doc
 *  floor — the not-found line; the picker channel stays usable). */
type ScanState =
  | { status: 'loading' }
  | { status: 'ready'; docsRoot: string; files: string[] }
  | { status: 'failed' };

const FLAT_ROWS_CAP = 8; // a flat root caps its rows; the store line carries the truth
const PICKED_ROWS_CAP = 3; // the picked list caps like the WO-0050 doc chips did
const LOC_CAP = 26; // the picked row's location meta — front-truncated, the tail carries the identity

const basenameOf = (p: string): string => p.split('/').pop() || p;
/** The picked row's location meta is the PARENT DIR (the name already leads the row — showing
 *  it twice would be the redundancy rev 3 killed), front-truncated: `…/source/base-mobile`.
 *  A path with no separator has no location worth showing ('' — the span omits). */
const locationOf = (p: string, max = LOC_CAP): string => {
  const i = p.lastIndexOf('/');
  const parent = i === -1 ? '' : p.slice(0, i);
  if (parent === '') return '';
  return parent.length <= max ? parent : `…${parent.slice(-(max - 1))}`;
};

export function RoadmapDraftDialog({
  workspaceId,
  docsRoot,
  onClose,
}: {
  workspaceId: WorkspaceId;
  /** The effective structure root (the screen's own prop) — the scanning line names it. */
  docsRoot: string;
  onClose: () => void;
}) {
  const { UI } = useLabels();
  const store = useDriveStore();
  const [note, setNote] = useState('');
  const [scan, setScan] = useState<ScanState>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);
  /** Excluded exceptions — GROUP keys when the scan groups, file paths on a flat root. */
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  /** The EK BELGELER channel: picked paths (any path — outside the structure root/repo included). */
  const [picked, setPicked] = useState<string[]>([]);
  const [freeExplore, setFreeExplore] = useState(false);
  /** A start clicked while the scan was still loading — fired when the scan settles (f7). */
  const [pendingStart, setPendingStart] = useState(false);
  const [touched, setTouched] = useState(false);
  const [busyError, setBusyError] = useState<string | undefined>(undefined);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // First-invalid focused on open (WO-0036 posture — the note is the one required field).
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  // The DEPO scan at open (WO-0051 / D3): structure-root-relative paths, the absolute root
  // never crossing IPC (ADR-0001). A refusal degrades to the not-found line — the composition
  // stays open through the other channels.
  useEffect(() => {
    let alive = true;
    void window.docket
      .listDecisionDocs(workspaceId)
      .then((r) => {
        if (alive) setScan({ status: 'ready', docsRoot: r.docsRoot, files: r.files });
      })
      .catch(() => {
        if (alive) setScan({ status: 'failed' });
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  const noteInvalid = touched && !note.trim() ? UI.roadmapDraftNoteErr : null;

  const groups = scan.status === 'ready' ? draftDocGroups(scan.files) : { groups: [], grouped: false };
  // The exclusion set keys on core's own group rule (review f4: one expression, not two).
  const includedFiles =
    scan.status === 'ready'
      ? scan.files.filter((f) => !excluded.has(groups.grouped ? draftDocGroupKeyOf(f) : f))
      : [];
  // The prompt's path UNION, deduplicated across channels (review f3): a picked path that
  // already IS a store path enters once and does not count as an addition.
  const storePaths = scan.status === 'ready' ? draftStorePaths(scan.docsRoot, includedFiles) : [];
  const docPaths = mergePickedPaths(storePaths, picked);

  const toggleExcluded = (key: string): void => {
    setExcluded((prior) => {
      const next = new Set(prior);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const pickDocs = (): void => {
    // The WoCreateModal precedent: a refused IPC call toasts, never an unhandled rejection.
    void window.docket
      .pickFiles()
      .then((paths) => {
        if (!paths) return;
        setPicked((prior) => [...prior, ...paths.filter((p) => !prior.includes(p))]);
      })
      .catch(() => {
        toast.push({ kind: 'error', title: UI.saveFailed });
      });
  };

  const start = (): void => {
    if (!note.trim()) {
      setTouched(true);
      noteRef.current?.focus();
      return;
    }
    // The default posture is deterministic by contract (karar 3) — a click inside the scan's
    // in-flight window is HELD, not answered with an empty store (review f7); the dispatch
    // fires the moment the scan lands (or the floor renders).
    if (scan.status === 'loading') {
      setPendingStart(true);
      return;
    }
    const ok = store.start(
      `${workspaceId}:draft`,
      {
        role: 'architect',
        workspaceId,
        mode: 'plan',
        prompt: '',
        goalNote: note.trim(),
        docPaths,
        docSource: { store: includedFiles.length, external: docPaths.length - storePaths.length },
        freeExplore,
      },
      initialSessionState,
    );
    if (!ok) {
      setBusyError(UI.roadmapDraftBusy);
      return;
    }
    onClose();
  };

  useEffect(() => {
    // A held start fires once, on the scan's settlement (success closes the dialog).
    if (!pendingStart || scan.status === 'loading') return;
    setPendingStart(false);
    start();
  }, [pendingStart, scan]);

  const visibleFlat = groups.grouped ? [] : includedFiles.slice(0, FLAT_ROWS_CAP);
  const flatMore = includedFiles.length - visibleFlat.length;
  const visiblePicked = picked.slice(0, PICKED_ROWS_CAP);
  const pickedMore = picked.length - visiblePicked.length;

  // One exclusion row (a group or a flat file): name + count, dışla / ↩ geri al. Excluded rows
  // dim + strike via classes — never a disabled control (ADR-0001).
  const excludeRow = (key: string, name: string, count: number, attrs: Record<string, string>) => {
    const off = excluded.has(key);
    return (
      <div
        {...attrs}
        data-off={off ? '' : undefined}
        className={cn(
          'flex items-center gap-2 rounded-md border border-hairline bg-raised/40 px-2.5 py-1.5',
          off ? 'opacity-55' : '',
        )}
      >
        <span
          aria-hidden="true"
          className={cn('size-[5px] shrink-0 rounded-full', off ? 'bg-hairline' : 'bg-proceed')}
        />
        <span className={cn('min-w-0 flex-1 truncate font-mono text-[11px] text-inkdim', off ? 'line-through' : '')} title={name}>
          {name}
        </span>
        {count > 0 ? <span className="shrink-0 font-mono text-[10px] text-inkdim">{UI.roadmapDraftGroupCount(count)}</span> : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={(off ? UI.roadmapDraftIncludeAria : UI.roadmapDraftExcludeAria)(name)}
          onClick={() => toggleExcluded(key)}
        >
          {off ? UI.roadmapDraftInclude : UI.roadmapDraftExclude}
        </Button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/45 p-6" role="dialog" aria-modal="true" aria-label={UI.roadmapDraftDialogTitle}>
      <div data-roadmap-draft-dialog className="mt-[8vh] w-full max-w-[560px] overflow-hidden rounded-md border border-hairline bg-surface shadow-lg">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
          <span className="readout text-[13px]">{UI.roadmapDraftDialogTitle}</span>
          <Button variant="ghost" size="icon" aria-label={UI.cancel} onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        <div className="flex flex-col gap-4 px-4 py-4">
          <div className="flex flex-col gap-2">
            <label className="text-[12px] font-medium text-ink" htmlFor="roadmap-draft-note">
              {UI.roadmapDraftNoteLabel}
            </label>
            <Textarea
              id="roadmap-draft-note"
              ref={noteRef as never}
              rows={3}
              placeholder={UI.roadmapDraftNotePlaceholder}
              value={note}
              aria-required="true"
              aria-invalid={noteInvalid !== null}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteInvalid ? (
              <p role="alert" className="text-[12px] text-error">{noteInvalid}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium text-ink">{UI.roadmapDraftDocsLabel}</div>
            {scan.status === 'loading' ? (
              // The scan's one honest line (rev 3): root + verb, no box, no silence.
              <p className="font-mono text-[11px] text-inkdim" data-draft-scanning>{UI.roadmapDraftScanning(docsRoot)}</p>
            ) : scan.status === 'ready' && scan.files.length > 0 ? (
              <>
                {/* The store line (rev 3) — borderless, one number; the EXCEPTION doubles it. */}
                <button
                  type="button"
                  data-draft-storeline
                  aria-expanded={expanded}
                  onClick={() => setExpanded((v) => !v)}
                  className="irow -mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-[11px] text-inkdim hover:text-ink"
                >
                  <span aria-hidden="true" className="text-[10px]">{expanded ? '▾' : '▸'}</span>
                  <span className="truncate">{UI.roadmapDraftStoreLine(scan.docsRoot, scan.files.length, includedFiles.length)}</span>
                </button>
                {expanded ? (
                  <div className="flex flex-col gap-1" data-draft-docpick>
                    {groups.grouped
                      ? groups.groups.map((g) =>
                          excludeRow(
                            g.key,
                            UI.roadmapDraftGroupLabel(scan.docsRoot, g.key),
                            g.files.length,
                            { 'data-draft-group': g.key },
                          ),
                        )
                      : visibleFlat.map((f) => excludeRow(f, f, 0, { 'data-draft-file': f }))}
                    {flatMore > 0 ? (
                      <p className="pl-0.5 font-mono text-[10.5px] text-inkdim">{UI.roadmapDraftMoreAll(flatMore)}</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              // The zero-doc floor: the fact + what happens next; the picker chip stays live.
              <p className="text-[12px] leading-normal text-inkdim" data-draft-nodocs>
                {UI.roadmapDraftNoDocs(scan.status === 'ready' ? scan.docsRoot : docsRoot)}
              </p>
            )}
            {picked.length > 0 ? (
              <div className="flex flex-col gap-1" data-draft-picked>
                {/* The channel word, once — the head. The rows below carry no label. */}
                <p className="pt-1 font-mono text-[9.5px] uppercase tracking-[0.1em] text-inkdim">
                  {UI.roadmapDraftPickedSubhead(picked.length)}
                </p>
                {visiblePicked.map((p) => (
                  /* Rev 3 anatomy: + mark · NAME (sans 13) · front-truncated dim location · ✕. */
                  <div key={p} className="flex items-center gap-2.5 rounded-md border border-hairline bg-raised/40 px-2.5 py-1.5">
                    <span aria-hidden="true" className="shrink-0 font-mono text-[12px] text-inkdim">+</span>
                    <span className="min-w-0 shrink-0 truncate text-[13px] font-semibold text-ink" title={p}>{basenameOf(p)}</span>
                    <span className="ml-auto min-w-0 truncate font-mono text-[10.5px] text-inkdim" title={p}>{locationOf(p)}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={UI.roadmapDraftDocRemoveAria(p)}
                      onClick={() => setPicked((prior) => prior.filter((x) => x !== p))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </div>
                ))}
                {pickedMore > 0 ? (
                  <p className="pl-0.5 font-mono text-[10.5px] text-inkdim">{UI.roadmapDraftDocMore(pickedMore)}</p>
                ) : null}
              </div>
            ) : null}
            {/* Both channels, one chip shape (rev 3 karar 4). */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                data-draft-doc-pick
                onClick={pickDocs}
                className="ichip inline-flex h-6 items-center gap-1 rounded-md px-2 font-mono text-[10px] uppercase tracking-[0.08em] text-inkdim hover:text-ink"
              >
                {UI.roadmapDraftDocPick}
              </button>
              <button
                type="button"
                data-draft-explore
                aria-pressed={freeExplore}
                onClick={() => setFreeExplore((v) => !v)}
                className={cn('ichip inline-flex h-6 items-center gap-1 rounded-md px-2 font-mono text-[10px] uppercase tracking-[0.08em]', freeExplore ? 'ichip-on text-ink' : 'text-inkdim hover:text-ink')}
              >
                <span aria-hidden="true" className={cn('font-mono', freeExplore ? 'text-info' : '')}>{freeExplore ? '✓' : '○'}</span>
                {UI.roadmapDraftExploreChip}
              </button>
            </div>
            {freeExplore ? (
              // The consequence line, unboxed (rev 3): one sentence, ✦-led, nothing around it.
              <p className="pl-0.5 text-[12px] leading-normal text-inkdim" data-draft-explore-info>
                <span aria-hidden="true" className="mr-1.5 text-signal">✦</span>
                {UI.roadmapDraftExploreInfo}
              </p>
            ) : null}
          </div>
          {busyError ? (
            <p role="alert" className="text-[12px] text-error">{busyError}</p>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-hairline px-4 py-3">
          <Button variant="ghost" onClick={onClose}>{UI.cancel}</Button>
          <Button variant="primary" data-draft-start onClick={start}>
            {UI.roadmapDraftStart}
            <EnterMark />
          </Button>
        </div>
      </div>
    </div>
  );
}
