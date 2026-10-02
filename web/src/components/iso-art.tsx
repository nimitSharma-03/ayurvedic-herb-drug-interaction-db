import { cn } from "@/lib/utils";

/**
 * The isometric tiles.
 *
 * Decorative, every one of them: `aria-hidden`, no pointer events, and every
 * page they appear on says the same thing in words. They are drawn here rather
 * than fetched, so the app ships no image file and the tiles recolour with the
 * theme like everything else.
 *
 * One slab, five motifs. The slab is a 2:1 isometric box -- a rhombus top face
 * and two side faces, the sides darkened by an ink overlay rather than by a
 * second set of colour tokens, so a tile cannot drift away from the palette.
 * Each motif is drawn in an ordinary square and projected onto the top face by
 * `matrix(1, .5, -1, .5, 0, 0)`, which is exactly the transform that maps that
 * square onto the rhombus; `vector-effect="non-scaling-stroke"` keeps the line
 * weight even after the squash.
 */

/**
 * The three faces of the slab. The box is cropped to the drawing, so a tile
 * fills the width it is given instead of floating in empty viewBox.
 */
const VIEW_BOX = "12 20 96 80";
const TOP = "M60 24 L104 46 L60 68 L16 46 Z";
const LEFT = "M16 46 L60 68 L60 94 L16 72 Z";
const RIGHT = "M60 68 L104 46 L104 72 L60 94 Z";
const SILHOUETTE = "M16 46 L60 24 L104 46 L104 72 L60 94 L16 72 Z";

/** Maps the square the motifs are drawn in onto the top face. */
const ONTO_TOP = "translate(60 46) matrix(1 0.5 -1 0.5 0 0)";

export type IsoKind = "leaf" | "capsule" | "paper" | "shield" | "badge";

/**
 * Which part of the project each tile stands for: a herb, a medicine, the
 * abstract a record cites, a documented caution, and the flag that says
 * whether a record was verified or auto-extracted.
 */
const MOTIFS: Record<IsoKind, React.ReactNode> = {
  leaf: (
    <>
      <path d="M0 -16C12 -10 16 2 0 16C-16 2 -12 -10 0 -16Z" />
      <path d="M0 13V-13" />
      <path d="M0 -3 7 -8M0 4-7 -1" />
    </>
  ),
  capsule: (
    <>
      <rect x="-16" y="-7" width="32" height="14" rx="7" />
      <path d="M0 -7V7" />
    </>
  ),
  paper: (
    <>
      <rect x="-13" y="-16" width="26" height="32" rx="4" />
      <path d="M-7 -8H7M-7 0H7M-7 8H2" />
    </>
  ),
  shield: (
    <>
      <path d="M0 -17 13 -11V1C13 10 7 14 0 17C-7 14-13 10-13 1V-11Z" />
      <path d="M0 -8V2" />
      <path d="M0 8V9" />
    </>
  ),
  badge: (
    <>
      <circle cx="0" cy="0" r="14" />
      <path d="M-6 0 -1 6 7-6" />
    </>
  ),
};

export type IsoTone = "teal" | "pink" | "sage" | "purple";

const TONES: Record<IsoTone, string> = {
  teal: "var(--color-accent-teal)",
  pink: "var(--color-accent-pink)",
  sage: "var(--color-accent-sage)",
  purple: "var(--color-primary)",
};

export function IsoTile({
  kind,
  tone,
  className,
  style,
}: {
  kind: IsoKind;
  tone: IsoTone;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fill = TONES[tone];
  return (
    <svg
      viewBox={VIEW_BOX}
      aria-hidden="true"
      focusable="false"
      className={cn(
        "tile-shadow pointer-events-none overflow-visible select-none",
        className,
      )}
      style={style}
    >
      <path d={TOP} fill={fill} />
      <path d={LEFT} fill={fill} />
      <path d={LEFT} fill="var(--color-ink)" opacity="0.34" />
      <path d={RIGHT} fill={fill} />
      <path d={RIGHT} fill="var(--color-ink)" opacity="0.15" />
      <g
        transform={ONTO_TOP}
        fill="none"
        stroke="var(--color-ink)"
        strokeOpacity="0.74"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      >
        {MOTIFS[kind]}
      </g>
      <path
        d={SILHOUETTE}
        fill="none"
        stroke="var(--color-ink)"
        strokeOpacity="0.2"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d={TOP}
        fill="none"
        stroke="var(--color-ink)"
        strokeOpacity="0.14"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface FloatingTile {
  kind: IsoKind;
  tone: IsoTone;
  /** Where it sits in the hero box, and how big. */
  position: string;
  /** Pixels of drift, the bob's period, and where in that period it starts. */
  rise: string;
  duration: string;
  delay: string;
}

/**
 * The three tiles that float around the hero headline.
 *
 * Three rather than a crowd, and small: they are an accent on the page, not
 * the subject of it. They sit in corners the centred column never reaches, and
 * their sizes and offsets are `clamp`ed off the viewport, so a short laptop
 * screen shrinks them rather than pushing the headline or its buttons below
 * the fold.
 */
const FLOATING: FloatingTile[] = [
  {
    kind: "leaf",
    tone: "sage",
    position:
      "top-[4%] left-[2%] w-[clamp(2.5rem,5.5vw,6rem)] sm:left-[5%] lg:top-[12%] lg:left-[9%]",
    rise: "-10px",
    duration: "9s",
    delay: "0s",
  },
  {
    kind: "capsule",
    tone: "teal",
    position:
      "top-[6%] right-[2%] w-[clamp(2.5rem,5vw,5.5rem)] sm:right-[6%] lg:top-[18%] lg:right-[10%]",
    rise: "-8px",
    duration: "11s",
    delay: "-2.5s",
  },
  {
    kind: "paper",
    tone: "purple",
    position:
      "bottom-[5%] right-[6%] w-[clamp(2.25rem,4.5vw,5rem)] sm:bottom-[10%] sm:right-[16%] lg:bottom-[14%] lg:right-[20%]",
    rise: "-11px",
    duration: "10s",
    delay: "-5s",
  },
];

/**
 * The isometric grid behind the headline.
 *
 * Two families of lines at thirty degrees, which is the floor the tiles stand
 * on, drawn at seven per cent and masked so it fades out well before the edges
 * of the hero. It is a texture, not a graphic: at this weight it reads as
 * paper rather than as something to look at, and the headline above it is
 * unaffected either way.
 */
function IsoGrid() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <defs>
        <pattern
          id="iso-grid-up"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(30)"
        >
          <path d="M0 0H32" stroke="var(--color-ink)" strokeWidth="1" />
        </pattern>
        <pattern
          id="iso-grid-down"
          width="32"
          height="32"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-30)"
        >
          <path d="M0 0H32" stroke="var(--color-ink)" strokeWidth="1" />
        </pattern>
        <radialGradient id="iso-grid-fade" cx="50%" cy="44%" r="62%">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="55%" stopColor="#fff" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="iso-grid-mask">
          <rect width="100%" height="100%" fill="url(#iso-grid-fade)" />
        </mask>
      </defs>
      <g mask="url(#iso-grid-mask)" opacity="0.07">
        <rect width="100%" height="100%" fill="url(#iso-grid-up)" />
        <rect width="100%" height="100%" fill="url(#iso-grid-down)" />
      </g>
    </svg>
  );
}

export function HeroIsoField({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        className,
      )}
      data-testid="hero-iso-field"
    >
      <IsoGrid />
      {FLOATING.map((tile) => (
        <IsoTile
          key={`${tile.kind}-${tile.tone}`}
          kind={tile.kind}
          tone={tile.tone}
          className={cn("float-bob absolute opacity-90", tile.position)}
          style={
            {
              "--float-rise": tile.rise,
              "--float-duration": tile.duration,
              "--float-delay": tile.delay,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/**
 * One tile, at the size the quiet states use it: beside a 404, an error, an
 * empty section or an unreachable backend, where a page with nothing on it
 * would otherwise read as a page that failed to load.
 */
export function IsoMark({
  kind,
  tone = "purple",
  className,
}: {
  kind: IsoKind;
  tone?: IsoTone;
  className?: string;
}) {
  return <IsoTile kind={kind} tone={tone} className={cn("size-16 shrink-0", className)} />;
}
