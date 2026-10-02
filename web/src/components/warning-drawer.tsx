"use client";

import { WarningLevelBadge } from "@/components/evidence-badge";
import { PmidLink } from "@/components/pmid-link";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { NOT_RECORDED, humanizeToken, severityLabel } from "@/lib/text";
import {
  cautionLevelsFor,
  citationsFor,
  rulesFor,
  severitiesFor,
  type WarningGroup,
} from "@/lib/warnings";

/**
 * The detail drawer for one warning row.
 *
 * Shows the level, the severity, the evidence grade, the reason, the evidence
 * sentence and a PubMed link for every PMID -- when the API returns them.
 * Mechanism and recommended action read "Not recorded yet" when the response
 * carries nothing, because abstract-level mining does not establish a mechanism
 * and this database issues no clinical advice; leaving the rows out would hide
 * that the question was asked at all.
 *
 * A mechanism-based warning has no citation by construction, and the drawer
 * says that in words rather than showing an empty citations list.
 */
export function WarningDrawer({
  group,
  onClose,
}: {
  group: WarningGroup | null;
  onClose: () => void;
}) {
  const open = group !== null;

  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {group ? (
        <SheetContent
          aria-label={`Details for ${group.hub.name} with ${group.spokes
            .map((side) => side.name)
            .join(", ")}`}
          data-testid="warning-drawer"
        >
          <div className="flex flex-col gap-1.5 pr-10">
            <WarningLevelBadge level={group.level} label={group.label} />
            <SheetTitle>
              {group.hub.name} with {group.spokes.map((side) => side.name).join(", ")}
            </SheetTitle>
            <SheetDescription>
              {group.spokes.length === 1
                ? "One pair."
                : `${group.spokes.length} pairs sharing this reason and this medicine.`}
              {group.againstCurrentMedicine
                ? " This one is against a medicine you said you already take."
                : ""}
            </SheetDescription>
          </div>

          <section>
            <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">Reason</h3>
            <p className="mt-1">{group.reason}</p>
          </section>

          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Detail
              label="Severity"
              value={
                severitiesFor(group).length > 0
                  ? severitiesFor(group).map(severityLabel).join(", ")
                  : null
              }
            />
            <Detail
              label="Caution level"
              value={
                cautionLevelsFor(group).length > 0
                  ? cautionLevelsFor(group).map(humanizeToken).join(", ")
                  : null
              }
            />
            <Detail
              label="Evidence"
              value={
                group.level === "literature_verified"
                  ? "Curated PubMed abstracts, confirmed by a curator"
                  : group.level === "mechanism_based"
                    ? "A tag-pair rule in this project, not a published finding"
                    : group.level === "no_documented_interaction"
                      ? "The literature was searched and nothing was found"
                      : "No evidence collected for this pair"
              }
            />
            <Detail label="Mechanism" value={null} />
            <Detail label="Recommended action" value={null} />
          </dl>

          <section>
            <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">
              Citations
            </h3>
            {citationsFor(group).length > 0 ? (
              <ul className="mt-2 flex flex-col gap-3">
                {citationsFor(group).map((citation, index) => (
                  <li
                    key={`${citation.pmid}-${index}`}
                    data-testid="drawer-citation"
                    className="rounded-[var(--radius-tight)] bg-[var(--color-wash)] p-3"
                  >
                    <PmidLink pmid={citation.pmid} />
                    <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                      {citation.evidence_sentence}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-[var(--color-ink-2)]">
                {group.level === "mechanism_based"
                  ? "None. A mechanism-based caution is reasoning about what two substances do, not a published finding, so attaching a reference to it would be inventing a source."
                  : "None recorded for this pair."}
              </p>
            )}
          </section>

          {rulesFor(group).length > 0 ? (
            <section>
              <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">
                Rules that fired
              </h3>
              <ul className="mt-2 flex flex-col gap-2">
                {rulesFor(group).map((rule) => (
                  <li key={rule.rule_id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-[family-name:var(--font-mono)] text-sm">
                      {rule.rule_id}
                    </span>
                    {[...new Set(rule.tags)].map((tag) => (
                      <Badge key={tag} tone="neutral" className="font-normal">
                        {tag}
                      </Badge>
                    ))}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">
              Pairs in this row
            </h3>
            {/*
              A pair can be returned more than once: a medicine that is both an
              option here and something the reader already takes is checked on
              both of those grounds. Listing it twice reads as a mistake, so it
              is listed once and the number of checks is stated.
            */}
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {pairsFor(group).map((pair) => (
                <li key={pair.label}>
                  {pair.label}
                  {pair.times > 1 ? (
                    <span className="text-[var(--color-ink-2)]">
                      {" "}
                      (checked {pair.times} times)
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </SheetContent>
      ) : null}
    </Sheet>
  );
}

/**
 * The distinct pairs behind a row, with how many times each was checked.
 *
 * The counts still add up to every warning in the group, so nothing is dropped
 * -- only said once instead of twice.
 */
function pairsFor(group: WarningGroup): { label: string; times: number }[] {
  const counts = new Map<string, number>();
  for (const warning of group.warnings) {
    const label = `${warning.medicine_a} and ${warning.medicine_b}`;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, times]) => ({ label, times }));
}

function Detail({ label, value }: { label: string; value: string | null }) {
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
