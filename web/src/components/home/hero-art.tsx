import type { CSSProperties } from "react";

/**
 * The hero's drawn layers: two soft hills in the midground, grass and a leafy
 * branch in each bottom corner in the foreground, and a few drifting motes.
 *
 * All of it is inline SVG and CSS, server-rendered, so the hero is composed in
 * the first response and there is nothing to wait for or to fail. It is
 * decorative and aria-hidden: the headline says the whole thing in words.
 *
 * The shapes are generated from a handful of parameters rather than drawn as
 * long path strings, so the blades and leaves stay consistent with each other
 * and the two corners can differ without a second drawing.
 */

type Vars = CSSProperties & Record<`--${string}`, string | number>;

const SILHOUETTE = "#070605";
const RIM = "rgb(138 136 132 / 0.22)";

/* ------------------------------------------------------------------ grass */

/** x of the root, height, lean of the tip, half-width at the root. */
type Blade = [number, number, number, number];

const GROUND = 240;

function bladePath([x, h, lean, w]: Blade): string {
  const midY = GROUND - h * 0.55;
  return [
    `M${x - w} ${GROUND}`,
    `Q${x + lean * 0.35} ${midY} ${x + lean} ${GROUND - h}`,
    `Q${x + lean * 0.35 + w * 0.7} ${midY} ${x + w} ${GROUND}`,
    "Z",
  ].join(" ");
}

/** Three clumps, each swaying on its own period so they never move as one. */
const CLUMPS: { blades: Blade[]; duration: string; delay: string; sway: string }[] = [
  {
    blades: [
      [8, 150, -18, 5],
      [22, 190, 14, 5],
      [34, 120, 30, 4],
      [46, 170, -10, 5],
      [58, 96, 26, 4],
    ],
    duration: "8s",
    delay: "-1s",
    sway: "1.8deg",
  },
  {
    blades: [
      [74, 136, 20, 4],
      [88, 178, -16, 5],
      [101, 112, 34, 4],
      [116, 154, 8, 5],
      [130, 88, 28, 4],
    ],
    duration: "9.5s",
    delay: "-4s",
    sway: "-1.4deg",
  },
  {
    blades: [
      [150, 118, -22, 4],
      [166, 84, 18, 3],
      [184, 104, 30, 4],
      [204, 64, 22, 3],
      [226, 48, 18, 3],
    ],
    duration: "7s",
    delay: "-2.5s",
    sway: "2.2deg",
  },
];

/* ----------------------------------------------------------------- branch */

type Point = [number, number];

/** A point and its direction on a quadratic curve, at t in [0, 1]. */
function onCurve(p0: Point, p1: Point, p2: Point, t: number) {
  const u = 1 - t;
  const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  const dx = 2 * u * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
  const dy = 2 * u * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
  return { x, y, angle: (Math.atan2(dy, dx) * 180) / Math.PI };
}

/** A leaf pointing up its own y axis from the origin. */
function leafPath(length: number, width: number): string {
  const l = length;
  const w = width;
  return `M0 0 C${w} ${-l * 0.3} ${w * 0.6} ${-l * 0.85} 0 ${-l} C${-w * 0.6} ${-l * 0.85} ${-w} ${-l * 0.3} 0 0 Z`;
}

function Branch({ stem }: { stem: [Point, Point, Point] }) {
  const [p0, p1, p2] = stem;
  const leaves = Array.from({ length: 11 }, (_, index) => {
    const t = 0.18 + index * 0.075;
    const point = onCurve(p0, p1, p2, t);
    const side = index % 2 === 0 ? 1 : -1;
    // Leaves get smaller toward the tip, and alternate sides of the stem.
    const length = 34 - index * 1.6;
    return {
      key: index,
      d: leafPath(length, length * 0.32),
      transform: `translate(${point.x.toFixed(1)} ${point.y.toFixed(1)}) rotate(${(
        point.angle +
        90 +
        side * 52
      ).toFixed(1)})`,
    };
  });
  const tip = onCurve(p0, p1, p2, 1);

  return (
    <g
      className="sway"
      style={{ "--sway-duration": "11s", "--sway-delay": "-3s", "--sway": "1.2deg" } as Vars}
    >
      <path
        d={`M${p0[0]} ${p0[1]} Q${p1[0]} ${p1[1]} ${p2[0]} ${p2[1]}`}
        fill="none"
        stroke={SILHOUETTE}
        strokeWidth="3"
        strokeLinecap="round"
      />
      {leaves.map((leaf) => (
        <path key={leaf.key} d={leaf.d} transform={leaf.transform} />
      ))}
      <path d={leafPath(22, 7)} transform={`translate(${tip.x} ${tip.y}) rotate(${tip.angle + 90})`} />
    </g>
  );
}

/** One bottom corner: a branch rising behind a stand of grass. */
function Corner({ side }: { side: "left" | "right" }) {
  const mirrored = side === "right";
  return (
    <svg
      viewBox="0 0 360 320"
      className={
        mirrored
          ? "absolute right-0 -bottom-16 w-[clamp(9rem,26vw,24rem)] -scale-x-100"
          : "absolute -bottom-16 left-0 w-[clamp(9rem,26vw,24rem)]"
      }
      preserveAspectRatio="xMinYMax meet"
    >
      <g fill={SILHOUETTE} stroke={RIM} strokeWidth="0.8">
        <Branch
          stem={
            mirrored
              ? [
                  [30, 240],
                  [40, 120],
                  [196, 58],
                ]
              : [
                  [16, 240],
                  [70, 110],
                  [230, 30],
                ]
          }
        />
        {/* The ground the stand roots in. It runs below the hero's edge, so the
            corner never floats free when it parallaxes up. */}
        <path d="M-10 252 Q 120 228 370 248 L370 330 L-10 330 Z" fill="#0d0b0a" stroke="none" />
        {CLUMPS.map((clump, index) => (
          <g
            key={index}
            className="sway"
            style={
              {
                "--sway-duration": clump.duration,
                "--sway-delay": clump.delay,
                "--sway": clump.sway,
              } as Vars
            }
          >
            {clump.blades.map((blade, bladeIndex) => (
              <path key={bladeIndex} d={bladePath(blade)} />
            ))}
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ------------------------------------------------------------------ motes */

/** left %, top %, size px, vermilion or stone, drift period s, phase s. */
const MOTES: [number, number, number, "v" | "s", number, number][] = [
  [8, 30, 3, "s", 19, -2],
  [16, 58, 2, "v", 23, -9],
  [24, 18, 2, "s", 17, -5],
  [31, 44, 3, "v", 26, -14],
  [38, 70, 2, "s", 21, -3],
  [47, 24, 2, "v", 18, -11],
  [55, 62, 3, "s", 24, -6],
  [63, 36, 2, "v", 20, -16],
  [70, 15, 2, "s", 22, -1],
  [77, 52, 3, "v", 27, -12],
  [84, 28, 2, "s", 19, -7],
  [91, 66, 2, "v", 25, -4],
];

/* ------------------------------------------------------------------- hero */

export function HeroArt() {
  return (
    <div
      data-testid="hero-art"
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-[2] overflow-hidden"
    >
      {/* The far hill moves least with the scroll and the near one more, so
          the hero opens up in depth as it leaves the screen. */}
      <div className="parallax absolute inset-x-0 bottom-0" style={{ "--depth": 0.32 } as Vars}>
        <svg
          viewBox="0 0 1440 300"
          preserveAspectRatio="none"
          className="block h-[clamp(9rem,30svh,18rem)] w-full"
        >
          <path
            d="M0 150 C 220 92, 430 118, 650 134 S 1080 70, 1290 96 S 1420 118, 1440 122 L1440 300 L0 300 Z"
            fill="#161d2a"
          />
        </svg>
      </div>
      <div className="parallax absolute inset-x-0 -bottom-8" style={{ "--depth": 0.16 } as Vars}>
        <svg
          viewBox="0 0 1440 300"
          preserveAspectRatio="none"
          className="block h-[clamp(7rem,22svh,13rem)] w-full"
        >
          <path
            d="M0 196 C 260 150, 540 196, 800 178 S 1230 136, 1440 182 L1440 300 L0 300 Z"
            fill="#0d0b0a"
          />
        </svg>
      </div>

      {MOTES.map(([left, top, size, tone, duration, delay], index) => (
        <span
          key={index}
          className="mote"
          style={
            {
              left: `${left}%`,
              top: `${top}%`,
              width: size,
              height: size,
              background: tone === "v" ? "#e0231c" : "#8a8884",
              "--mote-duration": `${duration}s`,
              "--mote-delay": `${delay}s`,
              "--mote-x": `${index % 2 === 0 ? 14 : -12}px`,
              "--mote-y": `${-30 - (index % 4) * 8}px`,
              "--mote-opacity": tone === "v" ? 0.7 : 0.5,
            } as Vars
          }
        />
      ))}

      <div className="parallax absolute inset-0" style={{ "--depth": -0.12 } as Vars}>
        <Corner side="left" />
        <Corner side="right" />
      </div>
    </div>
  );
}
