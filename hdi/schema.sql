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
    alias_type       TEXT NOT NULL
        CHECK (alias_type IN ('synonym', 'scientific_name', 'generic_name',
                              'active_ingredient', 'abbreviation')),
    PRIMARY KEY (medicine_id, normalized_alias)
);

CREATE INDEX idx_aliases_normalized ON medicine_aliases (normalized_alias);

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

-- Health-topic -> medicine association. Populated from
-- data/reference/health_topics.csv, which ships with headers only: the
-- project has no sourced indication data yet, and inventing it is forbidden
-- (docs/PROJECT_SCOPE.md, docs/BACKEND_API.md). The table and its API are live, so
-- adding sourced rows to that CSV is a data change, not a code change.
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
