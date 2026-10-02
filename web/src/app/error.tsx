"use client";

import { RotateCcw } from "lucide-react";

import { DiscMark } from "@/components/disc-mark";
import { Button } from "@/components/ui/button";
import { UNREACHABLE_MESSAGE } from "@/lib/api";

/**
 * The last resort when a render throws.
 *
 * Pages report an unreachable backend themselves, with the same wording, so
 * reaching this one usually means something unexpected. It still leads with the
 * most likely cause, because the most likely cause is that the backend is not
 * running -- and the message names the command that starts it.
 */
export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page-shell py-16 lg:py-24">
      <div className="mx-auto max-w-2xl">
        <DiscMark />
        <h1 className="mt-8">Something went wrong</h1>
        <p className="mt-4 text-[var(--color-ink-2)]">{UNREACHABLE_MESSAGE}</p>
        <div className="mt-8">
          <Button type="button" onClick={reset}>
            <RotateCcw className="size-4" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    </div>
  );
}
