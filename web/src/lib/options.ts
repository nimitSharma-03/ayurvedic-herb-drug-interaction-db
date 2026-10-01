/**
 * Marking the options a reader already takes.
 *
 * A medicine someone already takes must not be offered to them as something to
 * start. The API says so in `caution_notes` ("Metformin is listed as an option
 * below and you have said you already take it"), and the card has to show it
 * rather than leave the note to do the work.
 *
 * Nothing is removed. The option stays in the list, dimmed, labelled "You take
 * this", with its pros, cons and cautions still readable -- the reader came for
 * information about it too, and a quietly shortened list is the kind of thing
 * this project does not do.
 */

import type { CurrentMedicines, RecommendOption, RecommendResponse } from "./types";

export interface MarkedOption {
  option: RecommendOption;
  /** True when this exact medicine is one the reader said they take. */
  alreadyTaken: boolean;
  /**
   * The class the reader named when they named a class rather than a medicine
   * ("blood thinner"), and this option is in it. Null otherwise.
   */
  viaDrugClass: string | null;
  /** What the reader typed, when it resolved to this medicine. */
  query: string | null;
}

function key(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The medicine ids and names the reader already takes.
 *
 * Both are collected because the two sources identify a medicine differently:
 * `resolved` carries an id, while a drug class carries only member names.
 */
export function currentMedicineIndex(current: CurrentMedicines | undefined) {
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  const classByName = new Map<string, string>();

  for (const resolved of current?.resolved ?? []) {
    byId.set(resolved.medicine_id, resolved.query);
    byName.set(key(resolved.name), resolved.query);
  }
  for (const klass of current?.drug_classes ?? []) {
    for (const member of klass.members ?? []) {
      classByName.set(key(member), klass.drug_class);
    }
  }
  return { byId, byName, classByName };
}

export function markOptions(
  options: RecommendOption[],
  current: CurrentMedicines | undefined,
): MarkedOption[] {
  const index = currentMedicineIndex(current);
  return options.map((option) => {
    const query = index.byId.get(option.medicine_id) ?? index.byName.get(key(option.name)) ?? null;
    const viaDrugClass = index.classByName.get(key(option.name)) ?? null;
    return {
      option,
      alreadyTaken: query !== null,
      viaDrugClass,
      query,
    };
  });
}

/** Both option lists marked in one call, which is how the page uses it. */
export function markedOptionsFor(response: RecommendResponse) {
  return {
    ayurvedic: markOptions(response.ayurvedic_options, response.current_medicines),
    allopathic: markOptions(response.allopathic_options, response.current_medicines),
  };
}

/**
 * Options are returned by evidence level and then alphabetically, and this
 * project does not rank medicines against each other. The order is therefore
 * left exactly as the API sent it; this says so out loud rather than leaving a
 * later reader to wonder whether a sort was dropped by accident.
 */
export const OPTION_ORDER_NOTE =
  "Listed by how much evidence this database holds, then alphabetically. This is not a ranking.";

/** Evidence grades on a use row, weakest claim first, for display only. */
export const USE_EVIDENCE_ORDER = ["clinical", "preclinical", "traditional"] as const;

export function useEvidenceLabel(level: string): string {
  if (level === "clinical") return "Clinical evidence";
  if (level === "preclinical") return "Preclinical evidence";
  if (level === "traditional") return "Traditional use";
  return level;
}

export function sourceTypeLabel(sourceType: string): string {
  if (sourceType === "fetched_source") return "From a retrieved drug label";
  if (sourceType === "repo_abstract") return "From a PubMed abstract in this project";
  if (sourceType === "general_knowledge") return "Established pharmacology or classical source";
  return sourceType;
}
