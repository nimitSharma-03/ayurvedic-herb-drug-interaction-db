/**
 * The flat version of the hero composition.
 *
 * It does three jobs with one drawing. It is in the markup the server sends, so
 * the hero is composed before any JavaScript runs; it holds the space the 3D
 * canvas will occupy, at the same size, so nothing on the page moves when the
 * canvas arrives; and it is what stays on screen for good if WebGL is
 * unavailable or the 3D chunk fails to load.
 *
 * Same idea as the scene it stands in for: a leaf and a capsule, apart, on one
 * shared circle. Same tokens too, so the two never disagree about the palette.
 */
export function HeroEmblem({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 260 160"
      className={className}
      role="img"
      aria-label="A leaf and a medicine capsule, apart, on one shared circle"
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <clipPath id="hero-emblem-capsule">
          <rect x="-11" y="-24" width="22" height="48" rx="11" />
        </clipPath>
      </defs>

      {/* The circle both pieces travel, seen from a little above. */}
      <ellipse
        cx="130"
        cy="82"
        rx="84"
        ry="28"
        fill="none"
        stroke="var(--color-line)"
        strokeWidth="1.3"
        transform="rotate(-6 130 82)"
      />

      {/* What the contact shadow does in the 3D scene. */}
      <ellipse cx="200" cy="140" rx="30" ry="6" fill="var(--color-ink)" opacity="0.07" />
      <ellipse cx="66" cy="142" rx="26" ry="5" fill="var(--color-ink)" opacity="0.07" />

      {/* Leaf on the right, capsule on the left, each leaning the way its 3D
          counterpart settles. The two drawings are laid over one another while
          the canvas fades in, and a mirrored emblem turns that handover into a
          moment where the page appears to hold two leaves. */}
      <g transform="translate(200 74) rotate(-14) scale(0.82)">
        <path
          d="M0-34C19-17 17 14 0 34C-17 14-19-17 0-34Z"
          fill="var(--color-herb)"
        />
        <path
          d="M0-27V27"
          stroke="var(--color-wash)"
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M0-18 11-26M0 0-11-8M0 15 10 8"
          stroke="var(--color-wash)"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.8"
        />
        <path d="M0 33 2 44" stroke="var(--color-ink-2)" strokeWidth="2.4" strokeLinecap="round" />
      </g>

      <g transform="translate(66 92) rotate(40)">
        <rect
          x="-11"
          y="-24"
          width="22"
          height="48"
          rx="11"
          fill="var(--color-surface)"
        />
        <g clipPath="url(#hero-emblem-capsule)">
          <rect x="-12" y="-25" width="24" height="25" fill="var(--color-drug)" />
        </g>
        <rect
          x="-11"
          y="-24"
          width="22"
          height="48"
          rx="11"
          fill="none"
          stroke="var(--color-ink)"
          strokeOpacity="0.12"
          strokeWidth="1"
        />
      </g>
    </svg>
  );
}
