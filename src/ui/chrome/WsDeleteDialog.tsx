// WsDeleteDialog — the workspace-deletion confirm (WO-0032), the WO Sil dialog's sibling: the
// counted irreversible-consequence line, a danger confirm with no ⏎ path (deliberate friction on
// the irreversible), and a failed delete that keeps the dialog open (the store guard fires before
// any row — nothing was deleted). Rendered OVER the settings modal that invoked it (stacked — the
// parent recedes behind this overlay; narrow — a focused yes/no, centered, never offset), the WO
// dialogs' pattern: Vazgeç (or Esc/overlay) returns to that modal with its edits intact; only a
// successful delete closes both. All copy via labels.ts (ADR-0007).
import { useState } from 'react';
import type { Workspace } from '../../core/types';
import { UI } from '../data/labels';
import { Button, Dialog } from '../kit';

export function WsDeleteDialog({
  workspace,
  woCount,
  onDelete,
  onCancel,
  onDeleted,
}: {
  workspace: Workspace;
  woCount: number;
  onDelete: (ws: Workspace) => Promise<void>;
  /** Back to the settings modal underneath — the invoker stays mounted, its edits survive. */
  onCancel: () => void;
  /** The delete succeeded: the workspace is gone, so BOTH dialogs close (AppShell decides). */
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  async function del(): Promise<void> {
    setDeleting(true);
    setDeleteError(false);
    try {
      await onDelete(workspace);
      onDeleted();
    } catch {
      setDeleteError(true); // the dialog stays open for a retry — a failed delete deletes nothing
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open
      stacked
      narrow
      onOpenChange={(o) => { if (!o && !deleting) onCancel(); }}
      title={UI.wsDelete}
      closeAria={UI.dialogCloseAria}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>{UI.cancel}</Button>
          <Button variant="danger" size="sm" busy={deleting} onClick={() => void del()}>{UI.wsDeleteConfirm}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-[12px] text-inkdim">{UI.wsDeleteHint(woCount)}</p>
        {deleteError ? <p className="text-xs text-error">{UI.wsDeleteFailed}</p> : null}
      </div>
    </Dialog>
  );
}
