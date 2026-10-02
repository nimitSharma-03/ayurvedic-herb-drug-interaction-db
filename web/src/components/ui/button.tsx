import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * A 6px corner and a hairline, in every variant.
 *
 * The primary button is the one vermilion fill on a page, with white type on
 * it, which clears AA in both themes. Everything else is an outline or plain
 * text, so the primary action is never in doubt. Focus comes from the
 * `:focus-visible` rule in globals.css, so every focusable thing in the app
 * rings the same way.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-field)] text-[0.9375rem] font-medium transition-[background-color,border-color,color,opacity] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--color-primary-fill)] text-[var(--color-on-primary)] hover:bg-[#c81e17]",
        secondary:
          "border border-[var(--color-ink)]/25 bg-transparent text-[var(--color-ink)] hover:border-[var(--color-ink)]/60",
        quiet:
          "text-[var(--color-ink-2)] hover:bg-[var(--color-wash)] hover:text-[var(--color-ink)]",
      },
      size: {
        sm: "h-10 px-4",
        md: "h-12 px-5",
        lg: "h-12 px-6 text-base",
        icon: "size-11 p-0",
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
