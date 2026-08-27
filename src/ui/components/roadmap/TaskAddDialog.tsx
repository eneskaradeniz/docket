// TaskAddDialog (WO-0049, Ekle-only) — append one task to a faz. The repo is REQUIRED (operator
// ruling): a repo-less task is spawn-dead by repo_yok, and this surface does not create dead ends.
// Same contract as FazAddDialog: re-read at save, parse-guarded write, refusal = toast + the draft
// survives. A faz deleted by hand since load refuses honestly (it is no longer there to receive).
import { useRef, useState } from 'react';
import type { Workspace } from '../../../core/types';
import type { WorkOrderSource } from '../../../core/source';
import type { FazView } from '../../../core/roadmap';
import { applyFazlarEdits, nextTaskId, parseRoadmapMd, type FazSpec } from '../../../core/roadmap-md';
import { useLabels } from '../../data/locale';
import { Button, Dialog, Field, Input, cn } from '../../kit';
import { toast } from '../../chrome/ToastHost';

export function TaskAddDialog({
  workspace,
  source,
  faz,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  source: WorkOrderSource;
  /** The target faz (from the loaded view; save re-reads the file and re-finds it by id). */
  faz: FazView;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { UI } = useLabels();
  const [title, setTitle] = useState('');
  const [repo, setRepo] = useState<string | undefined>(undefined);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [repoErr, setRepoErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  async function save() {
    // First-invalid takes the focus (WO-0036); validity never locks the button.
    if (!title.trim()) {
      setTitleErr(UI.woErrTitle);
      titleRef.current?.focus();
      return;
    }
    if (repo === undefined) {
      setRepoErr(UI.roadmapErrRepo);
      return;
    }
    setTitleErr(null);
    setRepoErr(null);
    setBusy(true);
    try {
      const md = await source.getRoadmapMd(workspace.id);
      const parsed = parseRoadmapMd(md);
      if (parsed.parseError !== undefined) {
        toast.push({ kind: 'error', title: UI.saveFailed });
        return;
      }
      const target = parsed.fazlar.find((f) => f.id === faz.id);
      if (target === undefined) {
        // The faz left the document since load — refuse; the roadmap re-reads and shows the truth.
        toast.push({ kind: 'error', title: UI.saveFailed });
        return;
      }
      const task = { id: nextTaskId(faz.id, parsed.fazlar), title: title.trim(), repo };
      const withTask: FazSpec[] = parsed.fazlar.map((f) => (f.id === faz.id ? { ...f, tasks: [...f.tasks, task] } : f));
      await source.saveRoadmap(workspace.id, applyFazlarEdits(md, withTask));
      onSaved();
      onClose();
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.roadmapTaskAddTitle}
      closeAria={UI.dialogCloseAria}
      onOpenAutoFocus={(e) => e.preventDefault()}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.close}</Button>
          <Button variant="primary" size="sm" busy={busy} onClick={() => void save()}>{UI.woEditSave}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={UI.woTitleLabel} error={titleErr}>
          <Input
            ref={titleRef}
            autoFocus
            aria-required="true"
            value={title}
            onChange={(e) => { setTitle(e.target.value); setTitleErr(null); }}
          />
        </Field>
        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.woTracksLabel}
          </span>
          <div className="flex flex-wrap gap-2">
            {workspace.repos.map((r) => {
              const key = r as string;
              const checked = repo === key;
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={checked}
                  onClick={() => { setRepo(key); setRepoErr(null); }}
                  className={cn('ichip inline-flex items-center gap-1.5 rounded-md px-2 py-1', checked ? 'ichip-on' : '')}
                >
                  <span aria-hidden="true" className={`font-mono text-[11px] ${checked ? 'text-info' : ''}`}>{checked ? '✓' : '○'}</span>
                  <span className="font-mono text-[11px]">{key}</span>
                </button>
              );
            })}
          </div>
          {repoErr !== null ? (
            <p role="alert" className="mt-1.5 text-[11.5px] text-error">{repoErr}</p>
          ) : null}
        </section>
      </div>
    </Dialog>
  );
}
