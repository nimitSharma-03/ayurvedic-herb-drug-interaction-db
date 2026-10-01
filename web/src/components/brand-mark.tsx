import { cn } from "@/lib/utils";

/**
 * The brand mark: a capsule rotated about -40 degrees, its upper half herb
 * green with a leaf vein and its lower half drug indigo. One shape for the two
 * halves of the subject, which is the whole idea of the project.
 *
 * Drawn upright and rotated as a group, so the capsule's own geometry stays
 * simple and the split line between the halves stays exactly perpendicular to
 * its long axis.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7 shrink-0", className)}
      role="img"
      aria-label="Capsule mark, one half a leaf and one half a tablet"
    >
      <g transform="rotate(-40 16 16)">
        <clipPath id="brand-capsule">
          <rect x="10" y="3" width="12" height="26" rx="6" />
        </clipPath>
        <g clipPath="url(#brand-capsule)">
          <rect x="10" y="3" width="12" height="13" fill="var(--color-herb)" />
          <rect x="10" y="16" width="12" height="13" fill="var(--color-drug)" />
          {/* The leaf vein: a midrib up the herb half with two side veins. */}
          <path
            d="M16 14.2V5.2"
            stroke="var(--color-surface)"
            strokeWidth="1.1"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M16 8.4 18.6 6.4M16 11.4 13.4 9.4"
            stroke="var(--color-surface)"
            strokeWidth="1"
            strokeLinecap="round"
            fill="none"
            opacity="0.85"
          />
        </g>
        <rect
          x="10"
          y="3"
          width="12"
          height="26"
          rx="6"
          fill="none"
          stroke="var(--color-ink)"
          strokeOpacity="0.14"
          strokeWidth="1"
        />
        <path
          d="M10 16h12"
          stroke="var(--color-surface)"
          strokeWidth="1.2"
          strokeOpacity="0.9"
        />
      </g>
    </svg>
  );
}
