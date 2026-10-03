// stores/nav-history.test.ts — U-25: the shell's navigation history as a pure reducer — push,
// dedupe, forward truncation, the 50-entry limit, back/forward at the ends, the per-entry scroll
// stamping and the skipping of entries whose subject no longer exists.
import { describe, expect, it } from 'vitest';

import {
  NAV_LIMIT,
  START_NAV_HISTORY,
  canBack,
  canForward,
  navHistoryReducer,
  type NavHistory,
  type NavRoute,
} from './nav-history';

const cockpit: NavRoute = { name: 'cockpit' };
const board = (repo: string): NavRoute => ({ name: 'board', repo });
const roadmap = (project: string): NavRoute => ({ name: 'roadmap', project });
const workOrder = (id: string): NavRoute => ({ name: 'workOrder', id });
const account = (id: string): NavRoute => ({ name: 'account', id });

const push = (state: NavHistory, route: NavRoute, scroll = 0): NavHistory =>
  navHistoryReducer(state, { type: 'push', route, scroll });
const back = (state: NavHistory, exists: (route: NavRoute) => boolean = () => true, scroll = 0): NavHistory =>
  navHistoryReducer(state, { type: 'back', exists, scroll });
const forward = (state: NavHistory, exists: (route: NavRoute) => boolean = () => true, scroll = 0): NavHistory =>
  navHistoryReducer(state, { type: 'forward', exists, scroll });

const current = (state: NavHistory): NavRoute => state.entries[state.index].route;

describe('navHistoryReducer', () => {
  it('U-40: the Yeni proje page is a route of its own — pushed once, never doubled, left by back', () => {
    const page: NavRoute = { name: 'newProject' };
    const opened = push(START_NAV_HISTORY, page);
    expect(current(opened)).toStrictEqual(page);
    expect(push(opened, page)).toBe(opened);
    expect(current(back(opened))).toStrictEqual(cockpit);
  });

  it('U-25: push appends an entry and truncates the forward part', () => {
    const opened = push(push(START_NAV_HISTORY, board('antreo-api')), roadmap('antero'));
    const wentBack = back(opened);
    expect(current(wentBack)).toStrictEqual(board('antreo-api'));
    const branched = push(wentBack, workOrder('wo-16'));
    expect(current(branched)).toStrictEqual(workOrder('wo-16'));
    expect(branched.entries.map((entry) => entry.route)).toStrictEqual([cockpit, board('antreo-api'), workOrder('wo-16')]);
    expect(canForward(branched)).toBe(false);
  });

  it('U-25: a navigation to the route already current adds no entry', () => {
    const once = push(START_NAV_HISTORY, board('antreo-api'), 40);
    expect(once.index).toBe(1);
    // The same route again — whatever the scroll standing — is the state itself, not a copy.
    expect(push(once, board('antreo-api'), 120)).toBe(once);
    expect(push(START_NAV_HISTORY, cockpit)).toBe(START_NAV_HISTORY);
  });

  it('U-25: the history holds at most 50 entries — the oldest drops', () => {
    let state = START_NAV_HISTORY;
    for (let i = 0; i < NAV_LIMIT + 10; i += 1) state = push(state, workOrder(`wo-${i}`));
    expect(state.entries.length).toBe(NAV_LIMIT);
    expect(state.index).toBe(NAV_LIMIT - 1);
    // The cockpit and the first nine work orders are gone; the 11th push is the oldest survivor.
    expect(state.entries[0].route).toStrictEqual(workOrder('wo-10'));
  });

  it('U-25: back and forward move the index and stay put at the ends', () => {
    expect(canBack(START_NAV_HISTORY)).toBe(false);
    expect(back(START_NAV_HISTORY)).toBe(START_NAV_HISTORY);
    const state = push(push(START_NAV_HISTORY, board('antreo-api')), roadmap('antero'));
    expect(canBack(state)).toBe(true);
    expect(canForward(state)).toBe(false);
    expect(forward(state)).toBe(state);
    const once = back(state);
    expect(current(once)).toStrictEqual(board('antreo-api'));
    expect(canForward(once)).toBe(true);
    const twice = back(once);
    expect(current(twice)).toStrictEqual(cockpit);
    expect(back(twice)).toBe(twice);
    expect(current(forward(twice))).toStrictEqual(board('antreo-api'));
  });

  it('U-25: every move stamps the left screen’s scroll into its entry; the arrival restores the target’s', () => {
    // Leaving the cockpit at 34px stamps 34 into its entry; the fresh board starts at the top.
    const opened = push(START_NAV_HISTORY, board('antreo-api'), 34);
    expect(opened.entries[0].scroll).toBe(34);
    expect(opened.entries[1].scroll).toBe(0);
    // Going back stamps the board's scroll (120) where it stands and returns to the cockpit's 34.
    const wentBack = back(opened, () => true, 120);
    expect(wentBack.entries[1].scroll).toBe(120);
    expect(current(wentBack)).toStrictEqual(cockpit);
    expect(wentBack.entries[0].scroll).toBe(34);
    // Forward restores the board at 120.
    expect(forward(wentBack, () => true, 7).entries[1].scroll).toBe(120);
  });

  it('U-25: back skips entries whose subject is gone, continuing back and dropping the walked-past dead', () => {
    const alive = (route: NavRoute): boolean => route.name !== 'board' || route.repo === 'antreo-docs';
    // cockpit → antreo-api (soon gone) → antreo-docs → roadmap; back lands the live repo above it.
    const state = push(push(push(START_NAV_HISTORY, board('antreo-api')), board('antreo-docs')), roadmap('antero'));
    const wentBack = back(state, alive);
    expect(current(wentBack)).toStrictEqual(board('antreo-docs'));
    expect(wentBack.index).toBe(2);
    // The dead repo below the landing stays until it is walked over: the next back skips straight
    // to the cockpit and drops it on the way.
    const toCockpit = back(wentBack, alive);
    expect(current(toCockpit)).toStrictEqual(cockpit);
    expect(toCockpit.entries.map((entry) => entry.route)).toStrictEqual([cockpit, board('antreo-docs'), roadmap('antero')]);
    expect(toCockpit.index).toBe(0);
  });

  it('U-25: a back that finds nothing valid lands on the cockpit', () => {
    const noBoard = (route: NavRoute): boolean => route.name !== 'board';
    // The realistic walk: the cockpit entry itself is always a valid destination — the dead repo
    // between it and the current work order drops.
    const realistic = push(push(START_NAV_HISTORY, board('antreo-api')), workOrder('wo-16'));
    const landed = back(realistic, noBoard);
    expect(current(landed)).toStrictEqual(cockpit);
    expect(landed.entries.map((entry) => entry.route)).toStrictEqual([cockpit, workOrder('wo-16')]);
    expect(landed.index).toBe(0);
    // Nothing at all valid behind: the cockpit is appended as the destination ahead of the current.
    const nothing = (): boolean => false;
    const appended = back(push(push(START_NAV_HISTORY, board('antreo-api')), workOrder('wo-16')), nothing);
    expect(current(appended)).toStrictEqual(cockpit);
    expect(appended.entries.map((entry) => entry.route)).toStrictEqual([workOrder('wo-16'), cockpit]);
    expect(appended.index).toBe(1);
    // Already on the cockpit with only dead entries behind: they drop and nothing is appended.
    const cleaned = back(appended, nothing);
    expect(cleaned.entries.map((entry) => entry.route)).toStrictEqual([cockpit]);
    expect(canBack(cleaned)).toBe(false);
  });

  it('U-25: forward skips gone subjects the same way and lands on the cockpit when none is valid', () => {
    const noBoard = (route: NavRoute): boolean => route.name !== 'board';
    const state = push(push(push(START_NAV_HISTORY, roadmap('antero')), board('antreo-api')), account('claude'));
    const wentBack = back(back(state));
    expect(current(wentBack)).toStrictEqual(roadmap('antero'));
    // Forwarding over the dead repo lands on the account; the dead entry drops.
    const wentForward = forward(wentBack, noBoard);
    expect(current(wentForward)).toStrictEqual(account('claude'));
    expect(wentForward.entries.map((entry) => entry.route)).toStrictEqual([cockpit, roadmap('antero'), account('claude')]);
    expect(wentForward.index).toBe(2);
    // Nothing valid ahead: the cockpit is appended as the destination.
    const deadAhead = push(push(START_NAV_HISTORY, roadmap('antero')), board('antreo-api'));
    const atRoadmap = back(deadAhead);
    const landed = forward(atRoadmap, noBoard);
    expect(current(landed)).toStrictEqual(cockpit);
    expect(landed.entries.map((entry) => entry.route)).toStrictEqual([cockpit, roadmap('antero'), cockpit]);
    // Already the cockpit with only dead entries ahead: they drop and nothing is appended.
    const chained = push(push(push(START_NAV_HISTORY, roadmap('antero')), cockpit), board('antreo-api'));
    const cleaned = forward(back(chained, noBoard), noBoard);
    expect(cleaned.entries.map((entry) => entry.route)).toStrictEqual([cockpit, roadmap('antero'), cockpit]);
    expect(cleaned.index).toBe(2);
    expect(canForward(cleaned)).toBe(false);
  });
});
