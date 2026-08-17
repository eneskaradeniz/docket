import { useState } from 'react';
import { Check, FolderOpen, X } from 'lucide-react';
import type { Workspace } from '../../core/types';
import type { WorkOrderSource } from '../../core/source';
import { UI } from '../data/labels';
import { Button, Dialog, Field, Input } from '../kit';

const base = (p: string): string => {
  let s = p;
  while (s.endsWith('/')) s = s.slice(0, -1);
  return s.split('/').pop() || 'repo';
};
const valid = (p: string): boolean => p.startsWith('/') && p.length > 1 && !p.endsWith('/');

// Workspace create/edit modal (WO-0014; WO-0031b kit restyle). Create = full form (name + folder-picked
// OR typed repos + decision store). Edit = rename + set decision store + add repos.
export function WsSettingsModal({
  mode,
  workspace,
  source,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  workspace?: Workspace;
  source: WorkOrderSource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(workspace?.label ?? '');
  const [paths, setPaths] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [decisionStore, setDecisionStore] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Code repos known so far: the workspace's existing repos (edit mode) + the basenames of typed/picked
  // paths. The decision store is one of these only when there are ≥2 (a dedicated docs repo); with one
  // repo it is implicitly that repo's docs/ folder, so the selector is hidden (PRODUCT.md §Decisions 6).
  const allRepos = [
    ...(workspace?.repos.map((r) => r as string) ?? []),
    ...paths.map(base),
  ];

  function addDraft() {
    const p = draft.trim();
    if (!p) return;
    setPaths((prev) => [...prev, p]);
    setDraft('');
    setError(null);
  }
  function updatePath(i: number, value: string) {
    setPaths((prev) => prev.map((p, idx) => (idx === i ? value : p)));
    setError(null);
  }
  function removePath(i: number) {
    setPaths((prev) => prev.filter((_p, idx) => idx !== i));
    setError(null);
  }
  async function pick() {
    try {
      const p = await window.docket.pickFolder();
      if (p) {
        setPaths((prev) => [...prev, p]);
        setError(null);
      }
    } catch {
      setError(UI.saveFailed);
    }
  }

  async function save() {
    if (!name.trim()) { setError(UI.wsErrName); return; }
    if (mode === 'create' && !paths.some(valid)) { setError(UI.wsErrRepo); return; }
    setError(null);
    try {
      if (mode === 'create') {
        await source.createWorkspace({
          label: name.trim(),
          repos: paths.map((p) => ({ path: p })),
          decisionStorePath: decisionStore || undefined,
        });
      } else if (workspace) {
        await source.updateWorkspace(workspace.id, { label: name.trim(), decisionStorePath: decisionStore || undefined });
        for (const p of paths) {
          await source.addRepoConnection(workspace.id, { path: p });
        }
      }
      onSaved();
      onClose();
    } catch {
      setError(UI.saveFailed); // B5: surface, don't swallow (WO-0026)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={mode === 'create' ? UI.wsCreate : UI.wsSettings}
      footer={
        <>
          {error ? <span className="mr-auto text-[11px] text-error">{error}</span> : null}
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.close}</Button>
          <Button variant="primary" size="sm" onClick={() => void save()}>{mode === 'create' ? UI.wsCreateBtn : UI.wsSave}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label={UI.wsNameLabel}>
          <Input value={name} onChange={(e) => { setName(e.target.value); setError(null); }} />
        </Field>

        <section>
          <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-inkdim">{UI.wsReposLabel}</span>
          {mode === 'edit' && workspace ? (
            <div className="mb-2 flex flex-col gap-1">
              {workspace.repos.map((r) => (
                <div key={r as string} className="flex items-center gap-2 rounded-md border border-hairline bg-bg px-2 py-1.5">
                  <span className="font-mono text-[12px] text-inkdim">{r as string}</span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mb-2 flex flex-col gap-1.5">
            {paths.map((p, i) => (
              <div key={i} className="flex items-center gap-1.5 rounded-md border border-hairline bg-bg px-2 py-1.5">
                <span className={`shrink-0 ${valid(p) ? 'text-proceed' : 'text-error'}`}>
                  {valid(p) ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <X className="h-3.5 w-3.5" aria-hidden="true" />}
                </span>
                <Input value={p} onChange={(e) => updatePath(i, e.target.value)} className="flex-1 border-0 bg-transparent px-0 py-0 font-mono text-[11px] focus-visible:border-0" />
                <button type="button" onClick={() => removePath(i)} className="shrink-0 px-1 text-error" aria-label="kaldır">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
          {/* Path entry: type a path + Add, or pick a folder. Both append a (still-editable) row. */}
          <div className="flex gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDraft(); } }}
              placeholder={UI.wsRepoPlaceholder}
              className="flex-1 font-mono text-[12px]"
            />
            <Button variant="secondary" size="sm" onClick={addDraft}>{UI.wsRepoAddManual}</Button>
            <Button variant="ghost" size="sm" onClick={() => void pick()}>
              <FolderOpen className="h-3.5 w-3.5" aria-hidden="true" />
              {UI.wsRepoPick}
            </Button>
          </div>
        </section>

        {allRepos.length >= 2 ? (
          <Field label={UI.wsDecisionStore}>
            <select
              value={decisionStore || allRepos[0]}
              onChange={(e) => setDecisionStore(e.target.value)}
              className="w-full rounded-md border border-hairline bg-bg px-2.5 py-1.5 text-[13px] text-ink focus-visible:border-signal focus-visible:outline-none"
            >
              {allRepos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}
