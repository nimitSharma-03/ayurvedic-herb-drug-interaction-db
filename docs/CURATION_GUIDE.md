# Curation Guide — Phase 4

This is the rulebook for turning auto-extracted candidate rows
(`data/processed/candidates.json`) into curator verdicts. Phase 4 is the
manual review pass: a human reads each row's evidence sentence and decides
whether it describes a real herb-drug interaction.

## Generating the curation sheet

```
python -m hdi.curate
```

Reads `data/processed/candidates.json` and writes
`data/processed/curation_sheet.csv`, sorted by priority so curators work on
the most clinically actionable rows first. Every row keeps `evidence_sentence`
and `trigger_group` so a curator never has to go back to the source abstract
to make a call.

## Sort logic

Rows are ordered by three keys, in this precedence:

1. **Negation status** — non-negated rows are sorted before negated rows.
   A negated row (e.g. "no significant interaction was observed") is
   evidence *against* an interaction, so it's deprioritized relative to rows
   that assert one.
2. **Trigger severity**, most severe first:

   ```
   contraindication > antagonism > risk_increase > pharmacokinetic
     > potentiation > general_interaction
   ```

   This ranks specific pharmacological claims (contraindication, antagonism)
   above generic co-mention language (general_interaction), so curator time
   goes to the rows most likely to describe a concrete, actionable
   interaction.
3. **Drug class balance** — within a tier (same negation + severity),
   rows are round-robin interleaved across the three in-scope drug classes
   (AC = anticoagulants, AD = antidiabetics, CVS = cardiovascular), so the
   top of the sheet isn't dominated by whichever class happens to have the
   most candidate rows. This does not change which tier a row falls into,
   only the order of rows inside it.

Drug classes come from `data/reference/drug_classes.csv`:

| Class | Drugs |
|---|---|
| AC (Anticoagulants) | Warfarin, Heparin, Aspirin, Clopidogrel |
| AD (Antidiabetics) | Metformin, Glimepiride, Insulin, Pioglitazone |
| CVS (Cardiovascular) | Digoxin, Atenolol, Metoprolol, Amlodipine, Losartan |

## Priority tier

Each row gets a `priority_tier` of `priority` or `standard`:

- `priority`: non-negated **and** trigger_group is one of
  `contraindication`, `antagonism`, `risk_increase`, `pharmacokinetic`.
- `standard`: everything else (negated rows, and non-negated rows whose only
  signal is `potentiation` or `general_interaction`).

**Why this cutoff:** `general_interaction` and `potentiation` are the two
loosest trigger categories — they fire on generic "drug interaction" or
"enhances effect" language and are more likely to be noise once a curator
looks at the sentence. Restricting `priority` to the four sharper
categories keeps that tier focused on rows worth reviewing first.

**On the ~1,000-row target:** the project's curation math assumes a priority
tier around 1,000 rows, sized for the full planned corpus. The current
candidate set only has 580 rows total, so a literal 1,000-row priority tier
is impossible here. Applying the same rule (non-negated + top-4 severities)
to today's 580 rows yields 109 priority rows (~19%) — that same proportion,
run against the larger corpus once abstract collection continues, is what
is expected to approach the ~1,000-row target. Do not pad the tier to hit a
number; let the rule size it.

## Sheet columns

| Column | Meaning |
|---|---|
| `herb` | Ayurvedic herb name (common name, per `data/reference/herbs.csv`) |
| `drug` | Conventional drug name |
| `drug_class` | AC / AD / CVS, derived from `drug` |
| `source_pmid` | PubMed ID of the source abstract |
| `trigger_matched` | The literal phrase that triggered extraction |
| `trigger_group` | Severity/category bucket (see sort logic above) |
| `negated` | True if the sentence negates an interaction |
| `confidence` | Extraction confidence (currently always `auto_extracted`; reserved for future extractor versions) |
| `priority_tier` | `priority` or `standard` (see above) |
| `evidence_sentence` | The sentence the extractor matched — read this to make the verdict |
| `verdict` | Empty until a curator fills it in (see below) |
| `notes` | Free-text curator notes; optional |

## Recording a verdict

For each row, a curator fills in the `verdict` column with one of:

- **confirmed** — the sentence describes a real herb-drug interaction of the
  stated type.
- **rejected** — the sentence does not describe an interaction (extractor
  false positive, off-topic mention, etc.).
- **unclear** — the sentence is ambiguous or lacks enough detail; needs a
  second reviewer or the full-text article.

Any other value in `verdict` is invalid and will fail ingest. Rows may be
left blank (`verdict` empty) if not yet reviewed. Use `notes` for anything
that doesn't fit the verdict alone (e.g. why a row is unclear).

Regenerating the sheet (`python -m hdi.curate`) overwrites
`curation_sheet.csv` from `candidates.json` and does not preserve prior
verdicts — do not regenerate the sheet once curator review is underway.

## Ingesting verdicts

```
python -m hdi.curate ingest
```

Reads `data/processed/curation_sheet.csv`, validates that every non-empty
`verdict` is one of `confirmed` / `rejected` / `unclear` (raising with the
offending row(s) if not), and writes every `confirmed` row to
`data/processed/verified_interactions.json`. `rejected` and `unclear` rows
are excluded from that output but are not deleted from the sheet.

This step only reads the curation sheet and writes
`verified_interactions.json` — it never modifies `candidates.json` or
`data/raw/raw_abstracts.json`, per `docs/PROJECT_SCOPE.md`. `hdi.curate.ingest_verdicts()`
also refuses outright to write to either of those paths if ever pointed at
them.
