import type { Metadata } from "next";

import { AskForm } from "@/components/ask-form";
import { ApiUnreachable } from "@/components/api-unreachable";
import { loadConditions } from "@/lib/server-data";

export const metadata: Metadata = {
  title: "Describe a problem",
  description:
    "Describe a health problem in your own words and see the Ayurvedic and conventional options this database records, plus the combinations to avoid.",
};

export default async function AskPage() {
  // Loaded here so the supported-condition chips are on the page before the
  // reader has typed anything, and so an unreachable backend is reported up
  // front rather than after they have written out their problem.
  const conditions = await loadConditions();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl sm:text-4xl">Describe a problem</h1>
      <p className="mt-3 max-w-2xl text-[var(--color-ink-2)]">
        Write it in your own words, in English or Hinglish. This looks up what the
        database records for the conditions it recognises, and the combinations that
        should not be taken together. It is not a diagnosis and not a prescription.
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
