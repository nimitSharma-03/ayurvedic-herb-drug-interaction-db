import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Pills, at 14px, in every variant.
 *
 * The primary button is an ink fill rather than an accent one: the accents in
 * this palette are pastels, and a pastel fill with light type on it would not
 * reach AA. The accent appears as the halo on hover and focus instead, where
 * it carries no text. Focus itself comes from the `:focus-visible` rule in
 * globals.css, so every focusable thing in the app rings the same way.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-[background-color,border-color,box-shadow,color] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-ink)] text-[var(--color-on-ink)] hover:bg-[var(--color-primary)] hover:shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-ring)_50%,transparent)]",
        secondary:
          "border border-[var(--color-line)] bg-[var(--color-surface)] text-[var(--color-ink)] hover:border-[var(--color-primary)] hover:bg-[var(--color-wash)]",
        quiet:
          "text-[var(--color-ink-2)] hover:bg-[var(--color-wash)] hover:text-[var(--color-ink)]",
        danger:
          "bg-[var(--color-verified)] text-[var(--color-on-ink)] hover:shadow-[0_0_0_5px_color-mix(in_oklab,var(--color-accent-pink)_45%,transparent)]",
      },
      size: {
        sm: "h-10 px-5",
        md: "h-12 px-6",
        lg: "h-14 px-8 text-base",
        icon: "size-11 rounded-full p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
