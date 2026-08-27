// FazAddDialog (WO-0049, Ekle-only) — append one faz to roadmap.md. The WO-0036 form contract:
// errors under their field, first-invalid focused on submit, save failures toast top-right, the
// draft survives every refusal. The document is RE-READ at save time (the operator may have
// hand-edited since load — the file is the decision store); the fence is rewritten by
// applyFazlarEdits and saveRoadmap's parse guard refuses before any byte moves.
import { useRef, useState } from 'react';
import type { Workspace } from '../../../core/types';
import type { WorkOrderSource } from '../../../core/source';
import type { FazView } from '../../../core/roadmap';
import { applyFazlarEdits, nextFazId, parseRoadmapMd } from '../../../core/roadmap-md';
import { useLabels } from '../../data/locale';
import { Button, Dialog, Field, Input, Textarea } from '../../kit';
import { toast } from '../../chrome/ToastHost';
import { cn } from '../../kit';

export function FazAddDialog({
  workspace,
  source,
  fazlar,
  onClose,
  onSaved,
}: {
  workspace: Workspace;
  source: WorkOrderSource;
  /** The ready view's fazlar — the dependency chips + the id mint both read them (save re-reads the file). */
  fazlar: FazView[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { UI, fazLabel } = useLabels();
  const [title, setTitle] = useState('');
  const [aim, setAim] = useState('');
  const [blockedBy, setBlockedBy] = useState<string[]>([]);
  const [titleErr, setTitleErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  const toggleDep = (id: string) => {
    setBlockedBy((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  async function save() {
    if (!title.trim()) {
      setTitleErr(UI.woErrTitle);
      titleRef.current?.focus();
      return;
    }
    setTitleErr(null);
    setBusy(true);
    try {
      const md = await source.getRoadmapMd(workspace.id);
      const parsed = parseRoadmapMd(md);
      if (parsed.parseError !== undefined) {
        // An unparseable doc cannot be edited from here — fix the file by hand first.
        toast.push({ kind: 'error', title: UI.saveFailed });
        return;
      }
      const spec = {
        id: nextFazId(parsed.fazlar),
        title: title.trim(),
        ...(aim.trim() ? { aim: aim.trim() } : {}),
        blockedBy,
        tasks: [],
      };
      await source.saveRoadmap(workspace.id, applyFazlarEdits(md, [...parsed.fazlar, spec]));
      onSaved();
      onClose();
    } catch {
      toast.push({ kind: 'error', title: UI.saveFailed }); // the guard's refusal or the write — nothing moved
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={UI.roadmapFazAddTitle}
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
        <Field label={UI.roadmapFazAimLabel}>
          <Textarea rows={2} value={aim} onChange={(e) => setAim(e.target.value)} className="font-sans text-[13px]" />
        </Field>
        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">
            {UI.roadmapFazDependsLabel}
          </span>
          <div className="flex flex-wrap gap-2">
            {fazlar.map((f) => {
              const checked = blockedBy.includes(f.id);
              return (
                <button
                  type="button"
                  key={f.id}
                  aria-pressed={checked}
                  onClick={() => toggleDep(f.id)}
                  className={cn('ichip inline-flex items-center gap-1.5 rounded-md px-2 py-1', checked ? 'ichip-on' : '')}
                >
                  <span className="font-mono text-[11px]">{fazLabel(f.id)} · {f.title}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Dialog>
  );
}
