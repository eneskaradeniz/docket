// update-checker.ts — the app's own newer version. Machine-local state with no repo data and no
// fitting AuditAction (the permission board's answers are unlogged the same way), so the port
// sits beside AppDeps — the forge, tracker and discovery precedent — and the composition root
// hands it to the api. The real updater (release feed, download, install, signing) is a later
// contract; until then the infrastructure default is a no-op and the design seed gets a scripted
// checker.
import type { Result } from '../../domain/index';

/** `current` is the running app's version, `next` the one waiting. */
export type UpdateState =
  | { readonly kind: 'none'; readonly current: string }
  | { readonly kind: 'available'; readonly current: string; readonly next: string }
  | { readonly kind: 'downloading'; readonly current: string; readonly next: string; readonly percent: number }
  | { readonly kind: 'ready'; readonly current: string; readonly next: string }
  | { readonly kind: 'error'; readonly current: string; readonly reason: 'offline' | 'failed' };

export interface UpdateChecker {
  state(): Promise<UpdateState>;
  /** Re-checks now; the answer is the new state. */
  check(): Promise<UpdateState>;
  /** Starts the download and install; `not_available` unless the state is available or ready. */
  apply(): Promise<Result<void, 'not_available'>>;
}
