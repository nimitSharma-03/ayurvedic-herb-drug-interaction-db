import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckPairForm } from "@/components/check-pair-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Check two medicines",
  description:
    "Check two medicines against each other for a documented interaction. The check is order-independent and resolves other names.",
};

export default function CheckPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl sm:text-4xl">Check two medicines</h1>
      <p className="mt-3 text-[var(--color-ink-2)]">
        Pick two and this looks for a documented interaction between them in the curated
        literature. The answer is the same whichever order you put them in.
      </p>

      <Suspense fallback={<Skeleton className="mt-8 h-64 w-full" />}>
        <CheckPairForm />
      </Suspense>
    </div>
  );
}
