import Link from "next/link";
import { FileSearch, FlaskConical, Leaf, ListChecks, Pill, Stethoscope } from "lucide-react";

import { ApiUnreachable } from "@/components/api-unreachable";
import { CountUp } from "@/components/count-up";
import { MedicineSearch } from "@/components/medicine-search";
import { Button } from "@/components/ui/button";
import { loadStats } from "@/lib/server-data";
import { NOT_RECORDED } from "@/lib/text";

export default async function HomePage() {
  const stats = await loadStats();

  if (!stats.ok) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <ApiUnreachable error={stats.error} what="the pipeline counts" />
      </div>
    );
  }

  const { literature, scope } = stats.data;

  /**
   * The four counts on the home card, in pipeline order. Each is a value from
   * /stats, which counts it from this repository's own files; nothing here is
   * written down. A count the backend reports as absent shows as absent.
   */
  const pipeline = [
    {
      label: "herb and medicine pairs searched",
      value: literature.pairs_searched,
      icon: FileSearch,
    },
    {
      label: "abstracts read",
      value: literature.abstracts_harvested,
      icon: ListChecks,
    },
    {
      label: "candidate sentences extracted",
      value: literature.candidate_sentences,
      icon: FlaskConical,
    },
    {
      label: "pairs with a documented interaction",
      value: literature.documented_pairs,
      icon: Stethoscope,
    },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-14">
        <div className="animate-reveal">
          <h1 className="max-w-xl text-3xl sm:text-4xl lg:text-5xl">
            Check what your herbs and medicines do together
          </h1>
          <p className="mt-4 max-w-xl text-lg text-[var(--color-ink-2)]">
            Ayurvedic herbs and conventional medicines are often taken side by side. This
            looks up what the published literature in this project actually records about
            those combinations, and says plainly where it records nothing.
          </p>

          <div className="panel mt-8 p-5 sm:p-6">
            <MedicineSearch />
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/ask">Describe a problem</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/check">Check two medicines</Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-5">
          <div className="panel animate-reveal p-6 sm:p-7" data-testid="pipeline-card">
            <h2 className="text-xl">From papers to answers</h2>
            <p className="mt-2 text-sm text-[var(--color-ink-2)]">
              Every entry is traceable to the abstract it came from. These are the counts
              from this project's own files.
            </p>

            <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-6">
              {pipeline.map(({ label, value, icon: Icon }) => (
                <div key={label}>
                  <dt className="flex items-center gap-1.5 text-sm text-[var(--color-ink-2)]">
                    <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                    {label}
                  </dt>
                  <dd className="mt-1 font-[family-name:var(--font-heading)] text-3xl font-semibold tabular-nums">
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

            <p className="mt-6 text-sm text-[var(--color-ink-2)]">
              Most searched pairs turned up nothing, and the database says so rather than
              implying the combination is fine.{" "}
              <Link
                href="/how-it-works"
                className="font-semibold text-[var(--color-ink)] underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-herb)]"
              >
                How it works
              </Link>
            </p>
          </div>

          <div
            className="card-surface flex flex-wrap gap-x-8 gap-y-5 p-5 sm:p-6"
            data-testid="scope-strip"
          >
            <ScopeItem
              icon={<Leaf className="size-4 text-[var(--color-herb)]" aria-hidden="true" />}
              value={scope.herbs}
              label="Ayurvedic herbs"
            />
            <ScopeItem
              icon={<Pill className="size-4 text-[var(--color-drug)]" aria-hidden="true" />}
              value={scope.drugs}
              label={`conventional drugs in ${scope.drug_classes} classes`}
            />
            <ScopeItem
              icon={
                <Stethoscope className="size-4 text-[var(--color-ink-2)]" aria-hidden="true" />
              }
              value={scope.conditions}
              label="conditions covered"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function ScopeItem({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
}) {
  return (
    <div className="min-w-28">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="font-[family-name:var(--font-heading)] text-2xl font-semibold tabular-nums">
          {value}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-[var(--color-ink-2)]">{label}</p>
    </div>
  );
}
