# Reference-system review — Day 4–5

Five bullet points each on how these existing herb/drug knowledge systems structure their data, as required by the Week 1–2 plan.

---

## GRAYU (Ayurveda-specific)
- Graph database (built in Neo4j) with four main node types: **Plant, Formulation, Phytochemical, Disease**.
- Relationships carry their own properties, e.g. `IS_INGREDIENT_IN` (plant → formulation) stores the part used and quantity; `ASSOCIATED_WITH` (formulation → disease) stores the original Ayurvedic term.
- Each node type has a unique identifier: PubChem CID for phytochemicals, standardized scientific name for plants, a disease ID mapped to MeSH/DOID.
- Ayurvedic disease terms are mapped to modern disease ontologies (MeSH/DOID) by semantic similarity, so classical and modern terminology stay linked.
- Scale: ~12,700 plants, ~1,000 formulations, ~130,000 phytochemicals, ~13,000 diseases — built by integrating multiple existing sources rather than one clinical trial database.

## HERB / HERB 2.0 (Traditional Chinese Medicine)
- Five linked data components: **herb, ingredient, formula, gene target, disease**.
- A "formula" node was added in HERB 2.0 specifically to represent multi-herb TCM prescriptions, since that's the real-world clinical unit, not single herbs.
- Combines clinical evidence (trials, meta-analyses) with experimental evidence (lab studies) for the same herb–disease link, and labels which type each record is.
- Data is deduplicated and standardized against authoritative reference databases before being added, to avoid the same herb/ingredient appearing under multiple names.
- Users filter by entity type (herb, ingredient, target, etc.) through a node-type selector rather than one flat search box.

## BATMAN-TCM / BATMAN-TCM 2.0
- Structured as a pipeline, not just a static table: **herb → ingredient → predicted target → pathway/disease**.
- Every ingredient–target link carries a numeric **confidence score**; only links above a user-set "score cutoff" are shown, and known lab-confirmed targets are always listed ahead of predicted ones.
- Targets are cross-linked outward to established databases (DrugBank, KEGG, PubChem) rather than duplicating that data internally.
- Supports both "described" (literature-confirmed) and "predicted" (computationally inferred) interactions in the same schema, clearly labelled as different confidence tiers.
- Built-in downstream analysis (GO term / KEGG pathway / disease enrichment) runs directly on the target list, so the schema is designed to feed statistical analysis, not just display records.

## SuppKG (Dietary supplements)
- A knowledge graph of nodes and directed edges, extracted automatically from PubMed abstracts using NLP (a customized version of the NLM's SemRep tool, called SemRepDS).
- Built on top of an existing medical vocabulary (UMLS), extended with a dietary-supplement-specific terminology (iDISK) that UMLS lacked.
- Typical relation chains are multi-hop, e.g. **Supplement → Gene → Drug** or **Supplement → Gene1 → Function → Gene2 → Drug**, capturing indirect mechanisms, not just direct pairs.
- Every extracted relationship is manually reviewed for correctness before being trusted; the paper reports the exact review outcome (e.g. ~73% of a sampled batch were judged mechanistically plausible) instead of assuming full accuracy.
- Designed as an addition to a general-purpose medical knowledge base, showing that a narrow domain (supplements) can be layered onto broader existing infrastructure instead of built alone.

## NP-KG (Natural product–drug interactions)
- Two graphs merged into one: an **ontology-grounded graph** (built from existing biomedical ontologies and drug databases) and a **literature-based graph** (built by extracting relationships straight from full-text papers).
- Relation extraction uses two different NLP systems together (SemRep and INDRA/REACH) and cross-checks their outputs, rather than relying on a single extractor.
- Literature-derived edges are tagged with the **publication year** they came from, so the graph keeps a timeline of when each piece of evidence was published.
- Focuses specifically on **pharmacokinetic mechanism** (which enzyme or transporter is involved, e.g. CYP3A4, UGT), not just "these two interact."
- Deliberately narrow starting scope (built and validated on a small number of natural products first, e.g. green tea and kratom) before any plan to expand — the same "freeze scope, expand later" approach used in this project.

---

## What this means for our database

| Pattern seen elsewhere | Relevant to our project? |
|---|---|
| Confidence/evidence scoring on every link (BATMAN-TCM) | Yes — matches our own confidence flag (`auto_extracted` vs verified) |
| Cross-linking out to PMID/PubChem instead of duplicating (HERB, BATMAN) | Yes — we already require a PMID per interaction |
| Manual review with a reported accuracy number (SuppKG) | Yes — matches our precision-by-trigger-group evaluation |
| Multi-hop mechanism paths (SuppKG, NP-KG) | Out of scope for now — noted for `future_work.md` |
| Graph database as storage (GRAYU, HERB) | Out of scope — we use CSV/JSON by design, but the node/edge thinking (herb–drug–evidence as connected records) is still useful conceptually |
| Narrow starting scope before expanding (NP-KG) | Yes — this is exactly our frozen-scope approach |

Sources: GRAYU (Frontiers in Pharmacology, 2025); HERB / HERB 2.0 (Nucleic Acids Research, 2021 & 2025); BATMAN-TCM / BATMAN-TCM 2.0 (Scientific Reports 2016; Nucleic Acids Research 2024); SuppKG (Journal of Biomedical Informatics, 2022); NP-KG (Journal of Biomedical Informatics, 2023).
