import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Leaf, Pill } from "lucide-react";

import { ApiUnreachable } from "@/components/api-unreachable";
import { CategoryBadge, NotReviewedBadge, UseEvidenceBadge } from "@/components/evidence-badge";
import { Disclaimer } from "@/components/disclaimer";
import { EmptySection, Field } from "@/components/empty-field";
import { InteractionRow } from "@/components/interaction-row";
import { SourceNotePmids } from "@/components/pmid-link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, asApiError } from "@/lib/api";
import { sourceTypeLabel } from "@/lib/options";
import { NOT_RECORDED } from "@/lib/text";
import type { MedicineDetail, MedicineInteractionsResponse } from "@/lib/types";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  try {
    const medicine = await api.medicine(id);
    return {
      title: medicine.name,
      description: `What this database records about ${medicine.name}, including its documented interactions.`,
    };
  } catch {
    // The page itself reports the failure; a title is not worth a second try.
    return { title: "Medicine" };
  }
}

export default async function MedicinePage({ params }: PageProps) {
  const { id } = await params;

  let medicine: MedicineDetail;
  let interactions: MedicineInteractionsResponse;
  try {
    [medicine, interactions] = await Promise.all([
      api.medicine(id),
      api.medicineInteractions(id, { include_evidence: true, limit: 200 }),
    ]);
  } catch (error) {
    const failure = asApiError(error);
    // An unknown id is a 404 page, not an error panel: nothing went wrong, the
    // medicine simply is not in the frozen scope.
    if (failure.code === "medicine_not_found") notFound();
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <ApiUnreachable error={failure} what="this medicine" />
      </div>
    );
  }

  const isHerb = medicine.medicine_type === "herb";
  const documented = interactions.results.filter(
    (record) => record.status === "interaction_found",
  );
  const others = interactions.results.filter(
    (record) => record.status !== "interaction_found",
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {isHerb ? (
          <Leaf className="mt-2 size-7 shrink-0 text-[var(--color-herb)]" aria-hidden="true" />
        ) : (
          <Pill className="mt-2 size-7 shrink-0 text-[var(--color-drug)]" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h1 className="text-3xl sm:text-4xl">{medicine.name}</h1>
          {medicine.scientific_name ? (
            <p className="mt-1 text-lg italic text-[var(--color-ink-2)]">
              {medicine.scientific_name}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <CategoryBadge category={medicine.category} medicineType={medicine.medicine_type} />
          {medicine.drug_class ? <Badge tone="drug">{medicine.drug_class}</Badge> : null}
        </div>
      </div>

      <div className="mt-6">
        <Button asChild variant="secondary">
          <Link href={`/check?a=${encodeURIComponent(medicine.name)}`}>
            Check this against another medicine
          </Link>
        </Button>
      </div>

      <section className="panel mt-8 p-5 sm:p-7">
        <h2 className="text-xl">What this database holds</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Kind" value={isHerb ? "Ayurvedic herb" : "Conventional drug"} />
          <Field label="Botanical name" value={medicine.scientific_name} />
          <Field label="Generic name" value={medicine.generic_name} />
          <Field label="Drug class" value={medicine.drug_class} />
          <Field label="Evidence grade on the record itself" value={medicine.evidence_level} />
          <Field label="Also known as">
            {medicine.aliases.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {medicine.aliases.map((alias) => (
                  <li key={`${alias.alias_type}-${alias.alias}`}>
                    <Badge tone="neutral" className="font-normal">
                      {alias.alias}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </Field>
        </dl>
        <p className="mt-5 text-sm text-[var(--color-ink-2)]">
          Brand names are matched when a reader types one, and are never listed here.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl">What it is recorded for</h2>
        <p className="mt-2 max-w-2xl text-[var(--color-ink-2)]">
          Each row is one sourced use, with the pros, cons and cautions written beside it.
          None of them has been reviewed by a clinician.
        </p>

        {medicine.recorded_uses.length === 0 ? (
          <div className="mt-4">
            <EmptySection>
              No use is recorded for this medicine in this project. That means no file here
              sources one, not that it has none.
            </EmptySection>
          </div>
        ) : (
          <ul className="mt-5 grid gap-4">
            {medicine.recorded_uses.map((use) => (
              <li
                key={`${use.condition_id}-${use.use_kind}`}
                className="card-surface p-5"
                data-testid="recorded-use"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-lg">{use.condition_name}</h3>
                  <UseEvidenceBadge level={use.evidence_level} />
                  <NotReviewedBadge />
                </div>

                <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                  <Field label="Recorded use" value={use.uses} />
                  <Field label="Pros" value={use.pros} />
                  <Field label="Cons" value={use.cons} />
                  <Field label="Cautions" value={use.cautions} />
                  <Field label="Common side effects">
                    {use.common_side_effects.length > 0 ? (
                      <ul className="list-inside list-disc">
                        {use.common_side_effects.map((effect) => (
                          <li key={effect}>{effect}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Field>
                  <Field label="Source">
                    {use.source_note ? (
                      <div className="flex flex-col gap-1.5">
                        <p className="text-sm">{sourceTypeLabel(use.source_type)}</p>
                        <p className="text-sm text-[var(--color-ink-2)]">{use.source_note}</p>
                        <SourceNotePmids note={use.source_note} />
                      </div>
                    ) : null}
                  </Field>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl">Documented interactions</h2>
        <p className="mt-2 max-w-2xl text-[var(--color-ink-2)]">
          Pairs this project's curated literature records an interaction for, with the
          abstract each one rests on.
        </p>

        {documented.length === 0 ? (
          <div className="mt-4">
            <EmptySection>
              No documented interaction for this medicine in this database. This does not
              mean its combinations are safe.
            </EmptySection>
          </div>
        ) : (
          <ul className="mt-5 grid gap-4">
            {documented.map((record) => (
              <li key={record.id ?? `${record.medicine_a.id}-${record.medicine_b.id}`}>
                <InteractionRow record={record} self={medicine.id} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-2xl">Pairs checked with no finding</h2>
        <p className="mt-2 max-w-2xl text-[var(--color-ink-2)]">
          {others.length} more pairs involving this medicine were looked at. Each says
          which of the two it is: the literature was searched and nothing was found, or
          there is no adequate basis to answer at all.
        </p>

        {others.length === 0 ? (
          <div className="mt-4">
            <EmptySection>
              No other pair involving this medicine is in the harvested corpus.
            </EmptySection>
          </div>
        ) : (
          <ul className="mt-5 grid gap-3">
            {others.map((record) => (
              <li key={record.id ?? `${record.medicine_a.id}-${record.medicine_b.id}`}>
                <InteractionRow record={record} self={medicine.id} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-10 flex flex-col gap-4">
        <Field label="Row provenance">
          {medicine.sources.length > 0 ? (
            <ul className="flex flex-col gap-1 text-sm text-[var(--color-ink-2)]">
              {medicine.sources.map((source, index) => (
                <li key={`${source.source ?? "source"}-${index}`}>
                  {source.source ?? NOT_RECORDED}
                  {source.last_verified ? ` · checked ${source.last_verified}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </Field>

        <p className="text-sm text-[var(--color-ink-2)]">
          {medicine.data_completeness.note}
        </p>

        <Disclaimer text={interactions.disclaimer} />
      </section>
    </div>
  );
}
