"use client";

import { getProject, types } from "@theatre/core";

import heroSheetState from "./hero-sheet.json";

/**
 * The Theatre.js project behind the hero entrance.
 *
 * The keyframes come from hero-sheet.json, which is checked in, so nothing at
 * runtime depends on Theatre Studio being present: @theatre/studio is a dev
 * dependency, loaded only by studio.ts and only in development.
 *
 * Every default below is the *settled* value, the one the timeline ends on.
 * That is deliberate. If the state file were ever unreadable, the hero would
 * come up composed and still rather than collapsed at the start of an
 * animation that never plays, and it is also the exact state a reader with
 * prefers-reduced-motion is shown.
 */
const project = getProject("HDI Hero", { state: heroSheetState });

export const heroSheet = project.sheet("Hero");

/** Seconds. The sequence length in hero-sheet.json; everything has settled. */
export const ENTRANCE_SECONDS = 3;

/**
 * One piece of the composition.
 *
 * `drift` is an offset in scene units added on top of the position the orbit
 * puts the piece at, so the entrance and the idle motion compose instead of
 * overwriting each other. `turn` is extra rotation about the piece's own long
 * axis, in radians.
 */
const pieceProps = {
  drift: types.compound({
    x: types.number(0, { range: [-3, 3], nudgeMultiplier: 0.01 }),
    y: types.number(0, { range: [-3, 3], nudgeMultiplier: 0.01 }),
    z: types.number(0, { range: [-3, 3], nudgeMultiplier: 0.01 }),
  }),
  turn: types.number(0, { range: [-3.2, 3.2], nudgeMultiplier: 0.01 }),
  scale: types.number(1, { range: [0, 1.5], nudgeMultiplier: 0.01 }),
  opacity: types.number(1, { range: [0, 1], nudgeMultiplier: 0.01 }),
};

export const leafObject = heroSheet.object("Leaf", pieceProps);
export const capsuleObject = heroSheet.object("Capsule", pieceProps);

/**
 * The composition as a whole. `idle` blends in the continuous orbit, from
 * nothing at the start to full rate once the pieces are home, and `ring` fades
 * the circle the two of them travel.
 */
export const stageObject = heroSheet.object("Stage", {
  lift: types.number(0, { range: [-2, 2], nudgeMultiplier: 0.01 }),
  idle: types.number(1, { range: [0, 1], nudgeMultiplier: 0.01 }),
  ring: types.number(1, { range: [0, 1], nudgeMultiplier: 0.01 }),
});
