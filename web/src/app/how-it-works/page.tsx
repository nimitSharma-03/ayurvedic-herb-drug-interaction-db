import type { Metadata } from "next";

import { ApiUnreachable } from "@/components/api-unreachable";
import { Badge } from "@/components/ui/badge";
import { loadStats } from "@/lib/server-data";
import { NOT_RECORDED, formatCount, humanizeToken } from "@/lib/text";
import { sourceTypeLabel } from "@/lib/options";
import type { ClassifierMetrics, StatsResponse } from "@/lib/types";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "The five stages behind this database, the real counts at each one, the classifier's measured scores, and what still needs expert review.",
};

export default async function HowItWorksPage() {
  const stats = await loadStats();

  if (!stats.ok) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6">
        <ApiUnreachable error={stats.error} what="the pipeline counts" />
      </div>
    );
  }

  const { literature, scope, knowledge, classifier, classifier_note, note } = stats.data;

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl sm:text-4xl">How it works</h1>
      <p className="mt-3 max-w-2xl text-[var(--color-ink-2)]">{note}</p>

      <Pipeline stats={stats.data} />

      <section className="mt-12">
        <h2 className="text-2xl">Where each answer comes from</h2>
        <p className="mt-2 text-[var(--color-ink-2)]">
          Most of the {formatCount(literature.pairs_searched)} pairs that were searched
          have no documented interaction, and each one records why.
        </p>
        <dl className="mt-5 grid gap-4 sm:grid-cols-2">
          <BasisRow
            label="abstracts were screened and held no interaction language"
            value={literature.no_finding_basis.abstracts_screened_nothing_found}
          />
          <BasisRow
            label="searches returned no abstracts at all"
            value={literature.no_finding_basis.search_returned_no_abstracts}
          />
          <BasisRow
            label="candidates a curator read and rejected"
            value={literature.no_finding_basis.curator_rejected_the_candidates}
          />
          <BasisRow
            label="a curator read and marked unclear"
            value={literature.no_finding_basis.curator_marked_it_unclear}
          />
        </dl>
        <p className="mt-4 text-sm text-[var(--color-ink-2)]">
          None of those is a safety claim. "We looked and found nothing" is a different
          statement from "this combination is fine", and this database never collapses the
          two.
        </p>
      </section>

      <Classifier metrics={classifier} fallbackNote={classifier_note} />

      <section className="mt-12">
        <h2 className="text-2xl">Knowledge sources</h2>
        <p className="mt-2 text-[var(--color-ink-2)]">
          Every option this database offers rests on one of{" "}
          {formatCount(knowledge.rows)} use rows. Each row records where it came from.
        </p>
        <SourceBar knowledge={knowledge} />
      </section>

      <section className="mt-12">
        <h2 className="text-2xl">Nothing here has been reviewed</h2>
        <p className="mt-3 text-[var(--color-ink-2)]">
          Of the {formatCount(knowledge.rows)} use rows,{" "}
          <strong className="text-[var(--color-ink)]">
            {formatCount(knowledge.reviewed_rows)}
          </strong>{" "}
          have been reviewed by a clinician. The database schema will not accept a row
          that claims otherwise, so this is not a promise but a constraint. Pros, cons and
          cautions were written by hand from drug labels, abstracts and classical sources;
          the automated checks catch dosing, brand names and safety claims, and they
          cannot catch a summary that is clinically misleading.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl">Scope</h2>
        <dl className="mt-5 grid gap-5 sm:grid-cols-3">
          <ScopeRow label="Ayurvedic herbs" value={scope.herbs} />
          <ScopeRow label="conventional drugs" value={scope.drugs} />
          <ScopeRow label="conditions" value={scope.conditions} />
        </dl>
        <ul className="mt-5 flex flex-wrap gap-2">
          {scope.drug_classes_detail.map((entry) => (
            <li key={entry.drug_class}>
              <Badge tone="drug">
                {entry.drug_class}: {entry.drugs}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-[var(--color-ink-2)]">
          The set is frozen. {formatCount(scope.aliases)} other names and{" "}
          {formatCount(scope.class_aliases)} lay group names resolve onto it, and{" "}
          {formatCount(scope.condition_synonyms)} wordings resolve onto the conditions.
          Anything outside returns nothing rather than a guess.
        </p>
      </section>

      <section className="mt-12 panel p-5 sm:p-7">
        <h2 className="text-2xl">The full disclaimer</h2>
        <p className="mt-3">
          This is information drawn from a research database, not medical advice. It is
          not a diagnosis and not a prescription. Nothing in it has been reviewed by a
          clinician, every use row reports itself as unreviewed, and the condition
          classifier was measured on text written inside this project rather than on
          anything a patient wrote.
        </p>
        <p className="mt-3">
          No dose appears anywhere, because this project has no sourced dose for anything.
          No brand name is printed, although brand names are matched so a reader can type
          what is on their strip. The absence of a documented interaction is never
          reported as safety.
        </p>
        <p className="mt-3">
          Talk to a doctor or a pharmacist before taking anything described here, and do
          not start or stop a prescribed medicine on the strength of what this database
          says.
        </p>
      </section>
    </div>
  );
}

/** The five stages, each with the count it actually produced. */
function Pipeline({ stats }: { stats: StatsResponse }) {
  const { literature } = stats;
  const stages = [
    {
      step: "Search",
      count: literature.pairs_searched,
      unit: "herb and drug pairs",
      body: "Every herb in scope was searched against every drug in scope on PubMed. The size of this number is the point: it is the whole grid, not the pairs that returned something.",
    },
    {
      step: "Harvest",
      count: literature.abstracts_harvested,
      unit: "abstracts retrieved",
      body: `Across ${formatCount(literature.distinct_pmids_harvested)} distinct papers. Many searches came back empty, and that is recorded against the pair rather than quietly dropped.`,
    },
    {
      step: "Extract",
      count: literature.candidate_sentences,
      unit: "candidate sentences",
      body: "Sentences carrying interaction language were pulled out of the abstracts, each tagged with the trigger phrase that matched and whether that phrase was negated.",
    },
    {
      step: "Curate",
      count: literature.verdicts.confirmed,
      unit: "sentences confirmed by a curator",
      body: `${formatCount(literature.verdicts.rejected)} were rejected and ${formatCount(literature.verdicts.unclear)} were marked unclear. All of them are kept, because what was examined and dismissed is part of why a pair reads as having nothing.`,
    },
    {
      step: "Serve",
      count: literature.documented_pairs,
      unit: "pairs with a documented interaction",
      body: `Each one cites its abstracts: ${formatCount(literature.distinct_pmids_cited)} distinct papers in all. Everything else reports what was looked at and what was not found.`,
    },
  ];

  return (
    <section className="mt-10">
      <h2 className="text-2xl">From papers to answers</h2>
      <ol className="mt-5 flex flex-col gap-4">
        {stages.map((stage, index) => (
          <li key={stage.step} className="card-surface p-5" data-testid="pipeline-stage">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-[family-name:var(--font-mono)] text-sm text-[var(--color-ink-2)]">
                {index + 1}
              </span>
              <h3 className="mr-auto text-lg">{stage.step}</h3>
              <p className="font-[family-name:var(--font-heading)] text-2xl font-semibold tabular-nums">
                {formatCount(stage.count)}
              </p>
            </div>
            <p className="text-sm text-[var(--color-ink-2)]">{stage.unit}</p>
            <p className="mt-2.5 text-sm">{stage.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Classifier({
  metrics,
  fallbackNote,
}: {
  metrics: ClassifierMetrics | null;
  fallbackNote: string | null;
}) {
  if (!metrics) {
    return (
      <section className="mt-12">
        <h2 className="text-2xl">The condition classifier</h2>
        <p className="mt-3 text-[var(--color-insufficient)]">
          {fallbackNote ?? NOT_RECORDED}
        </p>
      </section>
    );
  }

  const best = Math.max(...metrics.per_class.map((row) => row.f1), 1);

  return (
    <section className="mt-12" data-testid="classifier-section">
      <h2 className="text-2xl">The condition classifier</h2>
      <p className="mt-3 text-[var(--color-ink-2)]">
        Free text is turned into zero or more supported conditions by{" "}
        {metrics.model}. A condition is reported when it scores at or above{" "}
        {metrics.threshold}; below that the answer says it could not be matched rather
        than guessing.
      </p>

      <dl className="mt-5 grid gap-5 sm:grid-cols-3">
        <ScoreRow label="macro-F1 on the test set" value={metrics.macro_f1_test} />
        <ScoreRow
          label="macro-F1 on the validation split"
          value={metrics.macro_f1_validation}
        />
        <ScopeRow label="rows scored" value={metrics.rows_scored} />
      </dl>

      <h3 className="mt-7 text-lg">F1 by condition</h3>
      <ul className="mt-3 flex flex-col gap-3">
        {metrics.per_class.map((row) => (
          <li key={row.class} data-testid="per-class-bar">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="mr-auto font-semibold">{humanizeToken(row.class)}</span>
              <span className="text-[var(--color-ink-2)]">
                precision {row.precision.toFixed(3)} · recall {row.recall.toFixed(3)} ·{" "}
                {row.support} rows
              </span>
              <span className="font-[family-name:var(--font-heading)] font-semibold tabular-nums">
                {row.f1.toFixed(3)}
              </span>
            </div>
            <div
              className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-[var(--color-wash)]"
              role="img"
              aria-label={`F1 ${row.f1.toFixed(3)} for ${humanizeToken(row.class)}`}
            >
              <div
                className="h-full rounded-full bg-[var(--color-herb)]"
                style={{ width: `${(row.f1 / best) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>

      <p
        className="mt-6 rounded-[var(--radius-card-sm)] border border-[var(--color-mechanism)]/35 bg-[var(--color-mechanism)]/8 p-4 text-sm"
        data-testid="synthetic-note"
      >
        {metrics.test_set_caveat}
      </p>

      <p className="mt-4 text-sm text-[var(--color-ink-2)]">
        Of {metrics.multi_condition_rows.total} rows describing two conditions at once,
        both were found in {metrics.multi_condition_rows.exact_set}, one of the two in{" "}
        {metrics.multi_condition_rows.partial}, and neither in{" "}
        {metrics.multi_condition_rows.none_correct}.
      </p>
    </section>
  );
}

/** The use rows by source type, as one stacked bar. */
function SourceBar({ knowledge }: { knowledge: StatsResponse["knowledge"] }) {
  const total = knowledge.by_source_type.reduce((sum, row) => sum + row.rows, 0);
  if (total === 0) {
    return (
      <p className="mt-4 text-[var(--color-insufficient)]">{NOT_RECORDED}</p>
    );
  }

  const colours = ["var(--color-herb)", "var(--color-drug)", "var(--color-insufficient)"];

  return (
    <div className="mt-5" data-testid="source-bar">
      <div className="flex h-7 w-full overflow-hidden rounded-full border border-[var(--color-line)]">
        {knowledge.by_source_type.map((row, index) => (
          <div
            key={row.source_type}
            style={{
              width: `${(row.rows / total) * 100}%`,
              backgroundColor: colours[index % colours.length],
            }}
            role="img"
            aria-label={`${row.rows} of ${total} rows: ${sourceTypeLabel(row.source_type)}`}
          />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-2">
        {knowledge.by_source_type.map((row, index) => (
          <li key={row.source_type} className="flex items-center gap-2.5 text-sm">
            <span
              aria-hidden="true"
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: colours[index % colours.length] }}
            />
            <span className="mr-auto">{sourceTypeLabel(row.source_type)}</span>
            <span className="font-semibold tabular-nums">{row.rows}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-sm text-[var(--color-ink-2)]">
        {knowledge.combination_rules} tag-pair rules over {knowledge.tags} pharmacological
        tags produce the mechanism-based cautions. A rule is reasoning about what two
        substances do, never a published finding, and it is labelled that way every time
        it fires.
      </p>
    </div>
  );
}

function ScopeRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-sm text-[var(--color-ink-2)]">{label}</dt>
      <dd className="font-[family-name:var(--font-heading)] text-3xl font-semibold tabular-nums">
        {formatCount(value)}
      </dd>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-sm text-[var(--color-ink-2)]">{label}</dt>
      <dd className="font-[family-name:var(--font-heading)] text-3xl font-semibold tabular-nums">
        {value === null ? NOT_RECORDED : value.toFixed(4)}
      </dd>
    </div>
  );
}

function BasisRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="card-surface p-4">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span className="font-[family-name:var(--font-heading)] text-2xl font-semibold tabular-nums">
          {formatCount(value)}
        </span>
        <span className="mt-0.5 block text-sm text-[var(--color-ink-2)]">{label}</span>
      </dd>
    </div>
  );
}
