import Link from "next/link";
import { BookOpenCheck, ChartNoAxesColumn, CircleHelp, SearchX } from "lucide-react";

import { PmidLink } from "@/components/pmid-link";
import { Badge } from "@/components/ui/badge";
import { NOT_RECORDED, evidenceLabel, severityLabel } from "@/lib/text";
import type { InteractionRecord } from "@/lib/types";

type Record_ = Omit<InteractionRecord, "disclaimer"> | InteractionRecord;

const STATUS_TONE = {
  interaction_found: "verified",
  no_documented_interaction: "insufficient",
  insufficient_evidence: "insufficient",
} as const;

const STATUS_ICON = {
  interaction_found: BookOpenCheck,
  no_documented_interaction: SearchX,
  insufficient_evidence: CircleHelp,
} as const;

const STATUS_WORDING = {
  interaction_found: "Documented interaction",
  no_documented_interaction: "No documented interaction",
  insufficient_evidence: "Insufficient evidence",
} as const;

/**
 * One stored interaction pair.
 *
 * The three states are kept visually distinct, because collapsing any two of
 * them would misrepresent the evidence: "we looked and found nothing" is not
 * "this is fine", and "we have no basis to answer" is not "we found nothing".
 * Only `interaction_found` gets the literature-verified red, and every
 * status badge carries an icon as well as its wording.
 *
 * On the pair check it is a ruled row in three columns: the status, then the
 * names and the backend's own summary, then the evidence level on the right.
 * A pair with nothing documented also says, in so many words, that this is not
 * a safety claim.
 *
 * `mechanism` and `recommended_action` are null on every row in this project --
 * abstract-level mining does not establish a mechanism, and this database
 * issues no clinical advice -- so they render as absent rather than being left
 * out, which would hide that the question was asked.
 */
export function InteractionRow({
  record,
  self,
  compact = false,
}: {
  record: Record_;
  /** The medicine whose page this is, so the other side can be named. */
  self?: string;
  compact?: boolean;
}) {
  const other =
    self === record.medicine_a.id
      ? record.medicine_b
      : self === record.medicine_b.id
        ? record.medicine_a
        : null;
  const documented = record.status === "interaction_found";

  const StatusIcon = STATUS_ICON[record.status];
  const statusBadge = (
    <Badge tone={STATUS_TONE[record.status]}>
      <StatusIcon aria-hidden="true" />
      {STATUS_WORDING[record.status]}
    </Badge>
  );
  const title = other ? (
    <Link
      href={`/medicines/${other.id}`}
      className="underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
    >
      {other.name}
    </Link>
  ) : (
    `${record.medicine_a.name} and ${record.medicine_b.name}`
  );
  const noFinding =
    record.status === "no_documented_interaction" ? (
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        A search with no finding. This is not a safety claim.
      </p>
    ) : null;

  const evidence =
    documented && record.evidence.length > 0 ? (
      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-medium">
          Evidence sentences ({record.evidence.length})
        </summary>
        <ul className="mt-3 flex flex-col gap-3">
          {record.evidence.map((row, index) => (
            <li
              key={`${row.pmid}-${index}`}
              className="rounded-[var(--radius-tight)] border border-[var(--color-line)] p-3"
            >
              <div className="flex flex-wrap items-center gap-2">
                <PmidLink pmid={row.pmid} />
                <Badge tone="neutral" className="font-normal">
                  {row.verdict}
                </Badge>
                {row.negated ? (
                  <Badge tone="neutral" className="font-normal">
                    reported as negated
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                {row.evidence_sentence}
              </p>
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  if (compact) {
    return (
      <article data-testid="interaction-row" data-status={record.status} className="py-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="mr-auto text-base sm:text-lg">{title}</h3>
          {statusBadge}
        </div>
        <p className="mt-3 text-sm">{record.description}</p>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Evidence: {evidenceLabel(record.evidence_level)}
          {record.evidence_basis ? ` · ${record.evidence_basis}` : ""}
        </p>
        {evidence}
      </article>
    );
  }

  return (
    <article
      data-testid="interaction-row"
      data-status={record.status}
      className="grid gap-4 border-y border-[var(--color-line)] py-6 md:grid-cols-[14rem_minmax(0,1fr)_auto] md:gap-8"
    >
      <div>{statusBadge}</div>

      <div className="min-w-0">
        <h3 className="text-lg">{title}</h3>
        <p className="mt-2 text-[0.9375rem]">{record.description}</p>
        {noFinding}

        <dl className="mt-5 grid gap-3 border-t border-[var(--color-line)] pt-4 text-sm sm:grid-cols-2">
          <Pair label="Severity" value={severityLabel(record.severity)} />
          <Pair label="Evidence level" value={evidenceLabel(record.evidence_level)} />
          <Pair label="How severity was arrived at" value={record.severity_basis} />
          <Pair label="How the evidence was arrived at" value={record.evidence_basis} />
          <Pair label="Mechanism" value={record.mechanism} />
          <Pair label="Recommended action" value={record.recommended_action} />
        </dl>

        {evidence}
      </div>

      <div className="md:justify-self-end">
        <Badge tone="neutral">
          <ChartNoAxesColumn aria-hidden="true" />
          Evidence: {evidenceLabel(record.evidence_level)}
        </Badge>
      </div>
    </article>
  );
}

function Pair({ label, value }: { label: string; value: string | null }) {
  const present = typeof value === "string" && value.trim().length > 0;
  return (
    <div>
      <dt className="font-medium text-[var(--color-ink-2)]">{label}</dt>
      <dd className={present ? "" : "text-[var(--color-insufficient)]"}>
        {present ? value : NOT_RECORDED}
      </dd>
    </div>
  );
}
