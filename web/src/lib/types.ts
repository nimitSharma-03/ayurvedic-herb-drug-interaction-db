/**
 * Response types, written from the real responses saved in tests/fixtures/.
 *
 * Every shape here was read off a captured response, not from a guess or from
 * prose in the docs. `tests/unit/types.test.ts` walks every fixture and asserts
 * that the fields these types declare are the fields the backend actually
 * sends, so a backend change that renames or drops one fails a test here
 * rather than rendering as `undefined` on a page.
 *
 * Fields the backend returns as `null` are typed `| null` rather than optional:
 * a null from this API means "not documented in our sources" and the UI has to
 * render that difference, so it must not be collapsed into absence.
 */

export type Category = "ayurvedic" | "herbal" | "allopathic" | "conventional";
export type MedicineType = "herb" | "drug";

/** How a search matched. The API ranks by this and names it on every result. */
export type MatchedOn =
  | "exact_name"
  | "exact_alias"
  | "name_prefix"
  | "alias_prefix"
  | "name_substring"
  | "alias_substring";

export type InteractionStatus =
  | "interaction_found"
  | "no_documented_interaction"
  | "insufficient_evidence"
  | "medicine_not_found";

export type Severity =
  | "major"
  | "moderate"
  | "minor"
  | "none_documented"
  | "insufficient_evidence";

export type EvidenceLevel =
  | "strong"
  | "moderate"
  | "limited"
  | "traditional"
  | "insufficient";

/** The evidence grade on a use row, which is a different vocabulary. */
export type UseEvidenceLevel = "traditional" | "preclinical" | "clinical";

export type SourceType = "fetched_source" | "repo_abstract" | "general_knowledge";

export type PairKind =
  | "ayurvedic_allopathic"
  | "ayurvedic_ayurvedic"
  | "allopathic_allopathic";

export type WarningLevel =
  | "literature_verified"
  | "mechanism_based"
  | "no_documented_interaction"
  | "insufficient_evidence";

export type RecommendStatus = "emergency" | "results" | "low_confidence" | "out_of_scope";

/* ------------------------------------------------------------------ errors */

export interface ApiErrorBody {
  code: string;
  message: string;
  /** Present on an ambiguous_medicine 409. */
  candidates?: string[];
  /** Present on a medicine_not_found 404 from a pair check. */
  side?: string;
  query?: string;
  /** Present on an identical_medicine 400. */
  medicine_id?: string;
  /** Present on an unknown-condition 400, so a client can recover in one trip. */
  supported_conditions?: SupportedCondition[];
}

/* ------------------------------------------------------------- health, root */

export interface HealthResponse {
  status: "ok";
  database: Record<string, string>;
}

/* --------------------------------------------------------------- medicines */

export interface MedicineSummary {
  id: string;
  name: string;
  category: Category;
  medicine_type: MedicineType;
  generic_name: string | null;
  scientific_name: string | null;
  drug_class: string | null;
}

export interface SearchResult extends MedicineSummary {
  evidence_level: EvidenceLevel | null;
  matched_on: MatchedOn;
}

export interface SearchResponse {
  query: string;
  category: string;
  count: number;
  results: SearchResult[];
}

export interface MedicineListResponse {
  count: number;
  category: string;
  limit: number;
  offset: number;
  results: MedicineSummary[];
}

/** An alias the API is willing to print. Brand names never appear here. */
export interface MedicineAlias {
  alias: string;
  alias_type: string;
}

export interface SourceRef {
  source: string | null;
  source_url: string | null;
  last_verified: string | null;
}

export interface DataCompleteness {
  documented_fields: string[];
  undocumented_fields: string[];
  note: string;
}

/**
 * One sourced use of a medicine: what it is recorded for, and the pros, cons
 * and cautions written beside it. `reviewed` is false on every row in this
 * project and the UI says so wherever a row is shown.
 */
export interface RecordedUse {
  medicine_id: string;
  name: string;
  category: Category;
  medicine_type: MedicineType;
  scientific_name: string | null;
  drug_class: string | null;
  use_kind: string;
  evidence_level: UseEvidenceLevel;
  pros: string | null;
  cons: string | null;
  cautions: string | null;
  source_type: SourceType;
  source_note: string | null;
  uses: string | null;
  common_side_effects: string[];
  tags: string[];
  reviewed: boolean;
  condition_id: string;
  condition_name: string;
}

export interface MedicineDetail {
  id: string;
  name: string;
  category: Category;
  medicine_type: MedicineType;
  generic_name: string | null;
  scientific_name: string | null;
  drug_class: string | null;
  description: string | null;
  evidence_level: EvidenceLevel | null;
  pregnancy_information: string | null;
  breastfeeding_information: string | null;
  active_ingredients: string[];
  common_uses: string[];
  traditional_uses: string[];
  side_effects: string[];
  contraindications: string[];
  precautions: string[];
  aliases: MedicineAlias[];
  sources: SourceRef[];
  data_completeness: DataCompleteness;
  interaction_summary: Partial<Record<InteractionStatus, number>>;
  recorded_uses: RecordedUse[];
}

/* ------------------------------------------------------------ interactions */

export interface EvidenceRow {
  pmid: string;
  trigger_matched: string | null;
  trigger_group: string | null;
  negated: boolean;
  confidence: string;
  verdict: string;
  evidence_sentence: string;
  source_url: string | null;
}

export interface InteractionRecord {
  id: string | null;
  pair_kind: PairKind;
  status: Exclude<InteractionStatus, "medicine_not_found">;
  interaction_type: string | null;
  severity: Severity | null;
  severity_basis: string | null;
  description: string;
  mechanism: string | null;
  clinical_significance: string | null;
  recommended_action: string | null;
  evidence_level: EvidenceLevel | null;
  evidence_basis: string | null;
  source: string | null;
  source_url: string | null;
  last_verified: string | null;
  medicine_a: MedicineSummary;
  medicine_b: MedicineSummary;
  interaction_found: boolean | null;
  evidence: EvidenceRow[];
  disclaimer: string;
}

/** The 404 body from a pair check. It carries the state as well as the error. */
export interface MedicineNotFoundResponse {
  status: "medicine_not_found";
  error: ApiErrorBody;
  disclaimer: string;
}

export interface MedicineInteractionsResponse {
  medicine: MedicineSummary;
  category: string;
  status_filter: string | null;
  counts: Partial<Record<InteractionStatus, number>>;
  count: number;
  results: Omit<InteractionRecord, "disclaimer">[];
  disclaimer: string;
}

export interface DocumentedInteractionsResponse {
  pair_kind: string | null;
  count: number;
  results: Omit<InteractionRecord, "disclaimer">[];
  disclaimer: string;
}

/* --------------------------------------------------------------- conditions */

export interface SupportedCondition {
  condition_id: string;
  name: string;
  drug_classes: string[];
}

export interface ConditionsResponse {
  count: number;
  results: SupportedCondition[];
  note: string;
}

/* ---------------------------------------------------------------- recommend */

export interface DetectedCondition {
  condition_id: string;
  confidence: number;
  source: string;
  name: string;
}

export interface RecommendOption {
  medicine_id: string;
  name: string;
  category: Category;
  medicine_type: MedicineType;
  scientific_name: string | null;
  drug_class: string | null;
  use_kind: string;
  evidence_level: UseEvidenceLevel;
  pros: string | null;
  cons: string | null;
  cautions: string | null;
  source_type: SourceType;
  source_note: string | null;
  uses: string | null;
  common_side_effects: string[];
  tags: string[];
  reviewed: boolean;
  condition_id: string;
  condition_name: string;
}

export interface WarningCitation {
  pmid: string;
  evidence_sentence: string;
  source_url: string;
}

export interface WarningRule {
  rule_id: string;
  tags: string[];
  level: string | null;
}

/**
 * One combination warning. Note there are no medicine ids here, only the two
 * names: `lib/warnings.ts` resolves a side to a medicine by name against the
 * options and the resolved current medicines in the same response.
 */
export interface CombinationWarning {
  level: WarningLevel;
  label: string;
  medicine_a: string;
  medicine_b: string;
  reason: string;
  severity: Severity | null;
  /** Only on a mechanism_based warning. */
  caution_level?: string | null;
  against_current_medicine: boolean;
  citations: WarningCitation[];
  rules: WarningRule[];
}

export interface CombinationSummary {
  pairs_checked: number;
  warnings_listed: number;
  pairs_with_no_finding_not_listed: number;
  note: string;
}

export interface ResolvedMedicine {
  query: string;
  medicine_id: string;
  name: string;
  medicine_type: MedicineType;
  category: Category;
  drug_class: string | null;
  resolved_as: string;
}

export interface ResolvedDrugClass {
  query: string;
  drug_class: string;
  resolved_as: string;
  /** Every medicine in the class, so the page can say which ones are meant. */
  members: string[];
}

export interface AmbiguousMedicine {
  query: string;
  candidates: string[];
}

export interface CurrentMedicines {
  resolved: ResolvedMedicine[];
  drug_classes: ResolvedDrugClass[];
  unresolved: string[];
  ambiguous: AmbiguousMedicine[];
}

export interface RedFlag {
  category: string;
  label: string;
  message: string;
}

/**
 * The /recommend response. One shape with four statuses rather than four
 * shapes: the option lists and the warning list are always present and always
 * empty unless the status is `results`, which is what the backend guarantees.
 */
export interface RecommendResponse {
  status: RecommendStatus;
  disclaimer: string;
  detected_conditions: DetectedCondition[];
  ayurvedic_options: RecommendOption[];
  allopathic_options: RecommendOption[];
  combination_warnings: CombinationWarning[];
  caution_notes: string[];
  /** `results` only. */
  combination_summary?: CombinationSummary;
  current_medicines?: CurrentMedicines;
  evidence_note?: string;
  /** `emergency` only. */
  red_flags?: RedFlag[];
  message?: string;
  actions?: string[];
  /** `out_of_scope` and `low_confidence` only. */
  note?: string;
  supported_conditions?: SupportedCondition[];
  ignored_caution_flags?: string[];
}

export interface CautionFlags {
  pregnant_or_breastfeeding: boolean;
  under_18: boolean;
  kidney_or_liver_disease: boolean;
}

export interface RecommendRequest {
  text?: string;
  current_medicines?: string[];
  cautions?: Partial<CautionFlags>;
  condition_ids?: string[];
}

/* -------------------------------------------------------------------- stats */

export interface StatsLiterature {
  pairs_searched: number;
  abstracts_harvested: number | null;
  distinct_pmids_harvested: number | null;
  candidate_sentences: number | null;
  evidence_rows: number;
  verdicts: { confirmed: number; rejected: number; unclear: number };
  documented_pairs: number;
  verified_interaction_records: number | null;
  result_states: Record<string, number>;
  no_finding_basis: {
    abstracts_screened_nothing_found: number;
    search_returned_no_abstracts: number;
    curator_rejected_the_candidates: number;
    curator_marked_it_unclear: number;
  };
  distinct_pmids_cited: number;
}

export interface StatsScope {
  medicines: number;
  herbs: number;
  drugs: number;
  drug_classes: number;
  drug_classes_detail: { drug_class: string; drugs: number }[];
  conditions: number;
  condition_synonyms: number;
  aliases: number;
  class_aliases: number;
}

export interface StatsKnowledge {
  rows: number;
  by_source_type: { source_type: SourceType; rows: number }[];
  by_use_kind: { use_kind: string; rows: number }[];
  by_evidence_level: { evidence_level: UseEvidenceLevel; rows: number }[];
  reviewed_rows: number;
  combination_rules: number;
  tags: number;
  health_topic_rows: number;
}

export interface ClassifierPerClass {
  class: string;
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ClassifierMetrics {
  model: string;
  test_set: string;
  test_set_is_synthetic: boolean;
  test_set_caveat: string;
  rows_scored: number;
  threshold: number;
  macro_f1_test: number;
  macro_f1_validation: number | null;
  target_macro_f1: number;
  target_met: boolean;
  training_rows: number | null;
  validation_rows: number | null;
  vocabulary_size: number | null;
  classes: string[];
  per_class: ClassifierPerClass[];
  multi_condition_rows: {
    total: number;
    exact_set: number;
    partial: number;
    none_correct: number;
  };
  confusion_matrix: { rows: string[]; columns: string[]; counts: number[][] };
}

export interface StatsResponse {
  literature: StatsLiterature;
  scope: StatsScope;
  knowledge: StatsKnowledge;
  /** Null in a checkout where ml/evaluate.py has not been run. */
  classifier: ClassifierMetrics | null;
  classifier_note: string | null;
  database: Record<string, string>;
  note: string;
}
