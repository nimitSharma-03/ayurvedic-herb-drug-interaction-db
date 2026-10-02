import { cn } from "@/lib/utils";

/**
 * A loading placeholder.
 *
 * Deliberately not a pulsing animation: a shimmer that never stops is the one
 * kind of motion this design has no use for, and the shape alone already says
 * "something is coming". `aria-hidden` keeps it out of the accessibility tree,
 * and whatever is loading announces itself with its own live region.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("rounded-[var(--radius-tight)] bg-[var(--color-wash)]", className)}
      {...props}
    />
  );
}

export { Skeleton };
