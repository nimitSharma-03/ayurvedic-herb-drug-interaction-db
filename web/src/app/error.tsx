"use client";

import { RotateCcw } from "lucide-react";

import { IsoMark } from "@/components/iso-art";
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
    <div className="page-shell py-16 lg:py-24">
      <div className="mx-auto max-w-2xl">
        <IsoMark kind="shield" tone="pink" className="size-14" />
        <h1 className="mt-6">Something went wrong</h1>
        <p className="mt-4 text-[var(--color-ink-2)]">{UNREACHABLE_MESSAGE}</p>
        <p className="mt-3 text-sm text-[var(--color-ink-2)]">
          Start it with{" "}
          <code className="rounded-[var(--radius-tight)] bg-[var(--color-wash)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-sm">
            python -m hdi.api
          </code>{" "}
          from the project root.
        </p>
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
