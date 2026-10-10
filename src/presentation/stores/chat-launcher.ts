// stores/chat-launcher.ts — the rules behind the contextual launchers: what a click hands the chat
// store, when a host shows which launcher, and the one prefill text a launcher may carry. The text
// of a prefill comes from the label bundles alone; a page title, an id or a comment never enters
// it (the scope carries the ids), because that text is untrusted and would land in the composer.
import type { ChatScopeInput } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import type { SettingsSection } from './settings-panel';

/** The slice of the chat store a launcher touches: the draft it must not clobber, and openChat. */
export interface LaunchStore {
  state(): { readonly draft: string };
  openChat(input: { readonly scope: ChatScopeInput; readonly prefill?: string }): void;
}

/** Opens the panel on a fresh conversation in the host's scope with the composer pre-filled, never
 *  sent. The chat store has no confirm for replacing unsent text, so an unsent draft is kept as it
 *  is and the prefill is dropped: the operator's own words are never overwritten or appended to. */
export const launchChat = (store: LaunchStore, scope: ChatScopeInput, prefill: string): void => {
  if (store.state().draft.trim() !== '') store.openChat({ scope });
  else store.openChat({ scope, prefill });
};

/** The panel opens by a 300 ms transform and fade; focus waits for it so the caret lands in a
 *  composer that is settled, and reduced motion has no transition to wait for. */
const OPEN_TRANSITION_MS = 300;
export const caretDelayMs = (reducedMotion: boolean): number => (reducedMotion ? 0 : OPEN_TRANSITION_MS);

/** Focus in the composer with the caret after the last character. */
export const placeCaretAtEnd = (): void => {
  const field = document.querySelector('[data-chat-text]');
  if (!(field instanceof HTMLTextAreaElement) || field.disabled) return;
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
};

/** The prefill of a launcher: the bundle's text, with the settings launcher naming its section by
 *  that section's own label. */
export const prefillText = (locale: Locale, prefillKey: LabelKey, sectionKey?: LabelKey): string => {
  const text = t(locale, prefillKey);
  return sectionKey === undefined ? text : text.replace('{section}', t(locale, sectionKey));
};

export type WorkOrderLaunch = 'whyWaiting' | 'whatDoing';

const WAITING_STATUSES: readonly string[] = ['awaiting_human', 'limit_waiting', 'blocked'];

/** Which launcher a work order's standing offers; none while it is neither waiting nor running. */
export const workOrderLaunchOf = (status: string): WorkOrderLaunch | null => {
  if (WAITING_STATUSES.includes(status)) return 'whyWaiting';
  if (status === 'running') return 'whatDoing';
  return null;
};

/** The settings sections that carry a launcher: the ones that configure accounts, roles and limits. */
export const settingsLaunchSections = (section: SettingsSection): boolean =>
  section === 'accounts' || section === 'roles' || section === 'concurrency';

/** The page's scope for the viewer's launcher: its work order, else its project, else global; null
 *  when the page's links are not known yet. */
export const pageLaunchScope = (
  links: { readonly workOrder?: { readonly id: string }; readonly project?: { readonly slug: string } } | null,
): ChatScopeInput | null => {
  if (links === null) return null;
  if (links.workOrder !== undefined) return { kind: 'workOrder', workOrder: links.workOrder.id };
  if (links.project !== undefined) return { kind: 'project', project: links.project.slug };
  return { kind: 'global' };
};

/** A scope as a short stable string, for the data hook the layout audit and the journeys read. */
export const scopeToken = (scope: ChatScopeInput): string => {
  if (scope.kind === 'project') return `project:${scope.project}`;
  if (scope.kind === 'workOrder') return `workOrder:${scope.workOrder}`;
  return 'global';
};
