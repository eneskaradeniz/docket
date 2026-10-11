// components/launcher-rows.tsx — one small row per host screen (the table of the launchers): which
// launcher the host shows, in which scope, with which bundle text. A host adds one element and a
// condition it already knows; a row whose condition is false draws nothing (hidden, never
// disabled), and so does a row outside the launcher context.
import { useContext } from 'react';

import type { ChatScopeInput } from '../../api/commands';
import type { LabelKey } from '../labels/keys';
import { settingsLaunchSections, workOrderLaunchOf } from '../stores/chat-launcher';
import type { SettingsSection } from '../stores/settings-panel';
import { ChatLauncher, ChatLauncherContext, LauncherRow } from './chat-launcher';

const GLOBAL: ChatScopeInput = { kind: 'global' };

/** Home and the new-project panel; `onLaunch` lets the panel step aside before the chat opens. */
export function HomeLaunchers({ onLaunch }: { readonly onLaunch?: () => void }) {
  if (useContext(ChatLauncherContext) === null) return null;
  return (
    <LauncherRow className="mt-3">
      <ChatLauncher id="together" labelKey="launch.together" prefillKey="launch.prefill.together" scope={GLOBAL} onLaunch={onLaunch} />
    </LauncherRow>
  );
}

/** The roadmap, below its heading. */
export function RoadmapLaunchers({ project }: { readonly project: string }) {
  if (useContext(ChatLauncherContext) === null) return null;
  return (
    <LauncherRow className="mt-3">
      <ChatLauncher id="plan" labelKey="launch.plan" prefillKey="launch.prefill.plan" scope={{ kind: 'project', project }} />
    </LauncherRow>
  );
}

/** The new-work-order window: describe the work, the operator opens it. `onLaunch` closes the
 *  window first, otherwise the dialog would hide the chat it opens. */
export function BoardLaunchers({ project, onLaunch }: { readonly project: string | null; readonly onLaunch?: () => void }) {
  if (useContext(ChatLauncherContext) === null || project === null) return null;
  return (
    <LauncherRow>
      <ChatLauncher id="describe" labelKey="launch.describe" prefillKey="launch.prefill.describe" scope={{ kind: 'project', project }} onLaunch={onLaunch} />
    </LauncherRow>
  );
}

/** A work order's detail: the question that fits its standing. */
export function WorkOrderLaunchers({ workOrder, status }: { readonly workOrder: string; readonly status: string }) {
  const launch = workOrderLaunchOf(status);
  if (useContext(ChatLauncherContext) === null || launch === null) return null;
  const scope: ChatScopeInput = { kind: 'workOrder', workOrder };
  return (
    <LauncherRow className="mt-3">
      {launch === 'whyWaiting' ? (
        <ChatLauncher id="whyWaiting" labelKey="launch.whyWaiting" prefillKey="launch.prefill.whyWaiting" scope={scope} />
      ) : (
        <ChatLauncher id="whatDoing" labelKey="launch.whatDoing" prefillKey="launch.prefill.whatDoing" scope={scope} />
      )}
    </LauncherRow>
  );
}

const SECTION_LABEL: Readonly<Partial<Record<SettingsSection, LabelKey>>> = {
  accounts: 'settings.section.accounts',
  roles: 'settings.section.roles',
  concurrency: 'settings.section.concurrency',
};

/** One launcher per settings section that has one; `onLaunch` closes the panel, which would
 *  otherwise hide the chat it opens. */
export function SettingsLaunchers({ section, onLaunch }: { readonly section: SettingsSection; readonly onLaunch: () => void }) {
  const sectionKey = SECTION_LABEL[section];
  if (useContext(ChatLauncherContext) === null || !settingsLaunchSections(section) || sectionKey === undefined) return null;
  return (
    <LauncherRow className="mb-4">
      <ChatLauncher
        id={`setup-${section}`}
        labelKey="launch.setup"
        prefillKey="launch.prefill.setup"
        sectionKey={sectionKey}
        scope={GLOBAL}
        onLaunch={onLaunch}
      />
    </LauncherRow>
  );
}

/** The page viewer's header actions: only while the operator has comments still open. */
export function PageLaunchers({ scope, openComments }: { readonly scope: ChatScopeInput | null; readonly openComments: number }) {
  if (useContext(ChatLauncherContext) === null || scope === null || openComments <= 0) return null;
  return (
    <ChatLauncher id="fixComments" labelKey="launch.fixComments" prefillKey="launch.prefill.fixComments" scope={scope} />
  );
}
