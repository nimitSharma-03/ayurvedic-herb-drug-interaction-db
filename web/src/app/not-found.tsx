import Link from "next/link";

import { IsoMark } from "@/components/iso-art";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="page-shell py-16 lg:py-24">
      <div className="mx-auto max-w-2xl">
        <IsoMark kind="paper" tone="sage" className="size-14" />
        <h1 className="mt-6">That page is not here</h1>
        <p className="mt-4 text-[var(--color-ink-2)]">
          The link may be wrong, or it may name a herb or a medicine outside this
          database.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/medicines">Browse the medicines</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">Back to the start</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
