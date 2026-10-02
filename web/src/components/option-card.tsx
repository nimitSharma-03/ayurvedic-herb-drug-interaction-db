import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { NotReviewedBadge, UseEvidenceBadge } from "@/components/evidence-badge";
import { SourceNotePmids } from "@/components/pmid-link";
import { Badge } from "@/components/ui/badge";
import { sourceTypeLabel } from "@/lib/options";
import type { MarkedOption } from "@/lib/options";
import { NOT_RECORDED } from "@/lib/text";
import { cn } from "@/lib/utils";

/**
 * One option.
 *
 * An option the reader already takes is dimmed and labelled "You take this"
 * instead of being offered. It is still shown in full: they came for
 * information about it too, and a list that quietly dropped it would be hiding
 * something rather than being helpful.
 *
 * Every field comes from the response. A field the backend has nothing for
 * reads "Not recorded yet", not an empty line.
 */
export function OptionCard({ marked }: { marked: MarkedOption }) {
  const { option, alreadyTaken, viaDrugClass, query } = marked;
  const subtitle = option.scientific_name ?? option.drug_class;

  return (
    <article
      data-testid="option-card"
      data-already-taken={alreadyTaken ? "true" : "false"}
      data-medicine-id={option.medicine_id}
      className={cn(
        "card-surface flex h-full flex-col gap-3 p-5 sm:p-6",
        alreadyTaken && "opacity-65",
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="mr-auto min-w-0">
          <h3 className="text-lg font-semibold">
            {option.name}
          </h3>
          {subtitle ? (
            <p
              className={cn(
                "text-sm text-[var(--color-ink-2)]",
                option.scientific_name && "italic",
              )}
            >
              {subtitle}
            </p>
          ) : null}
        </div>
        {alreadyTaken ? (
          <Badge tone="neutral" data-testid="you-take-this">
            You take this
          </Badge>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <UseEvidenceBadge level={option.evidence_level} />
        <NotReviewedBadge />
      </div>

      {alreadyTaken ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          {query && query.toLowerCase() !== option.name.toLowerCase()
            ? `You listed this as "${query}". It is shown for information, not as something to add.`
            : "You listed this already. It is shown for information, not as something to add."}
        </p>
      ) : null}

      {!alreadyTaken && viaDrugClass ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          You named a group this one belongs to ({viaDrugClass}).
        </p>
      ) : null}

      <dl className="flex flex-col gap-3 text-sm">
        <Line label="Recorded for" value={option.uses} />
        <Line label="Pros" value={option.pros} />
        <Line label="Cons" value={option.cons} />
        <Line label="Cautions" value={option.cautions} />
        {option.common_side_effects.length > 0 ? (
          <div>
            <dt className="font-semibold text-[var(--color-ink-2)]">Common side effects</dt>
            <dd>{option.common_side_effects.join(", ")}</dd>
          </div>
        ) : null}
        <div>
          <dt className="font-semibold text-[var(--color-ink-2)]">Source</dt>
          <dd className="flex flex-col gap-1">
            <span>{sourceTypeLabel(option.source_type)}</span>
            {option.source_note ? (
              <span className="text-[var(--color-ink-2)]">{option.source_note}</span>
            ) : (
              <span className="text-[var(--color-insufficient)]">{NOT_RECORDED}</span>
            )}
            <SourceNotePmids note={option.source_note} />
          </dd>
        </div>
      </dl>

      <Link
        href={`/medicines/${option.medicine_id}`}
        data-testid="option-link"
        className="mt-auto inline-flex items-center gap-1 pt-1 text-sm font-semibold underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
      >
        Everything recorded about {option.name}
        <ArrowUpRight className="size-3.5" aria-hidden="true" />
      </Link>
    </article>
  );
}

function Line({ label, value }: { label: string; value: string | null }) {
  const present = typeof value === "string" && value.trim().length > 0;
  return (
    <div>
      <dt className="font-semibold text-[var(--color-ink-2)]">{label}</dt>
      <dd className={present ? "" : "text-[var(--color-insufficient)]"}>
        {present ? value : NOT_RECORDED}
      </dd>
    </div>
  );
}
