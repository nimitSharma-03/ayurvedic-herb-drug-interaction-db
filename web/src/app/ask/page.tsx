import type { Metadata } from "next";

import { AskForm } from "@/components/ask-form";
import { ApiUnreachable } from "@/components/api-unreachable";
import { loadConditions } from "@/lib/server-data";

export const metadata: Metadata = {
  title: "Describe a problem",
  description:
    "Describe a problem and see the Ayurvedic and conventional options this database records for it, with the pairs to watch.",
};

export default async function AskPage() {
  // Loaded here so the supported-condition chips are on the page before the
  // reader has typed anything, and so an unreachable backend is reported up
  // front rather than after they have written out their problem.
  const conditions = await loadConditions();

  return (
    <div className="page-shell py-12 lg:py-16">
      <h1 className="heading-rule max-w-[24ch]">Describe a problem</h1>
      <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
        In your own words, in English or Hinglish.
      </p>

      {conditions.ok ? (
        <AskForm supportedConditions={conditions.data.results} note={conditions.data.note} />
      ) : (
        <div className="mt-8">
          <ApiUnreachable error={conditions.error} what="the supported conditions" />
        </div>
      )}
    </div>
  );
}
