import { cn } from "@/lib/utils";

/**
 * The brand mark: one isometric tile whose top face is split down its own short
 * diagonal, sage on the herb side with a leaf vein and teal on the medicine
 * side. One shape for the two halves of the subject, which is the whole idea of
 * the project, drawn in the same projection as the hero's tiles so the mark and
 * the hero read as one drawing.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={cn("size-9 shrink-0", className)}
      role="img"
      aria-label="An isometric tile, one half a leaf and one half a tablet"
    >
      <clipPath id="brand-top-face">
        <path d="M60 24 L104 46 L60 68 L16 46 Z" />
      </clipPath>
      <g clipPath="url(#brand-top-face)">
        <rect x="16" y="24" width="44" height="44" fill="var(--color-accent-sage)" />
        <rect x="60" y="24" width="44" height="44" fill="var(--color-accent-teal)" />
        {/* The leaf vein, laid on the herb half in the top face's own plane. */}
        <g
          transform="translate(60 46) matrix(1 0.5 -1 0.5 0 0)"
          fill="none"
          stroke="var(--color-ink)"
          strokeOpacity="0.6"
          strokeWidth="2.5"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        >
          <path d="M-4 -15V13" />
          <path d="M-4 -5-13 -10M-4 3-13 -2" />
        </g>
      </g>

      <path d="M16 46 L60 68 L60 86 L16 64 Z" fill="var(--color-accent-sage)" />
      <path d="M16 46 L60 68 L60 86 L16 64 Z" fill="var(--color-ink)" opacity="0.3" />
      <path d="M60 68 L104 46 L104 64 L60 86 Z" fill="var(--color-accent-teal)" />
      <path d="M60 68 L104 46 L104 64 L60 86 Z" fill="var(--color-ink)" opacity="0.14" />

      <path
        d="M16 46 L60 24 L104 46 L104 64 L60 86 L16 64 Z"
        fill="none"
        stroke="var(--color-ink)"
        strokeOpacity="0.22"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M60 24 L60 68"
        stroke="var(--color-ink)"
        strokeOpacity="0.16"
        strokeWidth="2"
      />
    </svg>
  );
}
