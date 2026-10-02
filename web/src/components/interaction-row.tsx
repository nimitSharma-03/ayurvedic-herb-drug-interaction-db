import Link from "next/link";

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
 * Only `interaction_found` gets the literature-verified red.
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

  return (
    <article
      data-testid="interaction-row"
      data-status={record.status}
      className={compact ? "py-4" : "card-surface p-5 sm:p-6"}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-base sm:text-lg">
          {other ? (
            <Link
              href={`/medicines/${other.id}`}
              className="underline decoration-[var(--color-line)] underline-offset-4 hover:decoration-[var(--color-primary)]"
            >
              {other.name}
            </Link>
          ) : (
            `${record.medicine_a.name} and ${record.medicine_b.name}`
          )}
        </h3>
        <Badge tone={STATUS_TONE[record.status]}>{STATUS_WORDING[record.status]}</Badge>
      </div>

      <p className="mt-3 text-sm">{record.description}</p>

      {compact ? (
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Evidence: {evidenceLabel(record.evidence_level)}
          {record.evidence_basis ? ` · ${record.evidence_basis}` : ""}
        </p>
      ) : (
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <Pair label="Severity" value={severityLabel(record.severity)} />
          <Pair label="Evidence level" value={evidenceLabel(record.evidence_level)} />
          <Pair label="How severity was arrived at" value={record.severity_basis} />
          <Pair label="How the evidence was arrived at" value={record.evidence_basis} />
          <Pair label="Mechanism" value={record.mechanism} />
          <Pair label="Recommended action" value={record.recommended_action} />
        </dl>
      )}

      {documented && record.evidence.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Evidence sentences ({record.evidence.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-3">
            {record.evidence.map((row, index) => (
              <li
                key={`${row.pmid}-${index}`}
                className="rounded-[var(--radius-tight)] bg-[var(--color-wash)] p-3"
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
      ) : null}
    </article>
  );
}

function Pair({ label, value }: { label: string; value: string | null }) {
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
