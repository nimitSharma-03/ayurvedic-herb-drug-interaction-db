-- Query layer for the herb-drug interaction database.
--
-- The authoritative data lives in the project's frozen reference tables and
-- curated outputs (data/reference/*.csv, data/processed/verified_interactions.json,
-- data/processed/curation_sheet.csv). This database is a derived, disposable
-- read model rebuilt from those files by `python -m hdi.seed`; nothing is
-- entered here by hand, so it can always be deleted and regenerated.
--
-- Columns that the project has no sourced value for are left NULL on purpose.
-- A NULL here means "not documented in our sources", and must never be
-- rendered as a reassurance (see docs/BACKEND_API.md).

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS interaction_evidence;
DROP TABLE IF EXISTS interactions;
DROP TABLE IF EXISTS health_topic_map;
DROP TABLE IF EXISTS medicine_uses;
DROP TABLE IF EXISTS medicine_tags;
DROP TABLE IF EXISTS combination_rules;
DROP TABLE IF EXISTS tag_vocabulary;
DROP TABLE IF EXISTS condition_synonyms;
DROP TABLE IF EXISTS conditions;
DROP TABLE IF EXISTS class_aliases;
DROP TABLE IF EXISTS medicine_aliases;
DROP TABLE IF EXISTS medicines;
DROP TABLE IF EXISTS seed_metadata;

CREATE TABLE medicines (
    id                        TEXT PRIMARY KEY,
    name                      TEXT NOT NULL,
    normalized_name           TEXT NOT NULL,
    category                  TEXT NOT NULL
        CHECK (category IN ('ayurvedic', 'herbal', 'allopathic', 'conventional')),
    medicine_type             TEXT NOT NULL
        CHECK (medicine_type IN ('herb', 'drug')),
    generic_name              TEXT,
    active_ingredients        TEXT,          -- JSON array; NULL when not documented
    scientific_name           TEXT,
    drug_class                TEXT,
    description               TEXT,
    common_uses               TEXT,          -- JSON array of evidence-backed uses
    traditional_uses          TEXT,          -- JSON array; Ayurvedic tradition only
    evidence_level            TEXT
        CHECK (evidence_level IS NULL OR evidence_level IN
               ('strong', 'moderate', 'limited', 'traditional', 'insufficient')),
    side_effects              TEXT,          -- JSON array
    contraindications         TEXT,          -- JSON array
    precautions               TEXT,          -- JSON array
    pregnancy_information     TEXT,
    breastfeeding_information TEXT,
    source                    TEXT,
    source_url                TEXT,
    last_verified             TEXT           -- ISO-8601 date
);

CREATE INDEX idx_medicines_normalized_name ON medicines (normalized_name);
CREATE INDEX idx_medicines_generic_name    ON medicines (generic_name);
CREATE INDEX idx_medicines_scientific_name ON medicines (scientific_name);
CREATE INDEX idx_medicines_category        ON medicines (category);
CREATE INDEX idx_medicines_type            ON medicines (medicine_type);
CREATE INDEX idx_medicines_drug_class      ON medicines (drug_class);

-- Explicit alias relationships. Name-based resolution matches only against
-- these rows plus medicines.normalized_name, so two substances are never
-- merged on similarity alone.
CREATE TABLE medicine_aliases (
    medicine_id      TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    alias            TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    -- 'brand_name' exists so a user can type what is printed on their strip and
    -- still be resolved. It is matching-only: hdi.catalog.PRIVATE_ALIAS_TYPES
    -- keeps brand names out of every response body, because naming a product is
    -- a step towards recommending one (docs/RECOMMEND_API.md).
    alias_type       TEXT NOT NULL
        CHECK (alias_type IN ('synonym', 'scientific_name', 'generic_name',
                              'active_ingredient', 'abbreviation', 'brand_name')),
    PRIMARY KEY (medicine_id, normalized_alias)
);

CREATE INDEX idx_aliases_normalized ON medicine_aliases (normalized_alias);
CREATE INDEX idx_aliases_type       ON medicine_aliases (alias_type);

-- Lay and Hinglish ways of naming a whole drug class ("blood thinner",
-- "sugar ki dawa"). These resolve to a class, not a medicine, so they cannot
-- live in medicine_aliases without asserting an identity that is not there.
-- A current medicine given only at class level still carries that class's
-- shared tags, so the combination check can run on it.
CREATE TABLE class_aliases (
    drug_class       TEXT NOT NULL,
    alias            TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    source_type      TEXT NOT NULL
        CHECK (source_type IN ('fetched_source', 'repo_abstract', 'general_knowledge')),
    source_note      TEXT,
    PRIMARY KEY (drug_class, normalized_alias)
);

CREATE INDEX idx_class_aliases_normalized ON class_aliases (normalized_alias);

-- The supported conditions, derived from what the 13 drugs and 3 drug classes
-- in the frozen reference tables are used for. Anything outside this table is
-- out of scope, and the API says so rather than guessing
-- (data/reference/conditions.csv).
CREATE TABLE conditions (
    condition_id    TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    drug_classes    TEXT NOT NULL      -- JSON array of drug_classes.csv names
);

CREATE INDEX idx_conditions_normalized ON conditions (normalized_name);

-- Lay wordings for a condition, so a topic lookup for "sugar" finds the
-- type 2 diabetes rows.
CREATE TABLE condition_synonyms (
    condition_id       TEXT NOT NULL REFERENCES conditions (condition_id) ON DELETE CASCADE,
    synonym            TEXT NOT NULL,
    normalized_synonym TEXT NOT NULL,
    PRIMARY KEY (condition_id, normalized_synonym)
);

CREATE INDEX idx_condition_synonyms ON condition_synonyms (normalized_synonym);

-- The closed tag vocabulary (data/reference/tag_vocabulary.csv). Every tag on a
-- medicine and in every combination rule must appear here;
-- hdi/validate_reference.py fails the build otherwise, so a typo cannot create
-- a tag that silently never matches anything.
CREATE TABLE tag_vocabulary (
    tag         TEXT PRIMARY KEY,
    applies_to  TEXT NOT NULL CHECK (applies_to IN ('herb', 'drug', 'both')),
    description TEXT NOT NULL
);

-- Pharmacological properties of a medicine, unioned across all of its recorded
-- uses. A tag is a property of the substance, not of the use it was written
-- next to, so the union is the right shape for combination checking.
CREATE TABLE medicine_tags (
    medicine_id TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    tag         TEXT NOT NULL REFERENCES tag_vocabulary (tag) ON DELETE CASCADE,
    PRIMARY KEY (medicine_id, tag)
);

CREATE INDEX idx_medicine_tags_tag ON medicine_tags (tag);

-- What a medicine is used for, one row per medicine-condition pair, from
-- data/reference/herb_uses.csv and data/reference/drug_indications.csv.
--
-- reviewed is 0 on every row and the loader will not accept 1: no row here has
-- had clinical review, and docs/RECOMMEND_API.md lists what a reviewer must
-- check before any of it is used for real.
CREATE TABLE medicine_uses (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id         TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    condition_id        TEXT NOT NULL REFERENCES conditions (condition_id) ON DELETE CASCADE,
    use_kind            TEXT NOT NULL
        CHECK (use_kind IN ('traditional_use', 'conventional_use')),
    summary             TEXT NOT NULL,   -- traditional_use text, or what_its_for
    evidence_level      TEXT NOT NULL
        CHECK (evidence_level IN ('traditional', 'preclinical', 'clinical')),
    pros                TEXT NOT NULL,
    cons                TEXT NOT NULL,
    common_side_effects TEXT,            -- JSON array; populated for drugs
    cautions            TEXT NOT NULL,
    tags                TEXT,            -- JSON array, all from tag_vocabulary
    source_type         TEXT NOT NULL
        CHECK (source_type IN ('fetched_source', 'repo_abstract', 'general_knowledge')),
    source_note         TEXT NOT NULL,
    reviewed            INTEGER NOT NULL DEFAULT 0 CHECK (reviewed = 0),
    UNIQUE (medicine_id, condition_id)
);

CREATE INDEX idx_uses_condition ON medicine_uses (condition_id);
CREATE INDEX idx_uses_medicine  ON medicine_uses (medicine_id);

-- Tag-pair rules behind a mechanism-based caution
-- (data/reference/combination_rules.csv). A rule result is never labelled
-- literature-verified: only a pair the curated interaction table marks
-- documented earns that label.
--
-- Matching is symmetric -- a rule fires when one side carries tag_a and the
-- other tag_b, whichever way round the pair is asked.
CREATE TABLE combination_rules (
    rule_id         TEXT PRIMARY KEY,
    tag_a           TEXT NOT NULL REFERENCES tag_vocabulary (tag),
    tag_b           TEXT NOT NULL REFERENCES tag_vocabulary (tag),
    applies_to      TEXT NOT NULL
        CHECK (applies_to IN ('herb+drug', 'herb+herb', 'drug+drug')),
    reason_sentence TEXT NOT NULL,
    level           TEXT NOT NULL CHECK (level IN ('high', 'moderate', 'low'))
);

CREATE INDEX idx_rules_applies ON combination_rules (applies_to);

CREATE TABLE interactions (
    id                    TEXT PRIMARY KEY,
    medicine_a_id         TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    medicine_b_id         TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    -- Sorted "<a>|<b>"; UNIQUE makes a reversed duplicate uninsertable.
    pair_key              TEXT NOT NULL UNIQUE,
    pair_kind             TEXT NOT NULL
        CHECK (pair_kind IN ('ayurvedic_allopathic', 'ayurvedic_ayurvedic',
                             'allopathic_allopathic')),
    status                TEXT NOT NULL
        CHECK (status IN ('interaction_found', 'no_documented_interaction',
                          'insufficient_evidence')),
    interaction_type      TEXT,   -- curated trigger group; NULL when no evidence
    severity              TEXT
        CHECK (severity IS NULL OR severity IN
               ('major', 'moderate', 'minor', 'none_documented',
                'insufficient_evidence')),
    severity_basis        TEXT,   -- how severity was arrived at; never an LLM
    description           TEXT,   -- factual statement of what the record holds
    mechanism             TEXT,   -- NULL: not captured by abstract-level mining
    clinical_significance TEXT,   -- NULL unless a source states it
    recommended_action    TEXT,   -- NULL: this database issues no clinical advice
    evidence_level        TEXT
        CHECK (evidence_level IS NULL OR evidence_level IN
               ('strong', 'moderate', 'limited', 'traditional', 'insufficient')),
    evidence_basis        TEXT,
    source                TEXT,
    source_url            TEXT,
    last_verified         TEXT,
    -- Canonical ordering. Combined with pair_key's UNIQUE constraint, a pair
    -- can be stored exactly once, in exactly one direction.
    CHECK (medicine_a_id < medicine_b_id)
);

CREATE INDEX idx_interactions_a        ON interactions (medicine_a_id);
CREATE INDEX idx_interactions_b        ON interactions (medicine_b_id);
CREATE INDEX idx_interactions_status   ON interactions (status);
CREATE INDEX idx_interactions_severity ON interactions (severity);
CREATE INDEX idx_interactions_kind     ON interactions (pair_kind);

-- One row per curated candidate sentence behind an interaction, including the
-- ones a curator rejected: what was looked at and dismissed is part of the
-- evidence picture. Every row carries a PMID, per docs/PROJECT_SCOPE.md.
--
-- evidence_index rather than (pmid, trigger_matched) as the key, because
-- hdi.extract legitimately emits the same trigger phrase twice from one
-- abstract when it appears in two sentences, and each carries a different
-- evidence_sentence.
--
-- confidence is 'human_verified' only for curator-confirmed rows. A rejected
-- or unclear row stays 'auto_extracted' however carefully it was reviewed:
-- docs/PROJECT_SCOPE.md forbids marking auto-extracted rows as verified, and a rejection
-- is not verification of an interaction.
CREATE TABLE interaction_evidence (
    interaction_id    TEXT NOT NULL REFERENCES interactions (id) ON DELETE CASCADE,
    evidence_index    INTEGER NOT NULL,
    pmid              TEXT NOT NULL,
    trigger_matched   TEXT NOT NULL DEFAULT '',
    trigger_group     TEXT,
    negated           INTEGER NOT NULL DEFAULT 0,
    confidence        TEXT NOT NULL
        CHECK (confidence IN ('human_verified', 'auto_extracted')),
    verdict           TEXT,
    evidence_sentence TEXT,
    source_url        TEXT,
    PRIMARY KEY (interaction_id, evidence_index)
);

CREATE INDEX idx_evidence_pmid       ON interaction_evidence (pmid);
CREATE INDEX idx_evidence_confidence ON interaction_evidence (confidence);

-- Health-topic -> medicine association. Derived by hdi/seed.py from
-- medicine_uses, one topic per supported condition, plus any extra rows in
-- data/reference/health_topics.csv.
--
-- use_type keeps a traditional claim separable from a conventional indication:
-- a drug's labelled use is conventional_use, a herb's traditional-only use is
-- traditional_use, and a herb use with preclinical or clinical work behind it is
-- evidence_supported_use. Populating one never populates another.
CREATE TABLE health_topic_map (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    topic          TEXT NOT NULL,
    normalized_topic TEXT NOT NULL,
    medicine_id    TEXT NOT NULL REFERENCES medicines (id) ON DELETE CASCADE,
    use_type       TEXT NOT NULL
        CHECK (use_type IN ('conventional_use', 'traditional_use',
                            'evidence_supported_use')),
    description    TEXT,
    evidence_level TEXT
        CHECK (evidence_level IS NULL OR evidence_level IN
               ('strong', 'moderate', 'limited', 'traditional', 'insufficient')),
    source         TEXT,
    source_url     TEXT,
    last_verified  TEXT,
    UNIQUE (normalized_topic, medicine_id, use_type)
);

CREATE INDEX idx_topics_normalized ON health_topic_map (normalized_topic);
CREATE INDEX idx_topics_medicine   ON health_topic_map (medicine_id);

-- Provenance of the build itself, so an API consumer can tell which source
-- files and row counts a given database file was produced from.
CREATE TABLE seed_metadata (
    key   TEXT PRIMARY KEY,
    value TEXT
);
