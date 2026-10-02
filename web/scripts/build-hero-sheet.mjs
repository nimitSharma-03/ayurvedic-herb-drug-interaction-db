/**
 * Bakes the hero entrance timeline into src/components/hero-scene/hero-sheet.json.
 *
 * Theatre.js keyframes normally come out of Theatre Studio's export button. The
 * shipped app must not depend on Studio, so the keyframes live in a checked-in
 * state file, and this script is how that file is written: the timeline below
 * is the readable source, `npm run hero:sheet` turns it into the exact state
 * shape Theatre.js reads.
 *
 * Authoring by hand in Studio still works. Open the home page with
 * `npm run dev`, scrub and drag in the panel that appears, press its export
 * button, and drop the downloaded state over hero-sheet.json; it is the same
 * format. Keep this file in step if you do, or the next run overwrites the
 * hand-authored values.
 *
 * tests/unit/hero-sheet.test.ts reads the generated file back through
 * @theatre/core and checks it actually drives the values it claims to, so a
 * malformed bake fails the suite rather than shipping a still hero.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(
  fileURLToPath(new URL("../src/components/hero-scene/", import.meta.url)),
  "hero-sheet.json",
);

/**
 * The project's own reveal easing, --ease-reveal in globals.css:
 * cubic-bezier(0.22, 1, 0.36, 1). Theatre.js stores a keyframe's handles as
 * [inX, inY, outX, outY] and reads the outgoing pair of the left keyframe with
 * the incoming pair of the right one, so writing the curve's second control
 * point as the in-handle and its first as the out-handle gives every segment
 * exactly the easing the rest of the interface uses.
 */
const EASE = [0.36, 1, 0.22, 1];

/** Seconds. Everything has settled by the end, and nothing is keyed past it. */
const LENGTH = 3;

/**
 * The entrance, as [seconds, value] pairs per property.
 *
 * The leaf comes in from the upper left and behind, the capsule from the lower
 * right and in front, a fifth of a second later, so the eye reads them as two
 * arrivals rather than one symmetrical swoosh. Both finish at zero offset,
 * full size and full opacity: the settled state is the end of this timeline,
 * which is also the state a reader with prefers-reduced-motion sees
 * immediately.
 *
 * `idle` ramps the continuous orbit in from nothing once the pieces are nearly
 * home, so the motion starts as the drift ends instead of fighting it.
 */
const TIMELINE = {
  Leaf: {
    '["drift","x"]': [[0, -1.7], [1.5, 0]],
    '["drift","y"]': [[0, 0.78], [1.5, 0]],
    '["drift","z"]': [[0, -0.9], [1.5, 0]],
    '["turn"]': [[0, -1.15], [1.6, 0]],
    '["scale"]': [[0, 0.72], [1.5, 1]],
    '["opacity"]': [[0, 0], [0.8, 1]],
  },
  Capsule: {
    '["drift","x"]': [[0, 1.7], [0.2, 1.7], [1.7, 0]],
    '["drift","y"]': [[0, -0.78], [0.2, -0.78], [1.7, 0]],
    '["drift","z"]': [[0, 0.9], [0.2, 0.9], [1.7, 0]],
    '["turn"]': [[0, 1.15], [0.2, 1.15], [1.8, 0]],
    '["scale"]': [[0, 0.72], [0.2, 0.72], [1.7, 1]],
    '["opacity"]': [[0, 0], [0.2, 0], [1, 1]],
  },
  Stage: {
    '["lift"]': [[0, -0.5], [1.6, 0]],
    '["idle"]': [[0, 0], [0.9, 0], [2.4, 1]],
    '["ring"]': [[0, 0], [0.6, 0], [2.1, 1]],
  },
};

/** A track id and keyframe ids that fall out of the property they belong to,
 * so a re-run produces a byte-identical file and the diff stays reviewable. */
function trackId(objectKey, propPath) {
  return `${objectKey}-${propPath.replace(/[^a-zA-Z0-9]+/g, "-")}`.replace(/-+$/, "");
}

const tracksByObject = {};
for (const [objectKey, props] of Object.entries(TIMELINE)) {
  const trackData = {};
  const trackIdByPropPath = {};

  for (const [propPath, points] of Object.entries(props)) {
    const id = trackId(objectKey, propPath);
    trackIdByPropPath[propPath] = id;
    trackData[id] = {
      type: "BasicKeyframedTrack",
      __debugName: `${objectKey}:${propPath}`,
      keyframes: points.map(([position, value], index) => ({
        id: `${id}-${index}`,
        position,
        value,
        type: "bezier",
        // The last keyframe has nothing to its right; everything before it
        // interpolates into its neighbour.
        connectedRight: index < points.length - 1,
        handles: [...EASE],
      })),
    };
  }

  tracksByObject[objectKey] = { trackData, trackIdByPropPath };
}

const state = {
  sheetsById: {
    Hero: {
      staticOverrides: { byObject: {} },
      sequence: {
        type: "PositionalSequence",
        subUnitsPerUnit: 30,
        length: LENGTH,
        tracksByObject,
      },
    },
  },
  definitionVersion: "0.4.0",
  // Studio compares its stored copy against the first entry to decide whether
  // what is in the browser was based on what is on disk. Bumping this string
  // tells a local Studio that this file moved on without it.
  revisionHistory: ["hero-entrance-1"],
};

writeFileSync(OUT, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
console.log(`wrote ${OUT}`);
