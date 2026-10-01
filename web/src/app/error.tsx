"use client";

import { RotateCcw, ServerOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UNREACHABLE_MESSAGE } from "@/lib/api";

/**
 * The last resort when a render throws.
 *
 * Pages report an unreachable backend themselves, with the same wording, so
 * reaching this one usually means something unexpected. It still leads with the
 * most likely cause, because the most likely cause is that the backend is not
 * running.
 */
export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <div className="flex items-center gap-2.5 text-[var(--color-verified)]">
        <ServerOff className="size-6 shrink-0" aria-hidden="true" />
        <h1 className="text-2xl">Something went wrong</h1>
      </div>
      <p className="mt-4 text-[var(--color-ink-2)]">{UNREACHABLE_MESSAGE}</p>
      <p className="mt-3 text-sm text-[var(--color-ink-2)]">
        Start it with{" "}
        <code className="rounded-sm bg-[var(--color-wash)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-xs">
          python -m hdi.api
        </code>{" "}
        from the project root. If it is already running, check that the web app is
        pointed at it.
      </p>
      <div className="mt-7">
        <Button type="button" onClick={reset}>
          <RotateCcw className="size-4" aria-hidden="true" />
          Try again
        </Button>
      </div>
    </div>
  );
}
