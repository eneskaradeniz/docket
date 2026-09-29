// components/title-bar-plan.ts — what the shell's top bar owes the platform it runs on, as a
// pure function of the navigator's platform string: darwin's window is opened with the native
// title strip hidden, so the shell owes its own drag bar and the traffic lights their lane;
// everywhere else the native frame already drags and the shell renders no bar at all.
export interface TitleBarPlan {
  /** Whether the shell owes its own drag bar — true only where the native strip is hidden. */
  readonly visible: boolean;
  /** The lane the traffic lights own at the bar's left edge, in px. */
  readonly leftInsetPx: number;
}

/** The traffic-light lane on darwin: wide enough that the buttons clear the bar's content the
 *  shell puts beside them. Zero wherever no bar renders, so the value never dangles. */
export const titleBarFor = (platform: string): TitleBarPlan =>
  platform.toLowerCase().startsWith('mac') ? { visible: true, leftInsetPx: 92 } : { visible: false, leftInsetPx: 0 };
