// RoadmapDraftDialog (WO-0050, mockup kare 04) — the ✦ gate: ONE mechanism, one form. The goal
// note is REQUIRED (the generate branch is its floor); the source-doc list is the ONLY import
// distinction — doluysa mimar onları okur, boşsa hedef notundan üretir. Paths are picked with
// the native picker (`docket:pick-files`), live in THIS dialog's state alone and die with it
// (mockup karar: kalıcı değiller — they reach the DriveInput and thus the prompt, nothing else;
// Docket never reads their contents). Another drive running is stated as the footer's one-line
// error (ADR-0001 — present with reason, never a disabled button).
import { useEffect, useRef, useState } from 'react';
import { FileText, X } from 'lucide-react';
import type { WorkspaceId } from '../../../core/types';
import { useLabels } from '../../data/locale';
import { toast } from '../../chrome/ToastHost';
import { Button, Textarea } from '../../kit';
import { initialSessionState } from '../../../core/runner';
import { useDriveStore } from '../session/drive-store';
import { EnterMark } from '../EnterMark';

export function RoadmapDraftDialog({
  workspaceId,
  onClose,
}: {
  workspaceId: WorkspaceId;
  onClose: () => void;
}) {
  const { UI } = useLabels();
  const store = useDriveStore();
  const [note, setNote] = useState('');
  const [docPaths, setDocPaths] = useState<string[]>([]);
  const [touched, setTouched] = useState(false);
  const [busyError, setBusyError] = useState<string | undefined>(undefined);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  // First-invalid focused on open (WO-0036 posture — the note is the one required field).
  useEffect(() => {
    noteRef.current?.focus();
  }, []);

  const noteInvalid = touched && !note.trim() ? UI.roadmapDraftNoteErr : null;

  const pickDocs = (): void => {
    // The WoCreateModal precedent: a refused IPC call toasts, never an unhandled rejection.
    void window.docket
      .pickFiles()
      .then((paths) => {
        if (!paths) return;
        setDocPaths((prior) => [...prior, ...paths.filter((p) => !prior.includes(p))]);
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
    const ok = store.start(
      `${workspaceId}:draft`,
      { role: 'architect', workspaceId, mode: 'plan', prompt: '', goalNote: note.trim(), docPaths },
      initialSessionState,
    );
    if (!ok) {
      setBusyError(UI.roadmapDraftBusy);
      return;
    }
    onClose();
  };

  const visible = docPaths.slice(0, 3);
  const more = docPaths.length - visible.length;

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
          <div className="flex flex-col gap-1.5">
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
          <div className="flex flex-col gap-1.5">
            <div className="text-[12px] font-medium text-ink">
              {UI.roadmapDraftDocsLabel} <span className="font-normal text-inkdim">{UI.roadmapDraftDocsOptional}</span>
            </div>
            {docPaths.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {visible.map((p) => (
                  <li key={p} className="flex items-center gap-2 rounded-md border border-hairline bg-raised/40 px-2.5 py-1.5">
                    <FileText className="size-3.5 shrink-0 text-inkdim" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-inkdim" title={p}>{p}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={UI.roadmapDraftDocRemoveAria(p)}
                      onClick={() => setDocPaths((prior) => prior.filter((x) => x !== p))}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            {more > 0 ? <p className="font-mono text-[11px] text-inkdim">{UI.roadmapDraftDocMore(more)}</p> : null}
            <div>
              <Button variant="ghost" size="sm" data-draft-doc-pick onClick={pickDocs}>
                {UI.roadmapDraftDocPick}
              </Button>
            </div>
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
