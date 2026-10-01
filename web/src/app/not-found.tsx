import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-20 sm:px-6">
      <p className="font-[family-name:var(--font-mono)] text-sm text-[var(--color-ink-2)]">
        404
      </p>
      <h1 className="mt-2 text-3xl sm:text-4xl">That page is not here</h1>
      <p className="mt-3 text-[var(--color-ink-2)]">
        The link may be wrong, or it may name a herb or a medicine this database does not
        cover. The set of herbs and drugs here is fixed, and a name outside it has no page
        rather than an empty one.
      </p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/medicines">Browse the medicines</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/">Back to the start</Link>
        </Button>
      </div>
    </div>
  );
}
