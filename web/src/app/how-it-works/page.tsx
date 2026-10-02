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
    "The five stages behind this database, the counts at each one, the classifier's measured scores, and what still needs expert review.",
};

export default async function HowItWorksPage() {
  const stats = await loadStats();

  if (!stats.ok) {
    return (
      <div className="page-shell py-12 lg:py-16">
        <ApiUnreachable error={stats.error} what="the pipeline counts" />
      </div>
    );
  }

  const { literature, scope, knowledge, classifier, classifier_note, note } = stats.data;

  return (
    <div className="mx-auto w-full max-w-[64rem] px-4 py-12 sm:px-8 lg:py-16">
      <h1 className="heading-rule">How it works</h1>
      <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">{note}</p>

      <Pipeline stats={stats.data} />

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">Where each answer comes from</h2>
        <dl className="ruled-list mt-4">
          <BasisRow
            label="abstracts screened, no interaction language"
            value={literature.no_finding_basis.abstracts_screened_nothing_found}
          />
          <BasisRow
            label="searches that returned no abstracts"
            value={literature.no_finding_basis.search_returned_no_abstracts}
          />
          <BasisRow
            label="candidates a curator rejected"
            value={literature.no_finding_basis.curator_rejected_the_candidates}
          />
          <BasisRow
            label="a curator marked unclear"
            value={literature.no_finding_basis.curator_marked_it_unclear}
          />
        </dl>
        <p className="mt-6 max-w-[70ch] text-sm text-[var(--color-ink-2)]">
          None of those is a safety claim. "We looked and found nothing" is a different
          statement from "this combination is fine", and this database never collapses the
          two.
        </p>
      </section>

      <Classifier metrics={classifier} fallbackNote={classifier_note} />

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">Knowledge sources</h2>
        <SourceBar knowledge={knowledge} />
      </section>

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">Nothing here has been reviewed</h2>
        <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
          Of the {formatCount(knowledge.rows)} use rows,{" "}
          <strong className="font-medium text-[var(--color-ink)]">
            {formatCount(knowledge.reviewed_rows)}
          </strong>{" "}
          have been reviewed by a clinician. The schema will not accept a row that claims
          otherwise. The automated checks catch dosing, brand names and safety claims;
          they cannot catch a summary that is clinically misleading.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="heading-rule text-2xl sm:text-[2rem]">Scope</h2>
        <dl className="ruled-list mt-4">
          <ScopeRow label="Ayurvedic herbs" value={scope.herbs} />
          <ScopeRow label="conventional drugs" value={scope.drugs} />
          <ScopeRow label="conditions" value={scope.conditions} />
        </dl>
        <ul className="mt-6 flex flex-wrap gap-2">
          {scope.drug_classes_detail.map((entry) => (
            <li key={entry.drug_class}>
              <Badge tone="drug">
                {entry.drug_class}: {entry.drugs}
              </Badge>
            </li>
          ))}
        </ul>
        <p className="mt-6 max-w-[70ch] text-sm text-[var(--color-ink-2)]">
          {formatCount(scope.aliases)} other names, {formatCount(scope.class_aliases)} lay
          group names and {formatCount(scope.condition_synonyms)} condition wordings
          resolve onto that set. Anything outside it returns nothing rather than a guess.
        </p>
      </section>

      <section className="panel mt-12 p-6 sm:p-8">
        <h2 className="text-2xl sm:text-[2rem]">The full disclaimer</h2>
        <p className="mt-4 max-w-[70ch]">
          This is information drawn from a research database, not medical advice. It is
          not a diagnosis and not a prescription. Nothing in it has been reviewed by a
          clinician, every use row reports itself as unreviewed, and the condition
          classifier was measured on text written inside this project rather than on
          anything a patient wrote.
        </p>
        <p className="mt-3 max-w-[70ch]">
          No dose appears anywhere, because this project has no sourced dose for anything.
          No brand name is printed, although brand names are matched so a reader can type
          what is on their strip. The absence of a documented interaction is never
          reported as safety.
        </p>
        <p className="mt-3 max-w-[70ch]">
          Talk to a doctor or a pharmacist before taking anything described here, and do
          not start or stop a prescribed medicine on the strength of what this database
          says.
        </p>
      </section>
    </div>
  );
}

/**
 * The five stages, each with the count it produced.
 *
 * Numbered and strung on one hairline, so the order reads as a pipeline rather
 * than as five unrelated cards. The rule is trimmed to start at the first digit
 * and stop at the last.
 */
function Pipeline({ stats }: { stats: StatsResponse }) {
  const { literature } = stats;
  const stages = [
    {
      step: "Search",
      count: literature.pairs_searched,
      unit: "herb and drug pairs",
      body: "The whole grid, not the pairs that returned something.",
    },
    {
      step: "Harvest",
      count: literature.abstracts_harvested,
      unit: "abstracts retrieved",
      body: `Across ${formatCount(literature.distinct_pmids_harvested)} distinct papers. Empty searches are recorded against the pair.`,
    },
    {
      step: "Extract",
      count: literature.candidate_sentences,
      unit: "candidate sentences",
      body: "Each tagged with the trigger phrase that matched, and whether it was negated.",
    },
    {
      step: "Curate",
      count: literature.verdicts.confirmed,
      unit: "sentences confirmed by a curator",
      body: `${formatCount(literature.verdicts.rejected)} rejected, ${formatCount(literature.verdicts.unclear)} unclear. All kept.`,
    },
    {
      step: "Serve",
      count: literature.documented_pairs,
      unit: "pairs with a documented interaction",
      body: `Citing ${formatCount(literature.distinct_pmids_cited)} distinct papers.`,
    },
  ];

  return (
    <section className="mt-12">
      <h2 className="heading-rule text-2xl sm:text-[2rem]">From papers to answers</h2>
      <ol className="relative mt-4">
        <span
          aria-hidden="true"
          className="absolute top-8 bottom-8 left-[0.9375rem] w-px bg-[var(--color-line)]"
        />
        {stages.map((stage, index) => (
          <li
            key={stage.step}
            className="relative flex gap-5 border-t border-[var(--color-line)] py-5 first:border-t-0"
            data-testid="pipeline-stage"
          >
            <span className="relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border border-[var(--color-line)] bg-[var(--color-paper)] font-[family-name:var(--font-mono)] text-sm text-[var(--color-ink-2)]">
              {String(index + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-lg">{stage.step}</h3>
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">{stage.body}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-2xl font-semibold tabular-nums">
                {formatCount(stage.count)}
              </p>
              <p className="text-sm text-[var(--color-ink-2)]">{stage.unit}</p>
            </div>
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
        <h2 className="heading-rule text-2xl sm:text-[2rem]">The condition classifier</h2>
        <p className="mt-4 text-[var(--color-insufficient)]">
          {fallbackNote ?? NOT_RECORDED}
        </p>
      </section>
    );
  }

  const best = Math.max(...metrics.per_class.map((row) => row.f1), 1);

  return (
    <section className="mt-12" data-testid="classifier-section">
      <h2 className="heading-rule text-2xl sm:text-[2rem]">The condition classifier</h2>
      <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
        {metrics.model}. A condition is reported at or above {metrics.threshold}; below
        that the answer says it could not be matched.
      </p>

      <dl className="ruled-list mt-4">
        <ScoreRow label="macro-F1, test set" value={metrics.macro_f1_test} />
        <ScoreRow label="macro-F1, validation split" value={metrics.macro_f1_validation} />
        <ScopeRow label="rows scored" value={metrics.rows_scored} />
      </dl>

      <h3 className="mt-8 text-lg">F1 by condition</h3>
      <ul className="ruled-list mt-3">
        {metrics.per_class.map((row) => (
          <li key={row.class} className="py-3" data-testid="per-class-bar">
            <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
              <span className="mr-auto font-medium">{humanizeToken(row.class)}</span>
              <span className="text-[var(--color-ink-2)]">
                precision {row.precision.toFixed(3)} · recall {row.recall.toFixed(3)} ·{" "}
                {row.support} rows
              </span>
              <span className="font-semibold tabular-nums">{row.f1.toFixed(3)}</span>
            </div>
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-wash)]"
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
        className="mt-6 max-w-[70ch] border-l-2 border-[var(--color-mechanism)] pl-4 text-sm"
        data-testid="synthetic-note"
      >
        {metrics.test_set_caveat}
      </p>

      <p className="mt-4 max-w-[70ch] text-sm text-[var(--color-ink-2)]">
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
    return <p className="mt-4 text-[var(--color-insufficient)]">{NOT_RECORDED}</p>;
  }

  const colours = ["var(--color-herb)", "var(--color-drug)", "var(--color-insufficient)"];

  return (
    <div className="mt-4" data-testid="source-bar">
      <div className="flex h-2 w-full overflow-hidden rounded-full">
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
      <ul className="ruled-list mt-4">
        {knowledge.by_source_type.map((row, index) => (
          <li key={row.source_type} className="flex items-center gap-3 py-3 text-sm">
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: colours[index % colours.length] }}
            />
            <span className="mr-auto">{sourceTypeLabel(row.source_type)}</span>
            <span className="font-semibold tabular-nums">{row.rows}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 max-w-[70ch] text-sm text-[var(--color-ink-2)]">
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
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-[var(--color-ink-2)]">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{formatCount(value)}</dd>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-[var(--color-ink-2)]">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">
        {value === null ? NOT_RECORDED : value.toFixed(4)}
      </dd>
    </div>
  );
}

function BasisRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="text-sm text-[var(--color-ink-2)]">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{formatCount(value)}</dd>
    </div>
  );
}
