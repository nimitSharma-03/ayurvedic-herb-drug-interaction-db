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
      <div className="page-shell py-16 lg:py-20">
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
    <div className="mx-auto w-full max-w-[76rem] px-4 py-12 sm:px-8 lg:py-16">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {isHerb ? (
          <Leaf className="mt-1.5 size-6 shrink-0 text-[var(--color-herb)]" aria-hidden="true" />
        ) : (
          <Pill className="mt-1.5 size-6 shrink-0 text-[var(--color-drug)]" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <h1>{medicine.name}</h1>
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

      <section className="panel mt-8 p-6 sm:p-8">
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
      </section>

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">What it is recorded for</h2>

        {medicine.recorded_uses.length === 0 ? (
          <div className="mt-4">
            <EmptySection>
              No use is recorded here. That means no file in this project sources one, not
              that it has none.
            </EmptySection>
          </div>
        ) : (
          <ul className="mt-5 grid gap-4">
            {medicine.recorded_uses.map((use) => (
              <li
                key={`${use.condition_id}-${use.use_kind}`}
                className="card-surface p-6"
                data-testid="recorded-use"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-xl">{use.condition_name}</h3>
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

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">Documented interactions</h2>

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

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">Pairs checked with no finding</h2>
        <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
          {others.length} more pairs were looked at. Each says which it is: searched and
          nothing found, or no adequate basis to answer.
        </p>

        {others.length === 0 ? (
          <div className="mt-4">
            <EmptySection>
              No other pair involving this medicine is in the harvested corpus.
            </EmptySection>
          </div>
        ) : (
          <ul className="ruled-list mt-5">
            {others.map((record) => (
              <li key={record.id ?? `${record.medicine_a.id}-${record.medicine_b.id}`}>
                <InteractionRow record={record} self={medicine.id} compact />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12 flex flex-col gap-4 border-t border-[var(--color-line)] pt-8">
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
