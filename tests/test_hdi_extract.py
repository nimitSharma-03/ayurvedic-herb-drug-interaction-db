"""Smoke test for hdi.extract, run on a tiny in-memory fixture (not the real
1,240-abstract corpus) before the pipeline is trusted on real data.

Covers: a genuine positive trigger, a negated trigger that must still be
flagged (not dropped), a sentence with no trigger language, and a record
where the herb is never actually mentioned (must be reported, not silently
skipped).
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import spacy

from hdi.extract import run_extraction

_NLP = None


def _nlp():
    global _NLP
    if _NLP is None:
        _NLP = spacy.load("en_ner_bc5cdr_md")
    return _NLP


class ExtractSmokeTest(unittest.TestCase):
    HERB_TERMS = {"Ashwagandha": ["Withania somnifera", "Asgandh"]}

    FIXTURE = [
        {
            "herb_name": "Ashwagandha",
            "drug_name": "Diazepam",
            "pmid": "1001",
            "title": "Sedative interaction study",
            "abstract": (
                "Withania somnifera potentiates the sedative effects of Diazepam "
                "in animal models."
            ),
        },
        {
            "herb_name": "Ashwagandha",
            "drug_name": "Diazepam",
            "pmid": "1002",
            "title": "No interaction found",
            "abstract": (
                "Withania somnifera and Diazepam were co-administered. No "
                "clinically significant interaction was observed in this cohort."
            ),
        },
        {
            "herb_name": "Ashwagandha",
            "drug_name": "Diazepam",
            "pmid": "1003",
            "title": "Unrelated pharmacokinetics",
            "abstract": "Withania somnifera and Diazepam were both present in the sample set.",
        },
        {
            "herb_name": "Ashwagandha",
            "drug_name": "Diazepam",
            "pmid": "1004",
            "title": "Drug-only paper",
            "abstract": "This paper discusses Diazepam pharmacokinetics broadly.",
        },
    ]

    @classmethod
    def setUpClass(cls):
        cls.rows, cls.mention_issues, cls.stem_hits = run_extraction(
            cls.FIXTURE, _nlp(), cls.HERB_TERMS
        )

    def test_positive_trigger_detected_and_not_negated(self):
        matches = [r for r in self.rows if r["source_pmid"] == "1001"]
        self.assertTrue(
            any(r["trigger_matched"] == "potentiates" and not r["negated"] for r in matches)
        )

    def test_negated_trigger_flagged_not_dropped(self):
        matches = [r for r in self.rows if r["source_pmid"] == "1002"]
        self.assertTrue(matches, "a negated sentence should still produce a candidate row")
        self.assertTrue(all(r["negated"] for r in matches))

    def test_no_trigger_produces_no_rows(self):
        matches = [r for r in self.rows if r["source_pmid"] == "1003"]
        self.assertEqual(matches, [])

    def test_missing_herb_mention_is_reported_not_silently_dropped(self):
        issue_pmids = {issue["pmid"] for issue in self.mention_issues}
        self.assertIn("1004", issue_pmids)
        self.assertEqual([r for r in self.rows if r["source_pmid"] == "1004"], [])

    def test_every_row_has_required_fields(self):
        for row in self.rows:
            for field in ("herb", "drug", "source_pmid", "trigger_matched", "negated", "confidence"):
                self.assertIn(field, row)
            self.assertEqual(row["confidence"], "auto_extracted")


if __name__ == "__main__":
    unittest.main()
