/**
 * Shared copy and the small text helpers the pages share.
 *
 * The strings here are this app's own wording: labels, empty states and the
 * footer. Nothing medical is written here. Every medicine name, use, caution,
 * warning reason, disclaimer and count comes out of a typed API response, and
 * `tests/unit/honesty.test.ts` fails the build if a medicine name, a condition
 * name or one of the real counts ever appears as a literal in src/.
 */

/** Shown wherever this project holds no value for a field it displays. */
export const NOT_RECORDED = "Not recorded yet";

/** Shown against every option and every use row, because none is reviewed. */
export const NOT_REVIEWED = "Not yet expert-reviewed";

export const FOOTER_DISCLAIMER =
  "Information from an unreviewed research database. Not medical advice, not a diagnosis and not a prescription.";

export const PUBMED_BASE = "https://pubmed.ncbi.nlm.nih.gov";

export function pubmedUrl(pmid: string): string {
  return `${PUBMED_BASE}/${encodeURIComponent(pmid.trim())}/`;
}

/**
 * PMIDs named in a `source_note`.
 *
 * A use row records provenance as a sentence ("PMID 22198821 (randomised
 * double-blind placebo-controlled trial in type 2 diabetes)"), which is the only
 * place the citation for a use is carried. Reading the ids out of it lets the
 * page link them without inventing anything: a note with no PMID yields no
 * link, and the note itself is always shown as well.
 */
export function pmidsIn(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = new Set<string>();
  for (const match of text.matchAll(/\bPMID[:\s]*((?:\d{4,9})(?:\s*,\s*\d{4,9})*)/gi)) {
    for (const id of match[1]!.split(",")) {
      const trimmed = id.trim();
      if (trimmed) found.add(trimmed);
    }
  }
  return [...found];
}

/** Title-ish label for a snake_case value the API returns, for a chip. */
export function humanizeToken(value: string): string {
  const spaced = value.replace(/_/g, " ").trim();
  if (!spaced) return value;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export function matchedOnLabel(matchedOn: string, query: string, name: string): string | null {
  const q = query.trim();
  if (!q) return null;
  // Only say why it matched when the reason is not already obvious from the
  // name on screen. "matched Ashwagandha" beside Ashwagandha is noise.
  if (q.toLowerCase() === name.toLowerCase()) return null;
  switch (matchedOn) {
    case "exact_alias":
    case "alias_prefix":
    case "alias_substring":
      return `matched ${q}`;
    case "name_prefix":
    case "name_substring":
      return `matched on the name`;
    default:
      return null;
  }
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return NOT_RECORDED;
  return value.toLocaleString("en-IN");
}

/**
 * A severity or status token as a sentence-case phrase.
 *
 * `none_documented` and `insufficient_evidence` are spelled out rather than
 * humanized, because "None documented" on its own reads as a finding and this
 * project's whole point is that it is not one.
 */
export function severityLabel(severity: string | null): string {
  if (!severity) return NOT_RECORDED;
  if (severity === "none_documented") return "No severity to report";
  if (severity === "insufficient_evidence") return "Not enough evidence to grade";
  return humanizeToken(severity);
}

export function evidenceLabel(level: string | null): string {
  if (!level) return NOT_RECORDED;
  return humanizeToken(level);
}
