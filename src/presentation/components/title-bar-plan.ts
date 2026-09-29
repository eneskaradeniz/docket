// components/title-bar-plan.ts — what the shell's top bar owes the platform it runs on, as a
// pure function of the navigator's platform string: darwin's window is opened with the native
// title strip hidden, so the shell owes its own drag bar, the traffic lights their lane and the
// bar's two buttons — Anasayfa, the cockpit's route, and Ara, the search palette's; everywhere
// else the native frame already drags and the shell renders no bar at all.
export type TitleBarButton = 'home' | 'search';

export interface TitleBarPlan {
  /** Whether the shell owes its own drag bar — true only where the native strip is hidden. */
  readonly visible: boolean;
  /** The lane the traffic lights own at the bar's left edge, in px. */
  readonly leftInsetPx: number;
  /** The interactive buttons the bar carries, in render order; empty wherever no bar renders. */
  readonly buttons: readonly TitleBarButton[];
}

/** The traffic-light lane on darwin: wide enough that the buttons clear the bar's content the
 *  shell puts beside them. Zero and empty wherever no bar renders, so the values never dangle. */
export const titleBarFor = (platform: string): TitleBarPlan =>
  platform.toLowerCase().startsWith('mac')
    ? { visible: true, leftInsetPx: 92, buttons: ['home', 'search'] }
    : { visible: false, leftInsetPx: 0, buttons: [] };
