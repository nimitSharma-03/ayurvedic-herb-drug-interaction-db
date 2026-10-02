import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Small pills: the one place the pill shape is kept. The colour variants map
 * one-to-one onto the project's own vocabulary, so a badge cannot say
 * "literature-verified" in the mechanism-based colour: the caller passes the
 * level and the colour follows from it.
 *
 * Every tone is its own colour on a faint wash of itself, which keeps the text
 * above 4.5:1 in both themes, and no tone is ever the only thing distinguishing
 * one level from another -- the callers pass an icon and the full wording with
 * it.
 */
const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 py-0.5 text-sm font-medium whitespace-nowrap [&_svg]:size-3.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        neutral:
          "border-[var(--color-line)] bg-[var(--color-wash)] text-[var(--color-ink-2)]",
        herb: "border-[var(--color-herb)]/35 bg-[var(--color-herb)]/8 text-[var(--color-herb)]",
        drug: "border-[var(--color-drug)]/35 bg-[var(--color-drug)]/8 text-[var(--color-drug)]",
        verified:
          "border-[var(--color-verified)]/40 bg-[var(--color-verified)]/8 text-[var(--color-verified)]",
        mechanism:
          "border-[var(--color-mechanism)]/40 bg-[var(--color-mechanism)]/8 text-[var(--color-mechanism)]",
        insufficient:
          "border-[var(--color-insufficient)]/35 bg-[var(--color-insufficient)]/8 text-[var(--color-insufficient)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

function Badge({
  className,
  tone,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "span";
  return (
    <Component
      data-slot="badge"
      className={cn(badgeVariants({ tone }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
