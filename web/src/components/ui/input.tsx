import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-2 text-base text-[var(--color-ink)] transition-colors placeholder:text-[var(--color-ink-2)] focus-visible:border-[var(--color-herb)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-herb)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
