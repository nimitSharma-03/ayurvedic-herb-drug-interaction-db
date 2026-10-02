import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-12 w-full min-w-0 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-5 py-2 text-base text-[var(--color-ink)] transition-colors placeholder:text-[var(--color-ink-2)] focus-visible:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
