"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The warning drawer: slides in from the right over a blurred backdrop.
 *
 * Built on Radix's dialog, so focus is trapped while it is open, Escape closes
 * it and the rest of the page is hidden from assistive technology. Both the
 * slide and the backdrop fade are switched off under prefers-reduced-motion by
 * the rule in globals.css.
 */
const Sheet = SheetPrimitive.Root;
const SheetTrigger = SheetPrimitive.Trigger;
const SheetClose = SheetPrimitive.Close;
const SheetTitle = function SheetTitleComponent({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      className={cn("font-[family-name:var(--font-heading)] text-xl", className)}
      {...props}
    />
  );
};

const SheetDescription = function SheetDescriptionComponent({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      className={cn("text-sm text-[var(--color-ink-2)]", className)}
      {...props}
    />
  );
};

function SheetContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content>) {
  return (
    <SheetPrimitive.Portal>
      <SheetPrimitive.Overlay
        className="fixed inset-0 z-40 animate-fade-in bg-[var(--color-ink)]/35 backdrop-blur-sm"
        data-slot="sheet-overlay"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-full max-w-[min(30rem,100vw)] animate-slide-in-right flex-col gap-5 overflow-y-auto border-l border-[var(--color-line)] bg-[var(--color-surface)] p-6 shadow-[var(--shadow-lift)] sm:rounded-l-[var(--radius-panel)]",
          className,
        )}
        {...props}
      >
        {children}
        <SheetPrimitive.Close
          className="absolute top-5 right-5 rounded-full p-1.5 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-wash)] hover:text-[var(--color-ink)]"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden="true" />
        </SheetPrimitive.Close>
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

export { Sheet, SheetTrigger, SheetClose, SheetContent, SheetTitle, SheetDescription };
