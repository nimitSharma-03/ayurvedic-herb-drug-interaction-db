/**
 * The honesty scan, run over rendered output and over this app's own source.
 *
 * The rules and their calibration are the same ones `hdi/validate_reference.py`
 * applies to the reference files and `tests/test_recommend.py` applies to every
 * string of every response. Mirroring them here closes the last gap: the
 * backend guarantees its own strings are clean, and this guarantees that what
 * this app *renders* is too, including the copy written in these files.
 *
 * The word "safe" cannot simply be banned, because the wording this project is
 * required to use for a pair it holds no record of contains it:
 *
 *   "No documented interaction in this database. This does not mean the
 *    combination is safe."
 *
 * So what is forbidden is an *unnegated claim* of safety, sentence by sentence,
 * exactly as the backend decides it. `tests/unit/forbidden.test.ts` pins the
 * calibration in both directions, so a scan that stopped catching claims, or
 * started catching the required sentence, fails.
 */

export interface Finding {
  rule: string;
  match: string;
  /** The sentence or line the match was found in. */
  context: string;
}

/** Patterns forbidden outright, however they are framed. */
const OUTRIGHT: { rule: string; pattern: RegExp }[] = [
  {
    rule: "looks like a dose",
    pattern:
      /\b\d+\s*(?:mg|mcg|ug|g|gm|grams?|ml|cc|iu|units?|tablets?|capsules?|tsp|tbsp)\b/gi,
  },
  {
    rule: "looks like a dosing frequency",
    pattern: /\b(?:twice|thrice|once)\s+(?:a|per)\s+day\b/gi,
  },
  {
    rule: "dosing abbreviation",
    pattern: /\b(?:bd|tds|od|hs|q\.?d\.?|b\.?i\.?d\.?|t\.?i\.?d\.?)\b/gi,
  },
  { rule: "uses the forbidden phrase 'safe to take'", pattern: /safe to take/gi },
  {
    rule: "claims safety",
    pattern: /\b(?:perfectly|completely|totally|entirely|generally) safe\b/gi,
  },
  { rule: "claims safety", pattern: /\bharmless\b/gi },
  { rule: "claims safety", pattern: /\brisk[- ]free\b/gi },
];

/** Claim-shaped uses of "safe". A "narrow safety margin" is a warning, not one. */
const SAFETY_CLAIM =
  /\b(?:is|are|was|were|be|been|seems?|appears?|remains?|stays?)\s+(?:\w+\s+){0,2}safer?\b|\bsafer?\s+(?:to|for|with|in|alongside)\b/i;

const NEGATION =
  /\b(?:not|never|no|none|nothing|nor|cannot|can't|does ?n[o']t|do ?n[o']t|is ?n[o']t|was ?n[o']t|absence|without|un\w+)\b/i;

const SENTENCE_SPLIT = /(?<=[.!?;])\s+|\n+/;

/** Everything forbidden in text this app shows a reader. */
export function scanText(text: string): Finding[] {
  const findings: Finding[] = [];
  const normalized = text.replace(/ /g, " ");

  for (const { rule, pattern } of OUTRIGHT) {
    for (const match of normalized.matchAll(pattern)) {
      findings.push({
        rule,
        match: match[0],
        context: contextAround(normalized, match.index ?? 0),
      });
    }
  }

  for (const sentence of normalized.split(SENTENCE_SPLIT)) {
    const claim = SAFETY_CLAIM.exec(sentence);
    if (!claim) continue;
    if (NEGATION.test(sentence)) continue;
    findings.push({
      rule: "claims something is safe without negating it",
      match: claim[0],
      context: sentence.trim(),
    });
  }

  return findings;
}

/**
 * Brand names, which must never be rendered.
 *
 * The list is not written here: the test reads it from
 * `data/reference/medicine_aliases.csv`, so adding a brand there automatically
 * extends the scan. A trade name resolves when a reader types it and the
 * backend strips it from every response; this checks that this app never prints
 * one of its own accord either.
 */
export function scanForBrandNames(text: string, brandNames: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const brand of brandNames) {
    const pattern = new RegExp(`\\b${escapeRegExp(brand)}\\b`, "gi");
    for (const match of text.matchAll(pattern)) {
      findings.push({
        rule: "prints a brand name",
        match: match[0],
        context: contextAround(text, match.index ?? 0),
      });
    }
  }
  return findings;
}

/**
 * Medical content or counts written into this app rather than read from the
 * API. Used over source files, with the real names and numbers supplied by the
 * caller so that nothing medical is hardcoded in the scan either.
 */
export function scanForHardcodedValues(
  source: string,
  values: { label: string; needle: string }[],
): Finding[] {
  const findings: Finding[] = [];
  for (const { label, needle } of values) {
    const pattern = new RegExp(`(^|[^\\w-])${escapeRegExp(needle)}($|[^\\w-])`, "gi");
    for (const match of source.matchAll(pattern)) {
      findings.push({
        rule: `hardcodes ${label}`,
        match: needle,
        context: contextAround(source, match.index ?? 0),
      });
    }
  }
  return findings;
}

/**
 * Strip the parts of a source file that cannot be rendered prose, so a scan
 * over source does not trip over a layout class or a comment.
 *
 * Deliberately conservative: only `className` and `data-testid` attribute
 * values and comments are removed. Everything that could reach a reader --
 * every string literal, every number in a prop -- stays in.
 */
export function strippedSource(source: string): string {
  return source
    .replace(/className=\{?["'`][^"'`]*["'`]\}?/g, "")
    .replace(/className=\{(?:cn\()?[\s\S]*?\n\s*\)?\}/g, "")
    .replace(/data-testid=["'][^"']*["']/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1")
    // Collapsed last, after the line comments are gone. JSX wraps prose across
    // lines and the sentence scan treats a newline as the end of a sentence, so
    // without this a negation on one line would not be seen to negate the claim
    // that continues on the next.
    .replace(/\s+/g, " ");
}

function contextAround(text: string, index: number, radius = 90): string {
  return text
    .slice(Math.max(0, index - radius), index + radius)
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function describe(findings: Finding[]): string {
  return findings
    .map((finding) => `${finding.rule}: ${finding.match!} — in "${finding.context}"`)
    .join("\n");
}
