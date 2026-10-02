import Link from "next/link";

import { loadStats } from "@/lib/server-data";
import { FOOTER_DISCLAIMER } from "@/lib/text";

/**
 * The footer, on every page: the disclaimer in short form, the scope, and a
 * link to how it works.
 *
 * The scope line is three counts from /stats. When the backend cannot be
 * reached the line is simply absent -- writing "40 herbs" here as a fallback
 * would be exactly the kind of invented number this project refuses.
 */
export async function SiteFooter() {
  const stats = await loadStats();
  const scope = stats.ok ? stats.data.scope : null;

  return (
    <footer className="border-t border-[var(--color-line)] bg-[var(--color-surface)]">
      <div className="page-shell flex flex-col gap-2 py-8 text-sm text-[var(--color-ink-2)]">
        <p className="max-w-[80ch]">{FOOTER_DISCLAIMER}</p>

        {scope ? (
          <p className="max-w-[80ch]">
            Covers {scope.herbs} Ayurvedic herbs, {scope.drugs} conventional drugs across{" "}
            {scope.drug_classes} drug classes, and {scope.conditions} conditions. Nothing in
            it has been reviewed by a clinician.
          </p>
        ) : null}

        <p className="mt-2">
          <Link
            href="/how-it-works"
            className="font-medium text-[var(--color-ink)] underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
          >
            How it works
          </Link>
        </p>
      </div>
    </footer>
  );
}
