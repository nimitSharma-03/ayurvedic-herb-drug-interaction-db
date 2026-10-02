import Link from "next/link";

import { ApiUnreachable } from "@/components/api-unreachable";
import { AskForm } from "@/components/ask-form";
import { CountUp } from "@/components/count-up";
import { HeroIsoField } from "@/components/iso-art";
import { Button } from "@/components/ui/button";
import { loadConditions, loadStats } from "@/lib/server-data";
import { NOT_RECORDED } from "@/lib/text";

export default async function HomePage() {
  // The conditions come down with the counts so the form, its supported-condition
  // chips and the figures all arrive in the first response: a reader can start
  // typing their problem here without a page in between.
  const [stats, conditions] = await Promise.all([loadStats(), loadConditions()]);

  if (!stats.ok) {
    return (
      <div className="page-shell section-pad">
        <ApiUnreachable error={stats.error} what="the pipeline counts" />
      </div>
    );
  }

  const { literature, scope } = stats.data;

  /**
   * The four figures, in pipeline order. Each is a value from /stats, which
   * counts it from this repository's own files; nothing here is written down.
   * A count the backend reports as absent shows as absent.
   */
  const pipeline = [
    { label: "pairs searched", value: literature.pairs_searched },
    { label: "abstracts read", value: literature.abstracts_harvested },
    { label: "candidate sentences", value: literature.candidate_sentences },
    { label: "documented interactions", value: literature.documented_pairs },
  ];

  return (
    <>
      {/*
        The hero: one screen, less the header. Everything that sets a size is
        clamped off the viewport, so a short laptop screen gives up whitespace
        rather than a call to action.
      */}
      <section
        className="hero-box relative flex items-center overflow-hidden"
        data-testid="hero"
      >
        <HeroIsoField />

        <div className="page-shell animate-reveal relative z-10 flex flex-col items-center text-center">
          <h1 className="max-w-[26ch] text-balance">
            Describe a problem. See what the literature records.
          </h1>

          <p className="mt-5 max-w-[52ch] text-[var(--color-ink-2)]">
            A literature-grounded herb and medicine database, with PubMed citations on
            every record.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Button asChild size="lg">
              <Link href="/ask">Describe a problem</Link>
            </Button>
            <Button asChild size="lg" variant="secondary">
              <Link href="/check">Check a pair</Link>
            </Button>
          </div>
        </div>
      </section>

      {/* The figures, all of them from /stats. */}
      <section className="border-t border-[var(--color-line)] bg-[var(--color-surface)]">
        <div className="page-shell section-pad">
          <dl
            className="grid grid-cols-2 gap-x-8 gap-y-8 lg:grid-cols-4"
            data-testid="pipeline-card"
          >
            {pipeline.map(({ label, value }) => (
              <div key={label} className="flex flex-col-reverse">
                <dt className="mt-1 text-sm text-[var(--color-ink-2)]">{label}</dt>
                <dd className="text-4xl font-semibold tabular-nums">
                  {value === null ? (
                    <span className="text-base font-normal text-[var(--color-ink-2)]">
                      {NOT_RECORDED}
                    </span>
                  ) : (
                    <CountUp value={value} />
                  )}
                </dd>
              </div>
            ))}
          </dl>

          <dl
            className="mt-10 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-[var(--color-line)] pt-8 lg:grid-cols-4"
            data-testid="scope-strip"
          >
            <ScopeItem value={scope.herbs} label="Ayurvedic herbs" />
            <ScopeItem
              value={scope.drugs}
              label={`conventional drugs, ${scope.drug_classes} classes`}
            />
            <ScopeItem value={scope.conditions} label="conditions" />
          </dl>

          {/* Kept: without it, four figures read as "the rest of the pairs are fine". */}
          <p className="mt-8 max-w-[70ch] text-sm text-[var(--color-ink-2)]">
            Most searched pairs turned up nothing, which this database records as a search
            with no finding rather than as a result.{" "}
            <Link
              href="/how-it-works"
              className="font-medium text-[var(--color-ink)] underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
            >
              How it works
            </Link>
          </p>
        </div>
      </section>

      {/*
        The problem form, full width: its answer lays options out in two columns
        with a combination panel beside them.
      */}
      <section className="border-t border-[var(--color-line)]">
        <div className="page-shell section-pad">
          <h2 className="heading-rule text-2xl sm:text-[2rem]">Describe a problem</h2>
          <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
            In your own words, in English or Hinglish. Or{" "}
            <Link
              href="/check"
              className="font-medium text-[var(--color-ink)] underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
            >
              check a pair
            </Link>{" "}
            if you already have both names.
          </p>

          {conditions.ok ? (
            <AskForm
              supportedConditions={conditions.data.results}
              note={conditions.data.note}
            />
          ) : (
            <div className="mt-8">
              <ApiUnreachable error={conditions.error} what="the supported conditions" />
            </div>
          )}
        </div>
      </section>
    </>
  );
}

function ScopeItem({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-1 text-sm text-[var(--color-ink-2)]">{label}</dt>
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
