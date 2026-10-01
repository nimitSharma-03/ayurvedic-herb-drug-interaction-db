import { BookOpenCheck, CircleHelp, FlaskConical, Leaf, Pill } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { Category, MedicineType, WarningLevel } from "@/lib/types";

/**
 * The badges that carry this project's vocabulary.
 *
 * Each one takes a value the API returned and derives both the wording and the
 * colour from it. A caller cannot pass the label and the tone separately, so a
 * mechanism-based caution can never be shown in the literature-verified red.
 */

const WARNING_TONE: Record<WarningLevel, "verified" | "mechanism" | "insufficient"> = {
  literature_verified: "verified",
  mechanism_based: "mechanism",
  no_documented_interaction: "insufficient",
  insufficient_evidence: "insufficient",
};

/**
 * A warning's level, worded with the API's own `label`.
 *
 * The label is never rewritten here. "Mechanism-based caution (not
 * literature-verified)" is the backend's exact wording, and shortening it to
 * "mechanism-based" would drop the part that matters.
 */
export function WarningLevelBadge({
  level,
  label,
}: {
  level: WarningLevel;
  label: string;
}) {
  const Icon = level === "literature_verified" ? BookOpenCheck : CircleHelp;
  return (
    <Badge tone={WARNING_TONE[level]}>
      <Icon aria-hidden="true" />
      {label}
    </Badge>
  );
}

export function CategoryBadge({
  category,
  medicineType,
}: {
  category: Category;
  medicineType: MedicineType;
}) {
  const isHerb = medicineType === "herb";
  return (
    <Badge tone={isHerb ? "herb" : "drug"}>
      {isHerb ? <Leaf aria-hidden="true" /> : <Pill aria-hidden="true" />}
      {isHerb ? "Ayurvedic" : "Allopathic"}
      <span className="sr-only"> ({category})</span>
    </Badge>
  );
}

const USE_EVIDENCE_WORDING: Record<string, string> = {
  clinical: "Clinical evidence",
  preclinical: "Preclinical evidence",
  traditional: "Traditional use",
};

/**
 * The evidence grade on a use row.
 *
 * All three are neutral-toned on purpose. Giving `clinical` a confident colour
 * would read as endorsement, and docs/RECOMMEND_API.md records that the
 * clinical rows here rest on single small trials.
 */
export function UseEvidenceBadge({ level }: { level: string }) {
  return (
    <Badge tone="neutral">
      <FlaskConical aria-hidden="true" />
      {USE_EVIDENCE_WORDING[level] ?? level}
    </Badge>
  );
}

/** Shown against every option and use row, because none has been reviewed. */
export function NotReviewedBadge() {
  return (
    <Badge tone="neutral" className="font-normal">
      Not yet expert-reviewed
    </Badge>
  );
}
