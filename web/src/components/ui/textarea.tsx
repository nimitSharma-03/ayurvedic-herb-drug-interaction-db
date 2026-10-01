import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-28 w-full rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 py-3 text-base text-[var(--color-ink)] transition-colors placeholder:text-[var(--color-ink-2)] focus-visible:border-[var(--color-herb)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-herb)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
