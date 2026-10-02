import { describe, expect, it } from "vitest";
import { val } from "@theatre/core";

import {
  ENTRANCE_SECONDS,
  capsuleObject,
  heroSheet,
  leafObject,
  stageObject,
} from "@/components/hero-scene/sheet";

/**
 * The hero entrance is keyframe data in a JSON file, not code, so nothing a
 * type checker or a lint rule looks at can tell whether it still animates
 * anything. This reads the checked-in state back through Theatre.js and asks
 * the one question that matters: does scrubbing the sequence actually move the
 * pieces, and does it end on the composed state the scene is meant to rest in?
 *
 * The settled state is also what a reader with prefers-reduced-motion is shown
 * in a single frame, which is why it is pinned exactly rather than loosely.
 */
function at(position: number) {
  heroSheet.sequence.position = position;
  return {
    leaf: leafObject.value,
    capsule: capsuleObject.value,
    stage: stageObject.value,
  };
}

describe("the baked hero sheet", () => {
  it("starts with both pieces away from the centre and invisible", () => {
    const { leaf, capsule, stage } = at(0);

    expect(leaf.opacity).toBe(0);
    expect(capsule.opacity).toBe(0);
    // Apart, and on opposite sides of the centre on every axis.
    expect(leaf.drift.x).toBeLessThan(-1);
    expect(capsule.drift.x).toBeGreaterThan(1);
    expect(Math.sign(leaf.drift.y)).toBe(-Math.sign(capsule.drift.y));
    expect(Math.sign(leaf.drift.z)).toBe(-Math.sign(capsule.drift.z));
    expect(leaf.scale).toBeLessThan(1);
    expect(capsule.scale).toBeLessThan(1);
    // The idle orbit has not begun and the ring is not drawn yet.
    expect(stage.idle).toBe(0);
    expect(stage.ring).toBe(0);
    expect(stage.lift).toBeLessThan(0);
  });

  it("moves them part of the way by the middle, without finishing early", () => {
    const { leaf, capsule } = at(0.75);

    expect(Math.abs(leaf.drift.x)).toBeLessThan(1.7);
    expect(Math.abs(leaf.drift.x)).toBeGreaterThan(0);
    expect(leaf.opacity).toBeGreaterThan(0);
    // The capsule is held back a fifth of a second, so at the same moment it
    // is further from home than the leaf is.
    expect(Math.abs(capsule.drift.x)).toBeGreaterThan(Math.abs(leaf.drift.x));
  });

  it("settles into the composed state at the end of the sequence", () => {
    const { leaf, capsule, stage } = at(ENTRANCE_SECONDS);

    for (const piece of [leaf, capsule]) {
      expect(piece.drift).toEqual({ x: 0, y: 0, z: 0 });
      expect(piece.turn).toBe(0);
      expect(piece.scale).toBe(1);
      expect(piece.opacity).toBe(1);
    }
    expect(stage).toEqual({ lift: 0, idle: 1, ring: 1 });
  });

  it("keys nothing past the sequence length", () => {
    expect(val(heroSheet.sequence.pointer.length)).toBe(ENTRANCE_SECONDS);
    expect(at(ENTRANCE_SECONDS)).toEqual(at(ENTRANCE_SECONDS * 2));
  });
});
