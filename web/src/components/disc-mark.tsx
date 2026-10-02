import { cn } from "@/lib/utils";

/**
 * The small vermilion disc the quiet states carry: the 404, the error page,
 * an empty section and an unreachable backend. The same disc as the home
 * hero's, at the size of an icon, so a page with nothing to show still reads
 * as part of the same site rather than as something that failed to draw.
 */
export function DiscMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block size-10 shrink-0 rounded-full bg-[radial-gradient(circle_at_50%_44%,#ec3a2a_0%,#e0231c_55%,#b81811_100%)] shadow-[0_0_1.5rem_rgb(224_35_28/0.25)]",
        className,
      )}
    />
  );
}
