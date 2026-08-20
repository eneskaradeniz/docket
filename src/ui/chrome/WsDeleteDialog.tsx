// WsDeleteDialog — the workspace-deletion confirm (WO-0032), the WO Sil dialog's sibling: the
// counted irreversible-consequence line, a danger confirm with no ⏎ path (deliberate friction on
// the irreversible), and a failed delete that keeps the dialog open (the store guard fires before
// any row — nothing was deleted). All copy via labels.ts (ADR-0007).
import { useState } from 'react';
import type { Workspace } from '../../core/types';
import { UI } from '../data/labels';
import { Button, Dialog } from '../kit';

export function WsDeleteDialog({
  workspace,
  woCount,
  onDelete,
  onClose,
}: {
  workspace: Workspace;
  woCount: number;
  onDelete: (ws: Workspace) => Promise<void>;
  onClose: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(false);

  async function del(): Promise<void> {
    setDeleting(true);
    setDeleteError(false);
    try {
      await onDelete(workspace);
      onClose(); // success closes — App's handler already refreshed the lists
    } catch {
      setDeleteError(true); // the dialog stays open for a retry — a failed delete deletes nothing
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o && !deleting) onClose(); }}
      title={UI.wsDelete}
      closeAria={UI.dialogCloseAria}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>{UI.cancel}</Button>
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
