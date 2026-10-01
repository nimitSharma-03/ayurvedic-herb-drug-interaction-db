/**
 * Grouping and layout for the "combinations to avoid" panel.
 *
 * Nothing here invents, filters or re-levels a warning. Every warning the API
 * returns ends up in exactly one group, the counts reconcile, and
 * `tests/unit/warnings.test.ts` asserts both over every fixture.
 *
 * Two problems are solved here.
 *
 * The API's warnings carry names, not ids (`medicine_a`, `medicine_b`), and it
 * does not say which side is the drug. `resolveSides` decides that from the
 * same response: a side that matches a resolved current medicine is the hub, a
 * side that matches a suggested option takes that option's medicine_type, and
 * when neither applies the original order is kept rather than guessed at.
 *
 * And a diabetes answer repeats one sentence many times -- eleven herbs all
 * "lower blood sugar" against one Metformin. `groupWarnings` collapses warnings
 * that share a reason, a level and a hub into one row listing every herb, which
 * is the same information in a form a reader can actually act on.
 */

import type {
  CombinationWarning,
  CurrentMedicines,
  RecommendOption,
  RecommendResponse,
  WarningLevel,
} from "./types";

/** Hubs first, then the levels in the order the API itself sorts them. */
export const LEVEL_ORDER: WarningLevel[] = [
  "literature_verified",
  "mechanism_based",
  "no_documented_interaction",
  "insufficient_evidence",
];

export function levelRank(level: WarningLevel): number {
  const index = LEVEL_ORDER.indexOf(level);
  return index === -1 ? LEVEL_ORDER.length : index;
}

/** How a line is drawn: solid for a published finding, dashed for reasoning. */
export type LineStyle = "solid" | "dashed" | "dotted";

export function lineStyleFor(level: WarningLevel): LineStyle {
  if (level === "literature_verified") return "solid";
  if (level === "mechanism_based") return "dashed";
  return "dotted";
}

export interface WarningSide {
  name: string;
  /** Null when the response gives no way to tell what kind of medicine it is. */
  medicineType: "herb" | "drug" | null;
  medicineId: string | null;
  /** True when the reader said they already take this one. */
  isCurrent: boolean;
}

export interface ResolvedWarning {
  warning: CombinationWarning;
  /** The medicine the reader already takes, when one side is one of those. */
  hub: WarningSide;
  /** The other side: the thing that would be added to the hub. */
  spoke: WarningSide;
}

export interface WarningGroup {
  /** Stable across renders and across a re-run with the same answer. */
  id: string;
  level: WarningLevel;
  label: string;
  reason: string;
  hub: WarningSide;
  /** Every medicine that conflicts with the hub for this same reason. */
  spokes: WarningSide[];
  /** Every warning folded into this row, in the API's own order. */
  warnings: CombinationWarning[];
  againstCurrentMedicine: boolean;
  lineStyle: LineStyle;
}

function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Build a name lookup from the response: resolved current medicines first, then
 * the suggested options. A name appearing in both is a medicine the reader
 * already takes that is also being offered, and "current" is the fact that
 * matters for the panel.
 */
function buildLookup(
  current: CurrentMedicines | undefined,
  options: RecommendOption[],
): Map<string, WarningSide> {
  const lookup = new Map<string, WarningSide>();
  for (const option of options) {
    lookup.set(nameKey(option.name), {
      name: option.name,
      medicineType: option.medicine_type,
      medicineId: option.medicine_id,
      isCurrent: false,
    });
  }
  for (const resolved of current?.resolved ?? []) {
    lookup.set(nameKey(resolved.name), {
      name: resolved.name,
      medicineType: resolved.medicine_type,
      medicineId: resolved.medicine_id,
      isCurrent: true,
    });
  }
  // A class the reader named ("blood thinner") resolves to its members, and a
  // warning raised against the class names the member, so each member counts
  // as something they take.
  for (const klass of current?.drug_classes ?? []) {
    for (const member of klass.members ?? []) {
      const key = nameKey(member);
      const existing = lookup.get(key);
      lookup.set(key, {
        name: member,
        medicineType: existing?.medicineType ?? "drug",
        medicineId: existing?.medicineId ?? null,
        isCurrent: true,
      });
    }
  }
  return lookup;
}

function sideFor(name: string, lookup: Map<string, WarningSide>): WarningSide {
  return (
    lookup.get(nameKey(name)) ?? {
      name,
      medicineType: null,
      medicineId: null,
      isCurrent: false,
    }
  );
}

/**
 * Decide which side of a warning is the hub.
 *
 * In order of preference: the side the reader already takes; otherwise the drug
 * of a herb-drug pair, since the realistic risk is adding a herb to a
 * prescribed drug (docs/RECOMMEND_API.md records that as a deliberate scope
 * decision); otherwise medicine_a as the API sent it. Never a coin toss, so the
 * same answer always lays out the same way.
 */
export function resolveSides(
  warning: CombinationWarning,
  lookup: Map<string, WarningSide>,
): ResolvedWarning {
  const a = sideFor(warning.medicine_a, lookup);
  const b = sideFor(warning.medicine_b, lookup);

  if (a.isCurrent && !b.isCurrent) return { warning, hub: a, spoke: b };
  if (b.isCurrent && !a.isCurrent) return { warning, hub: b, spoke: a };
  if (a.medicineType === "drug" && b.medicineType === "herb") {
    return { warning, hub: a, spoke: b };
  }
  if (b.medicineType === "drug" && a.medicineType === "herb") {
    return { warning, hub: b, spoke: a };
  }
  return { warning, hub: a, spoke: b };
}

export function resolveWarnings(response: RecommendResponse): ResolvedWarning[] {
  const lookup = buildLookup(response.current_medicines, [
    ...response.ayurvedic_options,
    ...response.allopathic_options,
  ]);
  return response.combination_warnings.map((warning) => resolveSides(warning, lookup));
}

function groupKey(resolved: ResolvedWarning): string {
  return [
    resolved.warning.level,
    nameKey(resolved.hub.name),
    resolved.warning.reason.trim(),
  ].join("\u0000");
}

/**
 * Collapse warnings that share a level, a hub and a reason into one row.
 *
 * Two warnings only merge when all three match, so a different reason or a
 * different medicine never ends up behind one heading. Rows come back in the
 * API's own order -- conflicts with a current medicine first, then by level --
 * with the first warning of a group fixing that group's position.
 */
export function groupWarnings(resolved: ResolvedWarning[]): WarningGroup[] {
  const groups = new Map<string, WarningGroup>();
  const order: string[] = [];

  for (const item of resolved) {
    const key = groupKey(item);
    const existing = groups.get(key);
    if (existing) {
      existing.warnings.push(item.warning);
      if (!existing.spokes.some((side) => nameKey(side.name) === nameKey(item.spoke.name))) {
        existing.spokes.push(item.spoke);
      }
      existing.againstCurrentMedicine =
        existing.againstCurrentMedicine || item.warning.against_current_medicine;
      continue;
    }
    order.push(key);
    groups.set(key, {
      id: `group-${order.length}`,
      level: item.warning.level,
      label: item.warning.label,
      reason: item.warning.reason,
      hub: item.hub,
      spokes: [item.spoke],
      warnings: [item.warning],
      againstCurrentMedicine: item.warning.against_current_medicine,
      lineStyle: lineStyleFor(item.warning.level),
    });
  }

  return order.map((key) => groups.get(key)!);
}

/** `groupWarnings(resolveWarnings(response))`, which is how pages use it. */
export function groupedWarningsFor(response: RecommendResponse): WarningGroup[] {
  return groupWarnings(resolveWarnings(response));
}

export interface WarningHub {
  hub: WarningSide;
  groups: WarningGroup[];
}

/**
 * Group rows by hub, for the panel that draws each current medicine as a hub
 * with its conflicting herbs connected to it. Hubs the reader already takes
 * come first; within a hub, rows keep their order.
 */
export function hubsFor(groups: WarningGroup[]): WarningHub[] {
  const hubs = new Map<string, WarningHub>();
  const order: string[] = [];

  for (const group of groups) {
    const key = nameKey(group.hub.name);
    const existing = hubs.get(key);
    if (existing) {
      existing.groups.push(group);
      continue;
    }
    order.push(key);
    hubs.set(key, { hub: group.hub, groups: [group] });
  }

  return order
    .map((key) => hubs.get(key)!)
    .sort((left, right) => {
      if (left.hub.isCurrent !== right.hub.isCurrent) return left.hub.isCurrent ? -1 : 1;
      const byLevel =
        levelRank(left.groups[0]!.level) - levelRank(right.groups[0]!.level);
      if (byLevel !== 0) return byLevel;
      return order.indexOf(nameKey(left.hub.name)) - order.indexOf(nameKey(right.hub.name));
    });
}

export interface WarningTotals {
  warnings: number;
  groups: number;
  byLevel: Record<WarningLevel, number>;
}

/**
 * What the panel is showing, so a page can state it and a test can reconcile it
 * against the API's own `combination_summary`.
 */
export function warningTotals(groups: WarningGroup[]): WarningTotals {
  const byLevel: Record<WarningLevel, number> = {
    literature_verified: 0,
    mechanism_based: 0,
    no_documented_interaction: 0,
    insufficient_evidence: 0,
  };
  let warnings = 0;
  for (const group of groups) {
    warnings += group.warnings.length;
    byLevel[group.level] += group.warnings.length;
  }
  return { warnings, groups: groups.length, byLevel };
}

/** Every PMID cited by a group, de-duplicated, in the order first seen. */
export function citationsFor(group: WarningGroup) {
  const seen = new Set<string>();
  const citations: CombinationWarning["citations"] = [];
  for (const warning of group.warnings) {
    for (const citation of warning.citations) {
      const key = `${citation.pmid}\u0000${citation.evidence_sentence}`;
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push(citation);
    }
  }
  return citations;
}

/** Every rule behind a group, de-duplicated by rule id. */
export function rulesFor(group: WarningGroup) {
  const seen = new Set<string>();
  const rules: CombinationWarning["rules"] = [];
  for (const warning of group.warnings) {
    for (const rule of warning.rules) {
      if (seen.has(rule.rule_id)) continue;
      seen.add(rule.rule_id);
      rules.push(rule);
    }
  }
  return rules;
}

/**
 * The severities folded into a group, de-duplicated.
 *
 * A group can only merge warnings that share a reason and a level, but severity
 * is derived per pair, so the drawer lists what is actually there instead of
 * picking one.
 */
export function severitiesFor(group: WarningGroup): string[] {
  const seen = new Set<string>();
  for (const warning of group.warnings) {
    if (warning.severity) seen.add(warning.severity);
  }
  return [...seen];
}

/** The mechanism caution levels folded into a group, de-duplicated. */
export function cautionLevelsFor(group: WarningGroup): string[] {
  const seen = new Set<string>();
  for (const warning of group.warnings) {
    if (warning.caution_level) seen.add(warning.caution_level);
  }
  return [...seen];
}
