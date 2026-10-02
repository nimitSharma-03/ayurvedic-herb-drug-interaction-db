import type { Metadata } from "next";
import { Suspense } from "react";

import { CheckPairForm } from "@/components/check-pair-form";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata: Metadata = {
  title: "Check a pair",
  description:
    "Check two medicines against each other for a documented interaction. The check is order-independent and resolves other names.",
};

export default function CheckPage() {
  return (
    <div className="page-shell py-12 lg:py-16">
      <div className="mx-auto max-w-5xl">
        <h1 className="heading-rule">Check a pair</h1>
        <p className="mt-4 text-[var(--color-ink-2)]">
          The answer is the same whichever order you put them in.
        </p>

        <Suspense fallback={<Skeleton className="mt-8 h-64 w-full" />}>
          <CheckPairForm />
        </Suspense>
      </div>
    </div>
  );
}
