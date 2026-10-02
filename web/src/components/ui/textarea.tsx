import * as React from "react";

import { cn } from "@/lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-32 w-full rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-6 py-4 text-base text-[var(--color-ink)] transition-colors placeholder:text-[var(--color-ink-2)] focus-visible:border-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
